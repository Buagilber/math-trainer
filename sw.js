// Service worker за принципом «спершу мережа».
//
// Кожен запит іде на сервер без HTTP-кешу браузера (сервер відповідає коротким
// «не змінилося», якщо файл той самий). Тому після оновлення сайту всі модулі
// завжди однієї версії — старі файли з кешу не змішуються з новими.
// Копії в Cache Storage потрібні, коли мережа підводить:
//   - мережі немає / помилка DNS / сервер недоступний — одразу беремо копію;
//   - мережа «висить» довше за NETWORK_TIMEOUT_MS (Wi‑Fi без інтернету, дуже
//     повільний зв'язок) — віддаємо копію, а відповідь мережі, коли прийде,
//     оновить кеш на наступний раз; якщо копії немає — чекаємо мережу далі.
//     Після такого тайм-ауту наступні SLOW_MODE_MS копії віддаються одразу:
//     модулі коду вантажать один одного ланцюжком, і без цього кожен рівень
//     ланцюжка чекав би свої 5 секунд (відкриття тривало б ~30 с замість ~5 с);
//   - сервер відповів помилкою 5xx — беремо копію;
//   - відповідь перенаправлена на чужий сайт (сторінка входу в публічний Wi‑Fi) —
//     не приймаємо й не кешуємо, беремо копію.
//
// Аварійне вимкнення: замінити вміст цього файлу на
//   self.addEventListener('install', () => self.skipWaiting());
//   self.addEventListener('activate', () => self.registration.unregister());
// і опублікувати. Браузер перевіряє sw.js при кожному відкритті застосунку,
// тож наступне відкриття вимкне service worker у всіх користувачів.

const CACHE = 'mt-v1';
const NETWORK_TIMEOUT_MS = 5000;
const SLOW_MODE_MS = 30000;
const TIMED_OUT = Symbol('timeout');
let slowUntil = 0; // до цього моменту мережа вважається повільною

// Сторінку застосунку зберігаємо одразу: перший візит завантажує її ще до того,
// як service worker почне перехоплювати запити, тож інакше офлайн вона б не відкрилась.
// Решта файлів потрапляє в кеш сама, коли застосунок ними користується.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request('./', { cache: 'no-cache' }))).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Відповідь, якій не довіряємо: помилка сервера або перенаправлення на інший сайт.
const isUnusable = (res) =>
  res.status >= 500 || res.type === 'opaqueredirect' || (res.redirected && new URL(res.url).origin !== location.origin);

async function fromNetwork(req) {
  // Запит навігації не можна копіювати з новими параметрами — будуємо з URL.
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' });
  const res = await fetch(fresh);
  if (isUnusable(res)) throw new Error(`Непридатна відповідь: ${res.status} ${res.url}`);
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith((async () => {
    if (Date.now() < slowUntil) {
      const cached = await caches.match(req);
      if (cached) return cached;
    }
    const network = fromNetwork(req);
    network.catch(() => {}); // помилку обробляємо нижче; тут — щоб не було «необробленої»
    const timer = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, TIMED_OUT));
    try {
      const first = await Promise.race([network, timer]);
      if (first !== TIMED_OUT) return first;
      // Мережа повільна: є копія — віддаємо її, мережа тим часом оновить кеш.
      slowUntil = Date.now() + SLOW_MODE_MS;
      return (await caches.match(req)) ?? (await network);
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
