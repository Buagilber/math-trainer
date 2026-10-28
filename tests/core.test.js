// Тести core-логіки. Запуск: відкрити tests/index.html через локальний сервер.
// Тести — також «виконувана специфікація» для майбутньої мобільної реалізації.

import { createRng } from '../js/core/rng.js';
import { evaluate, formatExpression } from '../js/core/expr.js';
import { generateInstance, fillText, pluralUk } from '../js/core/generators.js';
import { buildSession, submitAnswer, isFinished, summarize, starsFor, checkAnswer, MAX_QUESTION_MS } from '../js/core/session.js';
import { topicProgress, levelProgress, compareTime, compareWithPrevious, sessionRecord } from '../js/core/progress.js';
import { validateTopic } from '../js/core/validate.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
const eq = (a, b, msg = '') => assert(JSON.stringify(a) === JSON.stringify(b), `${msg} очікували ${JSON.stringify(b)}, отримали ${JSON.stringify(a)}`);

// Розбір «12 + 5 = □» → перевірка, що підстановка відповіді дає вірну рівність.
function solves(instance) {
  const text = instance.text.replace('□', String(instance.answer)).replace(/−/g, '-').replace(/×/g, '*').replace(/:/g, '/');
  const [l, r] = text.split('=');
  return evaluate(l).value === evaluate(r).value;
}

test('rng детермінований', () => {
  const a = createRng(42), b = createRng(42);
  eq([a.next(), a.next()], [b.next(), b.next()]);
  const r = createRng(7);
  for (let i = 0; i < 200; i++) { const v = r.int(10, 90, 10); assert(v >= 10 && v <= 90 && v % 10 === 0); }
});

test('expr: пріоритет і дужки', () => {
  eq(evaluate('2 + 3 * 4').value, 14);
  eq(evaluate('(2 + 3) * 4').value, 20);
  eq(evaluate('a - (b + c)', { a: 50, b: 10, c: 5 }).value, 35);
  eq(evaluate('a > b', { a: 3, b: 2 }).value, true);
  eq(evaluate('7 / 2').valid, false);
  eq(evaluate('8 / 2').steps, [4]);
});

test('expr: шкільний запис', () => {
  eq(formatExpression('a * (b - c) / 2', { a: 3, b: 9, c: 1 }), '3 × (9 − 1) : 2');
});

test('множина українською', () => {
  eq([1, 2, 5, 11, 12, 21, 22, 25].map((n) => pluralUk(n, 'яблуко', 'яблука', 'яблук')),
    ['яблуко', 'яблука', 'яблук', 'яблук', 'яблук', 'яблуко', 'яблука', 'яблук']);
  eq(fillText('{a} {a|гриб|гриби|грибів}, {a + 1}, {=a * 2}', { a: 3 }), '3 гриби, 4, 3 × 2');
});

test('arithmetic: без переходу через десяток', () => {
  const rng = createRng(1);
  const ex = { id: 'x', kind: 'generator', generator: 'arithmetic', params: { op: ['+', '-'], a: [11, 89], b: [11, 89], result: [0, 100], carry: 'forbidden' } };
  for (let i = 0; i < 300; i++) {
    const it = generateInstance(ex, rng);
    assert(solves(it), it.text);
    const [a, , b] = it.text.split(' ').map(Number);
    const plus = it.text.includes('+');
    assert(plus ? (a % 10) + (b % 10) < 10 : a % 10 >= b % 10, `перехід у ${it.text}`);
    assert(it.answer >= 0 && it.answer <= 100);
  }
});

test('arithmetic: з переходом, пропущений компонент', () => {
  const rng = createRng(2);
  const ex = { id: 'x', kind: 'generator', generator: 'arithmetic', params: { op: ['+', '-'], a: [11, 89], b: [2, 9], result: [0, 100], carry: 'required', missing: 'operand' } };
  for (let i = 0; i < 300; i++) {
    const it = generateInstance(ex, rng);
    assert(solves(it), it.text);
    assert(!it.text.endsWith('□'), 'пропущено має бути a або b');
  }
});

