// Тренувальна сесія: набір із N прикладів з одного розділу і рівня.
// Чисті функції без DOM і сховища — стан передається явно.

import { generateInstance } from './generators.js';

export const DEFAULT_SESSION_SIZE = 10;

// Завдання розділу для рівня складності. Якщо на рівні нічого немає,
// беремо найближчі нижчі рівні.
export function exercisesForLevel(topic, level) {
  const exact = topic.exercises.filter((e) => (e.difficulty ?? 1) === level);
  if (exact.length) return exact;
  return topic.exercises.filter((e) => (e.difficulty ?? 1) <= level);
}

export function levelsOf(topic) {
  return [...new Set(topic.exercises.map((e) => e.difficulty ?? 1))].sort((a, b) => a - b);
}

export function buildSession(topic, level, rng, size = topic.sessionSize ?? DEFAULT_SESSION_SIZE) {
  const pool = exercisesForLevel(topic, level);
  if (!pool.length) throw new Error(`У розділі «${topic.title}» немає завдань рівня ${level}`);

  const items = [];
  const seenTexts = new Set();
  const usedFixed = new Set();
  let guard = size * 20;

  while (items.length < size && guard-- > 0) {
    const available = pool.filter((e) => !(e.kind === 'fixed' && usedFixed.has(e.id)));
    if (!available.length) break;
    const exercise = rng.weighted(available, (e) => e.weight ?? 1);
    const instance = generateInstance(exercise, rng);
    if (seenTexts.has(instance.text) && guard > size) continue; // уникаємо повторів
    if (exercise.kind === 'fixed') usedFixed.add(exercise.id);
    seenTexts.add(instance.text);
    items.push(instance);
  }

  return {
    topicId: topic.id,
    level,
    items,
    index: 0,
    results: [], // { exerciseId, text, answer, given, correct, ms }
  };
}

export function checkAnswer(instance, given) {
  if (given === '' || given === null || given === undefined) return false;
  if (instance.answerType === 'choice') return String(given) === String(instance.answer);
  return Number(given) === instance.answer;
}

// Повертає новий стан сесії та результат відповіді.
export function submitAnswer(session, given, ms = 0) {
  const item = session.items[session.index];
  const correct = checkAnswer(item, given);
  const result = {
    exerciseId: item.exerciseId,
    text: item.text,
    answer: item.answer,
    given: String(given),
    correct,
    ms,
  };
  return {
    session: { ...session, index: session.index + 1, results: [...session.results, result] },
    result,
  };
}

export const isFinished = (session) => session.index >= session.items.length;

// Зірки за сесію: 3 — від 90%, 2 — від 70%, 1 — від 50%.
export function starsFor(correct, total) {
  if (!total) return 0;
  const share = correct / total;
  if (share >= 0.9) return 3;
  if (share >= 0.7) return 2;
  if (share >= 0.5) return 1;
  return 0;
}

// Час на один приклад обрізаємо до 2 хв: якщо дитина відійшла або згорнула
// застосунок, один такий приклад не має спотворювати середнє.
export const MAX_QUESTION_MS = 120000;

export function averageMs(results) {
  if (!results.length) return null;
  const sum = results.reduce((acc, r) => acc + Math.min(r.ms ?? 0, MAX_QUESTION_MS), 0);
  return Math.round(sum / results.length);
}

export function summarize(session) {
  const total = session.results.length;
  const correct = session.results.filter((r) => r.correct).length;
  return {
    total,
    correct,
    stars: starsFor(correct, total),
    avgMs: averageMs(session.results),
    mistakes: session.results.filter((r) => !r.correct),
  };
}
