// Прогрес будується з журналу подій «завершена сесія».
// Журнал — єдине джерело правди: його легко синхронізувати з сервером
// пізніше (додати поля userId/deviceId і відправляти нові записи).
//
// Запис сесії:
//   { id, profileId, topicId, level, startedAt, finishedAt, total, correct, stars,
//     avgMs, hintsUsed, mistakes: [{ exerciseId, text, answer, answerText, given, answerPrefix?, canonical?, step? }] }
// avgMs — середній час на один приклад у цій сесії (у старих записах відсутній).

import { summarize } from './session.js';

export function sessionRecord(session, { profileId = 'default', startedAt, finishedAt = Date.now() } = {}) {
  const s = summarize(session);
  return {
    id: `${finishedAt}-${Math.floor(Math.random() * 1e6)}`,
    profileId,
    topicId: session.topicId,
    level: session.level,
    startedAt,
    finishedAt,
    total: s.total,
    correct: s.correct,
    stars: s.stars,
    avgMs: s.avgMs,
    hintsUsed: s.hintsUsed,
    stepStats: s.stepStats,
    mistakes: s.mistakes.map(({ exerciseId, text, answer, answerText, given, answerPrefix, canonical, step }) =>
      ({ exerciseId, text, answer, answerText, given, answerPrefix, canonical, step })),
  };
}

// Статистика одного рівня розділу.
//   sessions, accuracy — накопичувально за всі сесії рівня;
//   bestStars          — найкращий результат;
//   lastAvgMs          — середній час на приклад в останній сесії;
//   prevAvgMs          — те саме для передостанньої;
//   previous           — передостанній запис (для порівняння в підсумку).
export function levelProgress(records, topicId, level) {
  const own = records
    .filter((r) => r.topicId === topicId && r.level === level)
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const total = own.reduce((acc, r) => acc + r.total, 0);
  const correct = own.reduce((acc, r) => acc + r.correct, 0);
  const last = own.at(-1);
  const prev = own.at(-2);
  return {
    sessions: own.length,
    accuracy: total ? correct / total : null,
    bestStars: Math.max(0, ...own.map((r) => r.stars)),
    lastAvgMs: last?.avgMs ?? null,
    prevAvgMs: prev?.avgMs ?? null,
    previous: prev ?? null,
    lastAt: last?.finishedAt ?? null,
  };
}

// Підсумок по розділу для картки на головному екрані.
export function topicProgress(records, topicId) {
  const own = records.filter((r) => r.topicId === topicId);
  const bestStars = {};
  for (const r of own) bestStars[r.level] = Math.max(bestStars[r.level] ?? 0, r.stars);
  return { sessions: own.length, bestStars, lastAt: own.length ? Math.max(...own.map((r) => r.finishedAt)) : null };
}

// Скільки календарних днів між двома моментами (за місцевим часом):
// сесія о 23:50 о 00:10 наступного дня — це вже 1 день («вчора»).
export function calendarDaysBetween(fromMs, toMs) {
  const day = (ms) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  };
  return Math.round(day(toMs) - day(fromMs));
}

// Порівняння часу з попередньою сесією: 'faster' | 'slower' | 'same' | null.
// Різниця до 0,1 с вважається однаковою.
export function compareTime(currentMs, previousMs, toleranceMs = 100) {
  if (currentMs == null || previousMs == null) return null;
  const diffMs = currentMs - previousMs;
  if (Math.abs(diffMs) < toleranceMs) return { trend: 'same', diffMs };
  return { trend: diffMs < 0 ? 'faster' : 'slower', diffMs };
}

const accuracyPct = (r) => (r.total ? Math.round((r.correct / r.total) * 100) : 0);

// Порівняння сесії з попередньою на тому ж рівні.
// Швидкість має сенс лише тоді, коли точність не впала: інакше «швидше»
// можна отримати, натискаючи відповіді навмання.
//   { first: true }                                   — попередньої сесії немає;
//   { accuracy: { trend: 'up'|'same'|'down', diffPct }, speed: compareTime(...) | null }
export function compareWithPrevious(current, previous) {
  if (!previous) return { first: true, accuracy: null, speed: null };
  const diffPct = accuracyPct(current) - accuracyPct(previous);
  const trend = diffPct > 0 ? 'up' : diffPct < 0 ? 'down' : 'same';
  return {
    first: false,
    accuracy: { trend, diffPct },
    speed: trend === 'down' ? null : compareTime(current.avgMs, previous.avgMs),
  };
}
