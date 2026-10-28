// Завантаження контенту з data/. Запит іде при кожному запуску
// без кешу браузера, тому нові завдання з'являються одразу після публікації.

import { CONFIG } from '../config.js';
import { validateTopic } from '../core/validate.js';

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${url}: помилка в JSON (${e.message})`);
  }
}

// Повертає { levels, grades: [{ ...grade, topics: [topic] }], errors: [string] }.
export async function loadContent() {
  const base = new URL(CONFIG.catalogUrl, location.href);
  const catalog = await fetchJson(base);
  const errors = [];

  const grades = await Promise.all(
    (catalog.grades ?? []).map(async (grade) => {
      const topics = await Promise.all(
        (grade.topics ?? []).map(async (path) => {
          try {
            const raw = await fetchJson(new URL(path, base));
            const { topic, errors: topicErrors } = validateTopic(raw);
            errors.push(...topicErrors.map((e) => `${path}: ${e}`));
            return topic && topic.exercises.length ? topic : null;
          } catch (e) {
            errors.push(e.message);
            return null;
          }
        }),
      );
      return { ...grade, topics: topics.filter(Boolean) };
    }),
  );

  if (errors.length) console.warn('Помилки в контенті:', errors);
  return { levels: catalog.levels ?? {}, grades, errors };
}