test('arithmetic: ділення без остачі', () => {
  const rng = createRng(3);
  const ex = { id: 'x', kind: 'generator', generator: 'arithmetic', params: { op: '/', b: [2, 5], result: [1, 10], missing: 'any' } };
  for (let i = 0; i < 300; i++) assert(solves(generateInstance(ex, rng)));
});

test('compare: правильний знак', () => {
  const rng = createRng(4);
  const ex = { id: 'x', kind: 'generator', generator: 'compare', params: { left: { expr: 'a + b', vars: { a: [10, 60], b: [1, 30] } }, right: { near: 5 } } };
  for (let i = 0; i < 300; i++) {
    const it = generateInstance(ex, rng);
    const [l, r] = it.text.replace(/−/g, '-').split('□');
    const lv = evaluate(l).value, rv = evaluate(r).value;
    eq(it.answer, lv < rv ? '<' : lv > rv ? '>' : '=', it.text);
  }
});

test('expression: проміжні результати в межах 100', () => {
  const rng = createRng(5);
  const ex = { id: 'x', kind: 'generator', generator: 'expression', params: { expr: ['a - (b + c)', 'a * b + c'], vars: { a: [2, 80], b: [2, 30], c: [1, 30] }, result: [0, 100], steps: [0, 100] } };
  for (let i = 0; i < 300; i++) {
    const it = generateInstance(ex, rng);
    assert(solves(it), it.text);
  }
});

test('template: умови where і відповідь', () => {
  const rng = createRng(6);
  const ex = { id: 'x', kind: 'generator', generator: 'template', params: { text: 'Було {a}, взяли {b}.', vars: { a: [1, 20], b: [1, 20] }, where: ['a > b'], answer: 'a - b' } };
  for (let i = 0; i < 300; i++) {
    const it = generateInstance(ex, rng);
    const [a, b] = it.text.match(/\d+/g).map(Number);
    assert(a > b); eq(it.answer, a - b);
  }
});

test('fixed і choice', () => {
  const rng = createRng(7);
  eq(generateInstance({ id: 'f', kind: 'fixed', text: '1 м = □ см', answer: 100 }, rng).answer, 100);
  const c = generateInstance({ id: 'c', kind: 'fixed', text: '5 □ 3', answer: '>', choices: ['<', '=', '>'] }, rng);
  assert(checkAnswer(c, '>') && !checkAnswer(c, '<'));
});

const TOPIC = {
  id: 't', title: 'Т', sessionSize: 10,
  exercises: [
    { id: 'e1', kind: 'generator', generator: 'arithmetic', difficulty: 1, params: { op: '+', a: [1, 9], b: [1, 9] } },
    { id: 'e2', kind: 'fixed', difficulty: 2, text: '2 + 2 = □', answer: 4 },
  ],
};

test('сесія: повний цикл', () => {
  let s = buildSession(TOPIC, 1, createRng(8));
  eq(s.items.length, 10);
  assert(new Set(s.items.map((i) => i.text)).size === 10, 'приклади не повторюються');
  let n = 0;
  while (!isFinished(s)) {
    const item = s.items[s.index];
    ({ session: s } = submitAnswer(s, n++ % 2 ? item.answer : item.answer + 1));
  }
  const sum = summarize(s);
  eq([sum.total, sum.correct, sum.stars, sum.mistakes.length], [10, 5, 1, 5]);
});

test('сесія: fixed не повторюються, рівень без завдань → нижчі', () => {
  const s = buildSession(TOPIC, 2, createRng(9));
  eq(s.items.length, 1);
  const s3 = buildSession(TOPIC, 3, createRng(9));
  assert(s3.items.length === 10);
});

test('зірки й прогрес', () => {
  eq([starsFor(10, 10), starsFor(7, 10), starsFor(5, 10), starsFor(4, 10)], [3, 2, 1, 0]);
  let s = buildSession(TOPIC, 1, createRng(10));
  while (!isFinished(s)) ({ session: s } = submitAnswer(s, s.items[s.index].answer));
  const rec = sessionRecord(s, { startedAt: 1, finishedAt: 2 });
  const p = topicProgress([rec, { ...rec, level: 2, stars: 1, correct: 5 }], 't');
  eq(p.sessions, 2); eq(p.bestStars, { 1: 3, 2: 1 });
});

