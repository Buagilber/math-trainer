// Перевірка контенту: структура розділу і «пробна генерація» кожного завдання.
// Помилки показуються в консолі та на екрані, щоб автор контенту одразу
// бачив, що зламалося, а зламане завдання просто пропускалось.

import { generateInstance, GENERATORS } from './generators.js';
import { createRng } from './rng.js';
import { hintProblems } from './hints.js';

// Скільки цифр можна ввести у відповідь (обмеження екранної клавіатури).
export const MAX_ANSWER_DIGITS = 7;

export function validateTopic(topic, { samples = 20 } = {}) {
  const errors = [];
  if (!topic || typeof topic !== 'object') return { topic: null, errors: ['Розділ не є об’єктом'] };
  if (!topic.id) errors.push('Немає поля id');
  if (!topic.title) errors.push(`${topic.id}: немає поля title`);
  if (!Array.isArray(topic.exercises)) {
    errors.push(`${topic.id}: немає масиву exercises`);
    return { topic: null, errors };
  }

  // Некоректна підказка не ламає завдання — просто не показується.
  const checkHint = (owner, where) => {
    const problems = hintProblems(owner.hint);
    if (!problems.length) return owner;
    errors.push(...problems.map((p) => `${where}: ${p}`));
    return { ...owner, hint: undefined };
  };
  topic = checkHint(topic, topic.id);

  const ids = new Set();
  const goodExercises = [];
  const rng = createRng(1);
  for (const ex of topic.exercises) {
    const where = `${topic.id}/${ex.id ?? '?'}`;
    if (!ex.id) { errors.push(`${where}: немає id`); continue; }
    if (ids.has(ex.id)) { errors.push(`${where}: id повторюється`); continue; }
    ids.add(ex.id);
    if (ex.kind !== 'fixed' && ex.kind !== 'generator') {
      errors.push(`${where}: kind має бути "fixed" або "generator"`); continue;
    }
    if (ex.kind === 'generator' && !GENERATORS[ex.generator]) {
      errors.push(`${where}: невідомий генератор «${ex.generator}»`); continue;
    }
    if (ex.kind === 'fixed' && (ex.text === undefined || ex.answer === undefined)) {
      errors.push(`${where}: для fixed потрібні text і answer`); continue;
    }
    try {
      const n = ex.kind === 'fixed' ? 1 : samples;
      for (let i = 0; i < n; i++) {
        const { answer, answerType } = generateInstance(ex, rng);
        const parts = answerType === 'fraction' ? [answer.whole ?? '', answer.num, answer.den]
          : answerType === 'choice' ? []
          : [String(answer).replace(',', '')];
        if (parts.some((p) => String(p).length > MAX_ANSWER_DIGITS)) {
          throw new Error(`відповідь ${String(answer)} довша за ${MAX_ANSWER_DIGITS} цифр — її неможливо ввести`);
        }
      }
      goodExercises.push(checkHint(ex, where));
    } catch (e) {
      errors.push(`${where}: ${e.message}`);
    }
  }
  return { topic: { ...topic, exercises: goodExercises }, errors };
}
