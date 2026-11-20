// Тести core-логіки. Запуск: відкрити tests/index.html через локальний сервер.
// Тести — також «виконувана специфікація» для майбутньої мобільної реалізації.

import { createRng } from '../js/core/rng.js';
import { evaluate, formatExpression } from '../js/core/expr.js';
import { generateInstance, fillText, pluralUk, STEPS_MIN_DIGITS, divisionSteps, defaultPrompt, actionSteps, isRecordTask } from '../js/core/generators.js';
import { buildSession, submitAnswer, isFinished, summarize, starsFor, checkAnswer, formatAnswer, MAX_QUESTION_MS } from '../js/core/session.js';
import { formatDecimal, parseDecimal, compareDecimals } from '../js/core/numbers.js';
import { hintDelayMs, shouldOfferHint, normalizeHint, hintProblems } from '../js/core/hints.js';
import { applyKey, isComplete, mathHtml, columnHtml, divisionHtml } from '../js/app/answer-input.js';
import { formatAgo } from '../js/app/format.js';
import { contextText, issueUrl } from '../js/app/feedback.js';
import { topicProgress, levelProgress, compareTime, compareWithPrevious, sessionRecord, starsFromAccuracy, topicRating, staleness, worstStaleness } from '../js/core/progress.js';
import { validateTopic } from '../js/core/validate.js';
import { longDivision, quotientOf, divisionRows } from '../js/core/long-division.js';
import { longMultiplication } from '../js/core/long-multiplication.js';

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
  eq(p.sessions, 2);
  eq(p.levelStars, { 1: 3, 2: 1, 3: null }, 'рівень 1: 10/10 → 3; рівень 2: 5/10 → 1');
  eq(p.rating, 1.5, '(3·1 + 1·2) / 3 = 1,67 → 1,5 (стеля 2,5 не обмежує)');
});

test('зірки рівня: останні 3 сесії, крок 0,5', () => {
  eq([0.95, 0.9, 0.85, 0.8, 0.7, 0.63, 0.5, 0.45, 0.4, 0.39, 0, 1].map(starsFromAccuracy), [3, 3, 2.5, 2.5, 2, 1.5, 1, 0.5, 0.5, 0, 0, 3]);
  const rec = (finishedAt, correct) => ({ topicId: 't', level: 1, finishedAt, total: 10, correct, stars: 0 });
  // Рекорд 10/10 давно, а останні 3 сесії — 5, 6, 8 з 10 → 19/30 = 63% → 1,5.
  const records = [rec(1, 10), rec(2, 5), rec(3, 6), rec(4, 8)];
  const p = levelProgress(records, 't', 1);
  eq([p.stars, p.sessions, Math.round(p.accuracy * 100)], [1.5, 4, 73]);
});

