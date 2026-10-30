// Service worker за принципом «спершу мережа».
//
// Кожен запит іде на сервер без HTTP-кешу браузера (сервер відповідає коротким
// «не змінилося», якщо файл той самий). Тому після оновлення сайту всі модулі
// завжди однієї версії — старі файли з кешу не змішуються з новими.
// Копії в Cache Storage потрібні лише тоді, коли немає інтернету: застосунок
// відкривається й працює офлайн з того, що вже бачив.
//
// Аварійне вимкнення: замінити вміст цього файлу на
//   self.addEventListener('install', () => self.skipWaiting());
//   self.addEventListener('activate', () => self.registration.unregister());

const CACHE = 'mt-v1';

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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith((async () => {
    // Запит навігації не можна копіювати з новими параметрами — будуємо з URL.
    const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' });
    try {
      const res = await fetch(fresh);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
