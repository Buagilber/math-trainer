// Тести core-логіки. Запуск: відкрити tests/index.html через локальний сервер.
// Тести — також «виконувана специфікація» для майбутньої мобільної реалізації.

import { createRng } from '../js/core/rng.js';
import { evaluate, formatExpression } from '../js/core/expr.js';
import { generateInstance, fillText, pluralUk, STEPS_MIN_DIGITS } from '../js/core/generators.js';
import { buildSession, submitAnswer, isFinished, summarize, starsFor, checkAnswer, formatAnswer, MAX_QUESTION_MS } from '../js/core/session.js';
import { formatDecimal, parseDecimal, compareDecimals } from '../js/core/numbers.js';
import { hintDelayMs, shouldOfferHint, normalizeHint, hintProblems } from '../js/core/hints.js';
import { applyKey, isComplete, mathHtml } from '../js/app/answer-input.js';
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
  eq(hintDelayMs(inline, 1, null), 15000, 'мінімум рівня 1');
  eq(hintDelayMs(textTask, 1, null), 25000, 'текстова задача +10 с');
  eq(hintDelayMs(inline, 2, 4000), 20000, 'швидка дитина — мінімум рівня');
  eq(hintDelayMs(inline, 2, 15000), 30000, '2 × середній час');
  eq(hintDelayMs(inline, 3, 60000), 45000, 'не пізніше 45 с');
  eq(hintDelayMs({ ...inline, hintAfterSec: 7 }, 3, 60000), 7000, 'свій поріг завдання');
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
  eq(div.column, undefined, 'ділення — у рядок');
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
  const step = (correct) => ({ left: 1, sign: '+', right: 2, correct });
  ({ session: s } = submitAnswer(s, right() + 1, 0, { step: step(false) })); // не та дія
  ({ session: s } = submitAnswer(s, right() + 1, 0, { step: step(true) }));  // дія та, обчислення ні
  ({ session: s } = submitAnswer(s, right(), 0, { step: step(true) }));      // усе правильно
  eq([summarize(s).stepMethodErrors, summarize(s).stepCalcErrors], [1, 1]);
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

export async function run() {
  const results = [];
  for (const t of tests) {
    try { await t.fn(); results.push({ name: t.name, ok: true }); }
    catch (e) { results.push({ name: t.name, ok: false, error: e.message }); }
  }
  return results;
}