test('оцінка розділу: покриття знизу, ваги, стеля', () => {
  const r = (e, m, h) => topicRating({ 1: e, 2: m, 3: h });
  eq(r(null, 3, 3), 3, '– / 3 / 3');
  eq(r(3, null, 3), 3, '3 / – / 3');
  eq(r(null, null, 3), 2.5, '– / – / 3');
  eq(r(3, null, null), 2, '3 / – / –');
  eq(r(null, 3, null), 2, '– / 3 / –');
  eq(r(3, 3, null), 2.5, '3 / 3 / –');
  eq(r(2, 2, 3), 2.5, '2 / 2 / 3');
  eq(r(0, 1, 3), 2, '0 / 1 / 3');
  eq(r(1, null, 3), 2.5, '1 / – / 3');
  eq(r(3, 3, 3), 3, '3 / 3 / 3');
  eq(r(1, null, null), 1, '1 / – / –');
  eq(r(null, null, null), null, 'нічого не пройдено');
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
  eq(levelProgress(records, 't', 3), { sessions: 0, accuracy: null, stars: null, lastAvgMs: null, prevAvgMs: null, previous: null, lastAt: null });
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

test('десяткові: запис, розбір, порівняння', () => {
  eq(formatDecimal({ units: 235, scale: 2 }), '2,35');
  eq(formatDecimal({ units: 5, scale: 2 }), '0,05');
  eq(formatDecimal({ units: 350, scale: 2 }), '3,50');
  eq(parseDecimal('12,50'), { units: 125, scale: 1 });
  eq(parseDecimal('12.5'), { units: 125, scale: 1 });
  eq([parseDecimal('1,'), parseDecimal(',5'), parseDecimal('a')], [null, null, null]);
  assert(compareDecimals(parseDecimal('3,5'), parseDecimal('3,48')) > 0);
});

const decVal = (s) => { const d = parseDecimal(s.trim()); return d.units / 10 ** d.scale; };

test('decimal: дії, округлення, порівняння', () => {
  const rng = createRng(21);
  const ops = { id: 'd', kind: 'generator', generator: 'decimal', params: { op: ['+', '-', '*'], a: [11, 99], aScale: 1, b: [11, 99], bScale: 2, range: [0, 100] } };
  for (let i = 0; i < 300; i++) {
    const it = generateInstance(ops, rng);
    const [a, sign, b] = it.text.split(' ');
    const expect = sign === '+' ? decVal(a) + decVal(b) : sign === '−' ? decVal(a) - decVal(b) : decVal(a) * decVal(b);
    assert(Math.abs(decVal(it.answer) - expect) < 1e-9, `${it.text} ${it.answer}`);
    assert(!/,\d*0$/.test(it.answer), `зайвий нуль у ${it.answer}`);
  }
  const div = { id: 'v', kind: 'generator', generator: 'decimal', params: { op: '/', b: [2, 9], result: [11, 99], aScale: 1 } };
  for (let i = 0; i < 200; i++) {
    const it = generateInstance(div, rng);
    const [a, , b] = it.text.split(' ');
    assert(Math.abs(decVal(a) / Number(b) - decVal(it.answer)) < 1e-9, it.text);
  }
  const round = { id: 'r', kind: 'generator', generator: 'decimal', params: { op: 'round', a: [101, 999], aScale: 2, to: 1, label: 'десятих' } };
  for (let i = 0; i < 200; i++) {
    const it = generateInstance(round, rng);
    const a = decVal(it.text.split(': ')[1].split(' ≈')[0]);
    assert(Math.abs(Math.round(a * 10 + 1e-9) / 10 - decVal(it.answer)) < 1e-9, `${it.text} ${it.answer}`);
  }
  const cmp = { id: 'c', kind: 'generator', generator: 'decimal', params: { op: 'compare', a: [10, 99], aScale: 1, bScale: 2, near: 20 } };
  for (let i = 0; i < 200; i++) {
    const it = generateInstance(cmp, rng);
    const [l, r] = it.text.split(' □ ').map(decVal);
    eq(it.answer, l < r ? '<' : l > r ? '>' : '=', it.text);
  }
  assert(checkAnswer({ answerType: 'decimal', answer: '2,5' }, '2,50'));
  assert(!checkAnswer({ answerType: 'decimal', answer: '2,5' }, '25'));
});

test('fraction: генерація і перевірка', () => {
  const rng = createRng(22);
  const ex = { id: 'f', kind: 'generator', generator: 'fraction', params: { mode: ['add', 'sub', 'toMixed', 'toImproper', 'addMixed', 'subMixed'], den: [3, 12], carry: true } };
  for (let i = 0; i < 300; i++) {
    const it = generateInstance(ex, rng);
    const a = it.answer;
    assert(a.num > 0 && a.num < (a.whole ? a.den : Infinity), JSON.stringify(it));
    assert(checkAnswer(it, { whole: a.whole ? String(a.whole) : '', num: String(a.num), den: String(a.den) }), it.text);
  }
  const mixed = { answerType: 'fraction', answer: { whole: 1, num: 2, den: 4 } };
  assert(checkAnswer(mixed, { whole: '1', num: '1', den: '2' }), 'рівні дроби зараховуються');
  assert(!checkAnswer(mixed, { whole: '', num: '6', den: '4' }), 'мішане число обов’язкове');
  assert(!checkAnswer(mixed, { whole: '0', num: '6', den: '4' }), 'дробова частина має бути правильною');
  const proper = { answerType: 'fraction', answer: { num: 5, den: 7 } };
  assert(checkAnswer(proper, { whole: '', num: '10', den: '14' }));
  assert(!checkAnswer(proper, { whole: '', num: '5', den: '' }));
  eq(formatAnswer('fraction', { whole: 2, num: 1, den: 3 }), '2 1/3');
  const cmp = generateInstance({ id: 'c', kind: 'generator', generator: 'fraction', params: { mode: 'compare', den: [5, 9] } }, rng);
  eq(cmp.answerType, 'choice');
});

test('template з вибором відповіді', () => {
  const rng = createRng(23);
  const ex = { id: 't', kind: 'generator', generator: 'template', params: { text: 'Чи ділиться {n} на 3?', vars: { n: [10, 99] }, answer: 'n % 3 == 0', choices: ['Так', 'Ні'] } };
  for (let i = 0; i < 100; i++) {
    const it = generateInstance(ex, rng);
    const n = Number(it.text.match(/\d+/)[0]);
    eq(it.answer, n % 3 === 0 ? 'Так' : 'Ні', it.text);
  }
  eq(generateInstance({ id: 'i', kind: 'generator', generator: 'template', params: { text: '7', vars: {}, answer: '1', choices: ['просте', 'складене'] } }, rng).answer, 'складене');
});

test('підказки: поріг появи', () => {
  const inline = { text: '2 + 3 = □', hint: 'h' };
  const textTask = { text: 'Задача без поля', hint: 'h' };
  eq([1, 2, 3].map((l) => hintDelayMs(inline, l)), [10000, 12000, 15000], 'фіксовано за рівнем');
  eq(hintDelayMs(textTask, 1), 15000, 'текстова задача +5 с');
  eq(hintDelayMs({ ...inline, hintAfterSec: 7 }, 3), 7000, 'свій поріг завдання');
  const base = { item: inline, elapsedMs: 16000, sinceInputMs: 0, inputEmpty: true, delayMs: 15000 };
  assert(shouldOfferHint(base));
  assert(!shouldOfferHint({ ...base, elapsedMs: 10000 }), 'ще рано');
  assert(!shouldOfferHint({ ...base, inputEmpty: false, sinceInputMs: 3000 }), 'дитина вводить відповідь');
  assert(shouldOfferHint({ ...base, inputEmpty: false, sinceInputMs: 9000 }), 'поле давно не змінювалось');
  assert(!shouldOfferHint({ ...base, item: { text: 'x = □' } }), 'без тексту підказки кнопки немає');
});

test('підказки: у сесії, лічильник, валідація', () => {
  const topic = { id: 't', title: 'T', hint: 'розділ', exercises: [
    { id: 'a', kind: 'fixed', text: '1 + 1 = □', answer: 2, hint: 'своя' },
    { id: 'b', kind: 'fixed', text: '2 + 2 = □', answer: 4 },
  ] };
  let s = buildSession(topic, 1, createRng(3), 2);
  eq(s.items.map((i) => i.hint).sort(), ['розділ', 'своя']);
  ({ session: s } = submitAnswer(s, s.items[0].answer, 1000, { hintUsed: true }));
  ({ session: s } = submitAnswer(s, s.items[1].answer, 1000));
  eq([summarize(s).hintsUsed, summarize(s).stars], [1, 3], 'зірки не знімаються');
  const long = validateTopic({ ...topic, exercises: [{ ...topic.exercises[0], hint: 'х'.repeat(201) }] });
  eq([long.topic.exercises.length, long.topic.exercises[0].hint, long.errors.length], [1, undefined, 1]);
});

test('підказки: правила й схема', () => {
  eq(normalizeHint('просто текст'), { rules: ['просто текст'], scheme: [] });
  eq(normalizeHint({ rules: ['a'], scheme: ['b'] }), { rules: ['a'], scheme: ['b'] });
  eq(normalizeHint(undefined), null);
  eq(hintProblems({ rules: ['a', 'b'], scheme: ['c'] }), []);
  eq(hintProblems({ rules: [] }).length, 1, 'потрібне хоча б одне правило');
  eq(hintProblems({ rules: ['1', '2', '3', '4', '5'] }).length, 1, 'не більше 4 правил');
  eq(hintProblems({ rules: ['х'.repeat(121)] }).length, 1, 'рядок до 120 символів');
  eq(hintProblems(42).length, 1);
});

test('запис стовпчиком', () => {
  const rng = createRng(41);
  const col = { id: 'c', kind: 'generator', generator: 'arithmetic', params: { op: ['+', '-', '*'], a: [1000, 9999], b: [10, 999], result: [0, 99999], layout: 'column' } };
  for (let i = 0; i < 50; i++) {
    const it = generateInstance(col, rng);
    const [a, sign, b] = it.text.split(' ');
    eq(it.column, { rows: [a, b], sign, align: 'right' }, it.text);
  }
  const noLayout = generateInstance({ ...col, params: { ...col.params, layout: undefined } }, rng);
  eq(noLayout.column, undefined, 'без layout — у рядок');
  const missing = generateInstance({ ...col, params: { ...col.params, missing: 'a' } }, rng);
  eq(missing.column, undefined, 'з невідомим компонентом — у рядок');
  const div = generateInstance({ id: 'd', kind: 'generator', generator: 'arithmetic', params: { op: '/', b: [2, 9], result: [10, 99], layout: 'column' } }, rng);
  eq(div.column?.kind, 'divide', 'ділення — кутом');
  const dec = generateInstance({ id: 'x', kind: 'generator', generator: 'decimal', params: { op: '+', a: [11, 99], aScale: 1, b: [101, 999], bScale: 2, layout: 'column' } }, rng);
  eq([dec.column.align, dec.column.rows.length], ['comma', 2]);
  const decMul = generateInstance({ id: 'y', kind: 'generator', generator: 'decimal', params: { op: '*', a: [11, 99], aScale: 1, b: [2, 9], bScale: 0, layout: 'column' } }, rng);
  eq(decMul.column.align, 'right');
});

test('введення справа наліво (стовпчик)', () => {
  const num = { answerType: 'number' };
  const type = (item, keys, rtl) => keys.reduce((v, k) => applyKey(item, v, k, { rtl }), '');
  eq(type(num, ['0', '7', '8', '7', '8'], true), '87870', 'нуль першим дозволений');
  eq(type(num, ['5', '4', 'del'], true), '5', '⌫ стирає крайню ліву');
  eq(type(num, ['0', '7'], false), '7', 'зліва направо — без нуля попереду');
  const dec = { answerType: 'decimal' };
  eq(type(dec, ['2', '4', ',', '5'], true), '5,42');
  eq(type(dec, [','], true), '', 'кома в порожньому полі — нічого');
  assert(!isComplete(dec, ',42') && isComplete(dec, '5,42') && !isComplete(dec, '5,'));
  assert(checkAnswer({ answerType: 'number', answer: 87870 }, '087870'), 'нуль зліва не заважає');
});

test('рівняння з x і позначення класу', () => {
  const rng = createRng(51);
  const ex = { id: 'e', kind: 'generator', generator: 'arithmetic', params: { op: ['+', '-'], a: [100, 999], b: [10, 500], result: [0, 9999], missing: 'operand', unknown: 'x' } };
  for (let i = 0; i < 50; i++) {
    const it = generateInstance(ex, rng);
    assert(it.text.includes('x') && !it.text.includes('□'), it.text);
    eq(it.answerPrefix, 'x =');
    const vars = { x: it.answer };
    const [l, r] = it.text.replace(/−/g, '-').split('=');
    eq(evaluate(l, vars).value, evaluate(r, vars).value, it.text);
  }
  const res = generateInstance({ ...ex, params: { ...ex.params, missing: 'result' } }, rng);
  assert(res.text.endsWith('□') && !res.answerPrefix, 'невідомий результат — як і раніше, поле □');
  eq(mathHtml('3 × 4 = 12', { times: '·' }), '3\u00a0· 4\u00a0= 12');
  assert(mathHtml('3 × 4', { ops: true, times: '·' }).includes('op-times">·'));
  const split = mathHtml('14 − 6[4|2] = 14 − {4} − {2} = 8');
  assert(split.includes('class="split"') && split.includes('<span>4</span><span>2</span>') && !split.includes('[') && !split.includes('{') && split.includes('split-part">4<'), 'розклад числа');
});

test('крок «Обрати дію» в рівняннях', () => {
  const rng = createRng(61);
  const val = (o) => ({ '+': o.left + o.right, '-': o.left - o.right, '*': o.left * o.right, '/': o.left / o.right })[o.op];
  for (const op of ['+', '-', '*', '/']) {
    const ex = { id: 'e', kind: 'generator', generator: 'arithmetic', params: {
      op, a: op === '/' ? undefined : [100, 999], b: op === '*' || op === '/' ? [11, 99] : [100, 999],
      result: op === '/' ? [100, 999] : [0, 99999], missing: 'operand', unknown: 'x', steps: true } };
    for (let i = 0; i < 40; i++) {
      const it = generateInstance(ex, rng);
      const known = it.text.match(/\d+/g).join('');
      if (known.length < STEPS_MIN_DIGITS) { eq(it.steps, undefined, `замалі числа: ${it.text}`); continue; }
      assert(it.steps, `кроки є: ${it.text}`);
      eq(it.steps.options.length, 4, it.text);
      // Правильні — усі варіанти, що дають x: для + і × обидва порядки, для − і : один.
      const correct = it.steps.options.filter((o) => o.correct);
      eq(correct.length, ['+', '*'].includes(it.steps.canonical.op) ? 2 : 1, `кількість правильних: ${it.text}`);
      assert(correct.every((o) => val(o) === it.answer), `правильна дія дає x: ${it.text}`);
      assert(it.steps.options.filter((o) => !o.correct).every((o) => val(o) !== it.answer), `неправильна не дає x: ${it.text}`);
      eq(new Set(it.steps.options.map((o) => `${o.left}${o.op}${o.right}`)).size, 4, 'варіанти різні');
    }
  }
  // Малі числа (разом < 5 цифр) — кроку немає.
  const small = generateInstance({ id: 's', kind: 'generator', generator: 'arithmetic', params: { op: '+', a: [2, 9], b: [2, 9], missing: 'operand', unknown: 'x', steps: true } }, rng);
  eq(small.steps, undefined);
  // Діагностика: помилка у виборі дії vs в обчисленні.
  let s = buildSession(TOPIC, 1, createRng(1), 3);
  const right = () => s.items[s.index].answer;
  // value — що дає обрана дія; дитина вводить своє обчислення.
  const step = (correct, value) => ({ left: 1, sign: '+', right: 2, correct, value });
  s = buildSession(TOPIC, 1, createRng(1), 6);
  ({ session: s } = submitAnswer(s, 999, 0, { step: step(false, 999) }));     // не та дія, пораховано вірно
  ({ session: s } = submitAnswer(s, 998, 0, { step: step(false, 999) }));     // не та дія і помилка в обчисленні
  ({ session: s } = submitAnswer(s, right() + 1, 0, { step: step(true, right()) })); // дія та, обчислення ні
  ({ session: s } = submitAnswer(s, right() + 1, 0));                          // без вибору дії
  ({ session: s } = submitAnswer(s, right(), 0, { step: step(true, right()) }));     // усе правильно
  ({ session: s } = submitAnswer(s, right(), 0));                              // правильно одразу
  eq(summarize(s).stepStats, { used: true, method: 1, calc: 1, both: 1, noStep: 1 });
  eq(summarize(s).total - summarize(s).correct, 4, 'сума категорій = кількість помилок');
});

test('дата останньої сесії', () => {
  const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
  const now = at(2026, 10, 31, 0, 10);
  eq(formatAgo(at(2026, 10, 31, 0, 5), now), 'сьогодні');
  eq(formatAgo(at(2026, 10, 30, 23, 50), now), 'вчора', 'календарні дні, а не 24 години');
  eq(formatAgo(at(2026, 10, 28), now), '3 дні тому');
  eq(formatAgo(at(2026, 10, 26), now), '5 днів тому');
  const daysAgo = (n) => now - n * 86400000;
  eq(formatAgo(daysAgo(13), now), '13 днів тому');
  eq(formatAgo(daysAgo(14), now), '2 тижні тому');
  eq(formatAgo(daysAgo(35), now), '5 тижнів тому');
  eq(formatAgo(daysAgo(59), now), '8 тижнів тому');
  eq(formatAgo(daysAgo(60), now), '2 місяці тому');
  eq(formatAgo(daysAgo(150), now), '5 місяців тому');
  eq(formatAgo(daysAgo(364), now), '11 місяців тому');
  eq(formatAgo(daysAgo(365), now), 'понад рік тому');
  eq(formatAgo(at(2026, 10, 30, 1, 0), at(2026, 10, 31, 23, 0)), 'вчора');
});

test('простій закріпленого розділу: 4 дні — жовтий, 10 — червоний', () => {
  const now = new Date(2026, 10, 19, 12).getTime();
  const ago = (d) => now - d * 86400000;
  eq([0, 3, 4, 9, 10, 40].map((d) => staleness(ago(d), now)), [null, null, 'warn', 'warn', 'alert', 'alert']);
  eq(staleness(null, now), null, 'нерозпочатий розділ не підсвічується');
  eq([worstStaleness([null, 'warn']), worstStaleness(['warn', 'alert']), worstStaleness([])], ['warn', 'alert', null]);
});

test('стовпчик: нулі в кінці чисел винесені праворуч', () => {
  const rows = (html) => [...html.matchAll(/col-num [^"]+">([^<]*)</g)].map((m) => m[1]);
  eq(rows(columnHtml({ rows: ['560', '8'], sign: '×', align: 'zeros' }, '')), ['560', '8\u2007'], 'вісімка під шісткою');
  eq(rows(columnHtml({ rows: ['120', '400'], sign: '×', align: 'zeros' }, '')), ['120\u2007', '400'], 'двійка над четвіркою');
  eq(rows(columnHtml({ rows: ['560', '8'], sign: '×', align: 'right' }, '')), ['560', '8'], 'звичайний стовпчик без змін');
});

test('ділення з остачею: крок «Обрати дію» і ділення кутом', () => {
  const st = divisionSteps(745, 8, 93, createRng(3));
  eq(st.options.length, 4);
  eq(st.options.filter((o) => o.correct).map((o) => `${o.left} ${o.sign} ${o.right}`), ['745 : 8'], 'правильне лише ділене : дільник');
  eq(st.options.find((o) => o.op === '/' && o.left === 8).value, 0, 'значення ділення — неповна частка');
  eq([st.canonical.left, st.canonical.right, st.question], [745, 8, 'Як знайти неповну частку?']);
  const topic = { exercises: [{ id: 'q', kind: 'generator', generator: 'template', params: { text: '{a} = {b} × □ + {a % b}', vars: { a: [100, 999], b: [3, 9] }, where: ['a % b != 0'], answer: '(a - a % b) / b', divideSteps: ['a', 'b'] } }] };
  const item = generateInstance(topic.exercises[0], createRng(5));
  const [, a, b] = item.text.match(/^(\d+) = (\d+)/).map(Number);
  eq(item.steps.options.find((o) => o.correct).value, item.answer, 'правильна дія дає відповідь');
  eq([item.steps.canonical.left, item.steps.canonical.right], [a, b]);
  const rem = divisionSteps(76, 3, 1, createRng(2), { find: 'remainder' });
  eq([rem.question, rem.find], ['Як знайти остачу?', 'remainder']);
  eq(rem.options.filter((o) => o.correct).map((o) => `${o.left} ${o.sign} ${o.right}`), ['76 : 3'], 'остача: правильне 76 : 3');
  eq(rem.options.find((o) => o.correct).value, 1, 'значення ділення — остача');
  const html = divisionHtml({ dividend: 745, divisor: 8 }, '<i>q</i>');
  assert(html.includes('div-dividend">745') && html.includes('div-divisor">8') && html.includes('<i>q</i>'), 'кут: ділене, дільник, поле частки');
});

test('ділення кутом: проміжні рядки', () => {
  const short = (fs) => fs.map((f) => (f.kind === 'q' ? `q${f.value}` : `${f.kind}${f.value}@${f.from}-${f.to}`)).join(' ');
  eq(short(longDivision(745, 8)), 'q9 p72@0-1 d25@1-2 q3 p24@1-2 r1@2-2');
  eq(short(longDivision(816, 8)), 'q1 p8@0-0 d16@0-2 q0 q2 p16@0-2 r0@2-2', '0 у частці');
  eq(short(longDivision(803, 8)), 'q1 p8@0-0 r3@0-2 q0 q0', 'нулі в кінці частки');
  eq(short(longDivision(8, 163)), 'q0 r8@0-0', 'ділене менше за дільник');
  eq(short(longDivision(948, 23)), 'q4 p92@0-1 d28@0-2 q1 p23@0-2 r5@1-2', 'двоцифровий дільник');
  for (const [a, b] of [[745, 8], [816, 8], [803, 8], [999, 7], [100, 3], [948, 23]]) {
    const fs = longDivision(a, b);
    eq(Number(quotientOf(fs, fs.map((f) => String(f.value)))), Math.floor(a / b), `${a} : ${b} — частка`);
    eq(fs.find((f) => f.kind === 'r').value, a % b, `${a} : ${b} — остача`);
  }
  const fs = longDivision(745, 8);
  eq(quotientOf(fs, ['9', '72', '25']), '9', 'частка з уже введених цифр');
  const topic = { id: 't', title: 'T', exercises: [{ id: 'a', kind: 'fixed', text: '745 = 8 × □ + 1', answer: 93 }] };
  const { result } = submitAnswer(buildSession(topic, 1, createRng(1)), '93', 1000,
    { written: fs.map((f, i) => ({ ...f, given: ['9', '72', '35', '3', '24'][i] })) });
  eq(result.written.map((r) => r.correct), [true, true, false, true, true, false], 'рядки перевіряються після відповіді; порожній — неправильний');
});

test('ділення кутом: рядки дитини (конструктор)', () => {
  const short = (rs) => rs.map((r) => `${r.kind}@${r.end}${r.correct ? '✓' : '✕'}`).join(' ');
  eq(short(divisionRows(72, 5, ['70', '2'])), 'p@1✓ d@1✓', 'одразу 5 · 14 = 70 під «72» (issue #8)');
  eq(short(divisionRows(72, 5, ['5', '22', '20', '2'])), 'p@0✓ d@1✓ p@1✓ d@1✓', 'звичайний шлях');
  eq(short(divisionRows(554, 9, ['54', '14', '9', '5'])), 'p@1✓ d@2✓ p@2✓ d@2✓');
  const wrong = divisionRows(745, 8, ['72', '35']);
  eq([wrong[1].correct, wrong[1].value, wrong[1].end], [false, 25, 2], 'неправильна різниця: правильне значення й місце');
  eq(short(divisionRows(745, 8, ['73', '1'])), 'p@1✕ d@1✓', 'від\'ємник не ділиться на дільник');
  eq(short(divisionRows(950, 9, ['9', '50', '45', '5'])), 'p@0✓ d@2✓ p@2✓ d@2✓', 'знесено дві цифри');
  eq(divisionRows(745, 8, ['']).map((r) => r.end), [1], 'порожній перший рядок — під першим неповним діленим');
  const fs = longDivision(745, 8);
  eq(quotientOf(fs, fs.map((f) => String(f.value))), '93');
});

test('множення стовпчиком: неповні добутки', () => {
  const short = (fs) => fs.map((f) => `${f.kind}${f.value}<${f.shift}/${f.width}`).join(' ');
  eq(short(longMultiplication(47, 23)), 'pp141<0/3 pp94<1/3 sum1081<0/4');
  eq(short(longMultiplication(12, 11)), 'pp12<0/3 pp12<1/2 sum132<0/3', 'ширина не виходить за добуток');
  eq(short(longMultiplication(47, 205)), 'pp235<0/3 pp94<2/2 sum9635<0/4', '0 у множнику — рядка немає, зсув на 2');
  eq(short(longMultiplication(47, 20)), 'pp94<1/2 sum940<0/3');
  for (const [a, b] of [[47, 23], [99, 49], [12, 11], [365, 407]]) {
    const fs = longMultiplication(a, b);
    eq(fs.filter((f) => f.kind === 'pp').reduce((acc, f) => acc + f.value * 10 ** f.shift, 0), a * b, `${a} · ${b}: сума неповних добутків`);
  }
});

test('інструкція над завданням (prompt)', () => {
  const cmp = (text) => ({ text, answerType: 'choice', choices: ['<', '=', '>'] });
  eq([defaultPrompt(cmp('2 □ 14')), defaultPrompt(cmp('3/5 □ 2/5')), defaultPrompt(cmp('35 + 7 □ 40'))],
    ['Порівняй числа.', 'Порівняй числа.', 'Порівняй вирази.']);
  eq(defaultPrompt({ text: '7 + 5 = □', answerType: 'number' }), undefined, 'обчислення — без інструкції');
  const ex = { id: 'c', kind: 'generator', generator: 'template', prompt: 'Запиши число.', params: { text: '{d} дес. {u} од. = □', vars: { d: [1, 9], u: [0, 9] }, answer: 'd * 10 + u' } };
  eq(generateInstance(ex, createRng(1)).prompt, 'Запиши число.');
  const topic = { id: 't', title: 'T', exercises: [{ ...ex, prompt: 'х'.repeat(91) }] };
  eq(validateTopic(topic).errors.length, 1, 'задовга інструкція');
});

test('«Обрати дію» в задачах і ділення кутом у прикладах', () => {
  const st = actionSteps('*', 12, 12, 144, createRng(1), 'Як знайти площу?');
  eq(st.options.map((o) => o.sign).sort(), ['+', ':', '×', '−'].sort());
  eq(st.options.filter((o) => o.correct).map((o) => `${o.left} ${o.sign} ${o.right}`), ['12 × 12']);
  eq([st.question, st.label], ['Як знайти площу?', '']);
  const div = actionSteps('/', 96, 4, 24, createRng(2));
  eq(div.options.find((o) => o.correct).value, 24);
  eq(div.options.find((o) => o.op === '-').left, 96, 'для − більше число першим');
  const area = { id: 'a', kind: 'generator', generator: 'template', params: { text: 'Сторона квадрата {a} м. Знайди його площу.', vars: { a: [11, 25] }, answer: 'a * a', unit: 'м²', actionSteps: { op: '*', args: ['a', 'a'], question: 'Як знайти площу?' } } };
  const it = generateInstance(area, createRng(3));
  eq(it.steps.options.find((o) => o.correct).value, it.answer, 'правильна дія дає відповідь');
  const d = generateInstance({ id: 'd', kind: 'generator', generator: 'arithmetic', params: { op: '/', b: [2, 9], result: [21, 150], layout: 'column' } }, createRng(4));
  eq(d.column.kind, 'divide', 'ділення стовпчиком — кутом');
  eq(d.column.dividend / d.column.divisor, d.answer);
});

test('звернення: контекст і посилання на GitHub', () => {
  const ctx = contextText([['екран', '#/topic/g2-mul/play'], ['текст', '7 × □ = 42: "x"'], ['порожнє', ''], ['немає', undefined]]);
  eq(ctx, 'екран: "#/topic/g2-mul/play"\nтекст: "7 × □ = 42: \\"x\\""', 'YAML-рядки в лапках, порожні пропущено');
  const url = new URL(issueUrl('bug', 'Не та відповідь\nдеталі', ctx));
  eq(url.pathname, '/Buagilber/math-trainer/issues/new');
  eq(url.searchParams.get('template'), 'app-bug.yml');
  eq(url.searchParams.get('title'), '[Помилка] Не та відповідь', 'заголовок — перший рядок опису');
  eq(url.searchParams.get('context'), ctx);
  eq(new URL(issueUrl('idea', '', '')).searchParams.get('template'), 'app-idea.yml');
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
    // Приховані розділи (чернетки для інших класів) теж мають бути коректними.
    for (const path of g.hiddenTopics ?? []) {
      const { errors } = validateTopic(await (await fetch(`../data/${path}`)).json(), { samples: 50 });
      assert(!errors.length, `${path}: ${errors.join('; ')}`);
    }
  }
});

test('кожне завдання має інструкцію або питання (етап 0, STEPS-ROLLOUT)', async () => {
  const catalog = await (await fetch('../data/catalog.json')).json();
  const missing = [];
  for (const g of catalog.grades) {
    for (const path of g.topics) {
      const topic = validateTopic(await (await fetch(`../data/${path}`)).json(), { samples: 1 }).topic;
      for (const level of [1, 2, 3]) {
        for (const item of buildSession({ ...topic, sessionSize: 40 }, level, createRng(level)).items) {
          if (isRecordTask(item) && !item.prompt) missing.push(`${topic.id}/${item.exerciseId}: ${item.text}`);
        }
      }
    }
  }
  assert(!missing.length, `без інструкції: ${[...new Set(missing.map((m) => m.split(':')[0]))].join(', ')}`);
  eq([isRecordTask({ text: '34 + 53 = □' }), isRecordTask({ text: 'Скільки десятків у числі 47?' }), isRecordTask({ text: 'Округли до десятків: 216 ≈ □0' }), isRecordTask({ text: '12 кг + 9 кг = □ кг' })],
    [true, false, false, true]);
});

export async function run() {
  const results = [];
  for (const t of tests) {
    try { await t.fn(); results.push({ name: t.name, ok: true }); }
    catch (e) { results.push({ name: t.name, ok: false, error: e.message }); }
  }
  return results;
}
