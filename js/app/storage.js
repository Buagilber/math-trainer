// Обгортка над localStorage (може бути недоступним у приватному режимі)
// і сховище прогресу. Щоб перенести прогрес на сервер, достатньо замінити
// progressStore на реалізацію з тими самими методами.

const memory = new Map();

export const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { memory.set(key, value); }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { memory.delete(key); }
  },
};

const PROGRESS_KEY = 'mt.sessions.v1';
const MAX_RECORDS = 2000;

export const progressStore = {
  all() {
    try { return JSON.parse(storage.get(PROGRESS_KEY) ?? '[]'); } catch { return []; }
  },
  add(record) {
    const records = [...this.all(), record].slice(-MAX_RECORDS);
    storage.set(PROGRESS_KEY, JSON.stringify(records));
  },
  clear() {
    storage.remove(PROGRESS_KEY);
  },
};
