// Прогрес будується з журналу подій «завершена сесія».
// Журнал — єдине джерело правди: його легко синхронізувати з сервером
// пізніше (додати поля userId/deviceId і відправляти нові записи).
//
// Запис сесії:
//   { id, profileId, topicId, level, startedAt, finishedAt, total, correct, stars,
//     avgMs, hintsUsed, mistakes: [{ exerciseId, text, answer, answerText, given, answerPrefix?, canonical?, step?, written? }] }
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
    mistakes: s.mistakes.map(({ exerciseId, text, answer, answerText, given, answerPrefix, canonical, step, written, multi }) =>
      ({ exerciseId, text, answer, answerText, given, answerPrefix, canonical, step, written, multi })),
  };
}

// Зірки рівня й розділу показують поточний рівень знань, а не рекорд (issue #3).

export const RECENT_SESSIONS = 3; // скільки останніх сесій рівня визначають його зірки
const LEVEL_WEIGHTS = { 1: 1, 2: 2, 3: 3 }; // бонус за складність в оцінці розділу
const roundHalf = (x) => Math.round(x * 2) / 2;

// Точність → зірки з кроком 0,5: кожні 10% від 40% — пів зірки (90% → 3).
export function starsFromAccuracy(accuracy) {
  if (accuracy == null) return null;
  return Math.max(0, Math.min(3, Math.floor(accuracy * 10 + 1e-9) / 2 - 1.5));
}

// Оцінка розділу (0…3 з кроком 0,5) за зірками рівнів { 1: 2.5, 2: null, 3: 3 }
// (null — рівень не розпочато):
//   1) покриття знизу: нерозпочатий рівень під пройденим складнішим бере оцінку
//      найближчого складнішого; рівні вище за найскладніший пройдений не враховуються;
//   2) зважене середнє (ваги 1 / 2 / 3), округлення до 0,5;
//   3) стеля за доказами: найвищий рівень розділу + ще один пройдений → 3;
//      лише найвищий або найвищий-1 разом з іншим → 2,5; інакше → 2.
export function topicRating(levelStars, levels = [1, 2, 3]) {
  const done = levels.filter((l) => levelStars[l] != null);
  if (!done.length) return null;
  const top = Math.max(...done);
  const highest = Math.max(...levels);
  const effective = levels
    .filter((l) => l <= top)
    .map((l) => [l, levelStars[l] ?? levelStars[Math.min(...done.filter((h) => h > l))]]);
  const weight = (l) => LEVEL_WEIGHTS[l] ?? l;
  const avg = effective.reduce((acc, [l, s]) => acc + s * weight(l), 0) / effective.reduce((acc, [l]) => acc + weight(l), 0);
  const confirmed = done.length > 1;
  const cap = top === highest ? (confirmed ? 3 : 2.5) : top === highest - 1 && confirmed ? 2.5 : 2;
  return Math.min(roundHalf(avg), cap);
}

// Статистика одного рівня розділу.
//   sessions, accuracy — накопичувально за всі сесії рівня;
//   stars              — зірки за останніми RECENT_SESSIONS сесіями (крок 0,5);
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
  const recent = own.slice(-RECENT_SESSIONS);
  const recentTotal = recent.reduce((acc, r) => acc + r.total, 0);
  const recentCorrect = recent.reduce((acc, r) => acc + r.correct, 0);
  return {
    sessions: own.length,
    accuracy: total ? correct / total : null,
    stars: recentTotal ? starsFromAccuracy(recentCorrect / recentTotal) : null,
    lastAvgMs: last?.avgMs ?? null,
    prevAvgMs: prev?.avgMs ?? null,
    previous: prev ?? null,
    lastAt: last?.finishedAt ?? null,
  };
}

// Підсумок по розділу для картки на головному екрані: оцінка розділу (topicRating)
// із зірок рівнів, кількість сесій і дата останньої.
export function topicProgress(records, topicId, levels = [1, 2, 3]) {
  const own = records.filter((r) => r.topicId === topicId);
  const levelStars = Object.fromEntries(levels.map((l) => [l, levelProgress(records, topicId, l).stars]));
  return {
    sessions: own.length,
    levelStars,
    rating: topicRating(levelStars, levels),
    lastAt: own.length ? Math.max(...own.map((r) => r.finishedAt)) : null,
  };
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

// Простій закріпленого розділу: скільки календарних днів без тренувань.
// Нерозпочатий розділ (lastAt = null) простоєм не вважається.
export const STALE_DAYS = { warn: 4, alert: 10 };

export function staleness(lastAt, now = Date.now()) {
  if (lastAt == null) return null;
  const days = calendarDaysBetween(lastAt, now);
  return days >= STALE_DAYS.alert ? 'alert' : days >= STALE_DAYS.warn ? 'warn' : null;
}

// Найгірший простій серед кількох розділів ('alert' > 'warn' > null).
export const worstStaleness = (levels) => (levels.includes('alert') ? 'alert' : levels.includes('warn') ? 'warn' : null);

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