test('середній час: за прикладом, з обрізанням довгих пауз', () => {
  let s = buildSession(TOPIC, 1, createRng(11), 4);
  for (const ms of [2000, 4000, 6000, 10 * 60 * 1000]) ({ session: s } = submitAnswer(s, s.items[s.index].answer, ms));
  eq(summarize(s).avgMs, Math.round((2000 + 4000 + 6000 + MAX_QUESTION_MS) / 4));
});

test('статистика рівня: накопичувально + час останньої та попередньої сесії', () => {
  const base = { topicId: 't', total: 10, stars: 1 };
  const records = [
    { ...base, level: 1, finishedAt: 3, correct: 9, avgMs: 5000 },
    { ...base, level: 1, finishedAt: 1, correct: 5, avgMs: 9000 },
    { ...base, level: 2, finishedAt: 2, correct: 1, avgMs: 1000 },
    { ...base, level: 1, finishedAt: 2, correct: 7, avgMs: 7000 },
  ];
  const p = levelProgress(records, 't', 1);
  eq([p.sessions, p.accuracy, p.lastAvgMs, p.prevAvgMs], [3, 0.7, 5000, 7000]);
  eq(levelProgress(records, 't', 3), { sessions: 0, accuracy: null, bestStars: 0, lastAvgMs: null, prevAvgMs: null, previous: null });
  eq(levelProgress(records, 't', 1).previous.finishedAt, 2);
  eq(compareTime(5000, 7000).trend, 'faster');
  eq(compareTime(7000, 5000).trend, 'slower');
  eq(compareTime(5050, 5000).trend, 'same');
  eq(compareTime(5000, null), null);
});

test('порівняння з попередньою сесією: швидкість лише якщо точність не впала', () => {
  const prev = { total: 10, correct: 7, avgMs: 5000 };
  const up = compareWithPrevious({ total: 10, correct: 9, avgMs: 6000 }, prev);
  eq([up.accuracy.trend, up.accuracy.diffPct, up.speed.trend], ['up', 20, 'slower']);
  const same = compareWithPrevious({ total: 10, correct: 7, avgMs: 4000 }, prev);
  eq([same.accuracy.trend, same.speed.trend], ['same', 'faster']);
  const down = compareWithPrevious({ total: 10, correct: 3, avgMs: 1000 }, prev);
  eq([down.accuracy.trend, down.accuracy.diffPct, down.speed], ['down', -40, null]);
  eq(compareWithPrevious({ total: 10, correct: 5, avgMs: 1 }, null).first, true);
  eq(compareWithPrevious({ total: 10, correct: 7, avgMs: 4000 }, { total: 10, correct: 7 }).speed, null); // старий запис без часу
});

test('валідація відсіює зламані завдання', () => {
  const { topic, errors } = validateTopic({
    id: 'bad', title: 'B', exercises: [
      { id: 'ok', kind: 'fixed', text: 'x', answer: 1 },
      { id: 'ok', kind: 'fixed', text: 'x', answer: 1 },
      { id: 'g', kind: 'generator', generator: 'nope' },
      { id: 'imp', kind: 'generator', generator: 'arithmetic', params: { op: '+', a: [1, 2], b: [1, 2], carry: 'required' } },
    ],
  });
  eq(topic.exercises.map((e) => e.id), ['ok']);
  eq(errors.length, 3);
  const long = validateTopic({ id: 'l', title: 'L', exercises: [{ id: 'big', kind: 'fixed', text: '□', answer: 12345678 }] });
  eq([long.topic.exercises.length, long.errors.length], [0, 1]);
});

test('весь контент з data/ валідний', async () => {
  const catalog = await (await fetch('../data/catalog.json')).json();
  for (const g of catalog.grades) {
    for (const path of g.topics) {
      const raw = await (await fetch(`../data/${path}`)).json();
      const { topic, errors } = validateTopic(raw, { samples: 200 });
      assert(!errors.length, `${path}: ${errors.join('; ')}`);
      for (const level of [1, 2, 3]) buildSession(topic, level, createRng(level));
    }
  }
});

export async function run() {
  const results = [];
  for (const t of tests) {
    try { await t.fn(); results.push({ name: t.name, ok: true }); }
    catch (e) { results.push({ name: t.name, ok: false, error: e.message }); }
  }
  return results;
}
