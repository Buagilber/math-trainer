// Тренувальна сесія: набір із N прикладів з одного розділу і рівня.
// Чисті функції без DOM і сховища — стан передається явно.

import { generateInstance } from './generators.js';
import { parseDecimal, decimalsEqual, fractionsEqual, formatFraction } from './numbers.js';

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
    // Підказка: своя в завдання або запасна з розділу.
    const instance = { ...generateInstance(exercise, rng), hint: exercise.hint ?? topic.hint, hintAfterSec: exercise.hintAfterSec };
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

// Типи відповіді:
//   number   — ціле число (answer: 42);
//   decimal  — десятковий дріб (answer: "12,35"), зараховується і «12,350»;
//   fraction — звичайний дріб (answer: { num, den } або { whole, num, den }).
//              Рівні дроби зараховуються (2/4 = 1/2). Якщо очікується мішане
//              число, ціла частина має збігатися, а дробова — бути правильною;
//   choice   — один з варіантів (answer: "<").
// given для fraction — { whole, num, den } (рядки з поля вводу), для решти — рядок.

const toInt = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

export function checkAnswer(instance, given) {
  if (given === '' || given === null || given === undefined) return false;
  switch (instance.answerType) {
    case 'choice':
      return String(given) === String(instance.answer);
    case 'decimal': {
      const g = parseDecimal(given);
      const a = parseDecimal(instance.answer);
      return !!g && !!a && decimalsEqual(g, a);
    }
    case 'fraction': {
      const g = { whole: toInt(given.whole), num: toInt(given.num), den: toInt(given.den) };
      if (g.num === null || !g.den) return false;
      const a = instance.answer;
      if (a.whole) {
        if (g.whole !== a.whole || g.num >= g.den) return false;
      } else if (g.whole) {
        return false;
      }
      return fractionsEqual({ ...g, whole: g.whole ?? 0 }, a);
    }
    default:
      return Number(given) === instance.answer;
  }
}

// Відповідь у вигляді тексту для екрана й журналу: «1 2/7», «12,35», «42».
export function formatAnswer(answerType, value) {
  if (answerType === 'fraction' && value && typeof value === 'object') {
    return formatFraction({ whole: toInt(value.whole), num: value.num, den: value.den });
  }
  return String(value ?? '');
}

// Повертає новий стан сесії та результат відповіді.
// step — обраний варіант кроку «Обрати дію» ({ left, sign, right, correct }) або null.
export function submitAnswer(session, given, ms = 0, { hintUsed = false, step = null } = {}) {
  const item = session.items[session.index];
  const correct = checkAnswer(item, given);
  const result = {
    exerciseId: item.exerciseId,
    text: item.text,
    answer: item.answer,
    answerText: formatAnswer(item.answerType, item.answer),
    given: formatAnswer(item.answerType, given),
    correct,
    ms,
    hintUsed,
    // Для рівнянь: підпис («x =»), правильна й обрана дія — щоб у підсумку
    // показати, де саме помилка.
    answerPrefix: item.answerPrefix,
    canonical: item.steps?.canonical,
    step: step ? { left: step.left, sign: step.sign, right: step.right, correct: step.correct } : null,
    stepUsed: !!step,
    stepCorrect: step ? step.correct : null,
    // Чи правильно пораховано обрану дію (навіть якщо сама дія неправильна).
    stepCalcCorrect: step ? Number(given) === step.value : null,
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

// Діагностика нерозв'язаних рівнянь із кроком «Обрати дію». Кожен нерозв'язаний
// приклад потрапляє рівно в одну категорію, тож сума категорій = кількість помилок:
//   method — неправильна дія, але пораховано її правильно;
//   calc   — дія правильна, помилка в обчисленні;
//   both   — і дія неправильна, і пораховано з помилкою;
//   noStep — відповідь одразу, без вибору дії (причину не знаємо).
// used — чи обирали дію хоча б раз (інакше рядок у підсумку не потрібен).
export function stepStats(results) {
  const wrong = results.filter((r) => !r.correct);
  return {
    used: results.some((r) => r.stepUsed),
    method: wrong.filter((r) => r.stepUsed && !r.stepCorrect && r.stepCalcCorrect).length,
    calc: wrong.filter((r) => r.stepUsed && r.stepCorrect).length,
    both: wrong.filter((r) => r.stepUsed && !r.stepCorrect && !r.stepCalcCorrect).length,
    noStep: wrong.filter((r) => !r.stepUsed).length,
  };
}

export function summarize(session) {
  const total = session.results.length;
  const correct = session.results.filter((r) => r.correct).length;
  return {
    total,
    correct,
    stars: starsFor(correct, total),
    avgMs: averageMs(session.results),
    hintsUsed: session.results.filter((r) => r.hintUsed).length,
    stepStats: stepStats(session.results),
    mistakes: session.results.filter((r) => !r.correct),
  };
}
