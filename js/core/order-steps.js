// Порядок дій по кроках (docs/STEPS-ROLLOUT.md, етап 4).
//
// Вираз — масив токенів: { n: 13 } — число, { o: '*' } — дія (+ - * /), { p: '(' } — дужка.
// Дитина торкається знака дії; дію можна виконати, лише якщо вона за правилами
// наступна. Інакше — правило з підручника (дія не виконується: неправильний
// порядок дав би від'ємні числа чи дроби, яких у класі ще немає).
//
// Множення й ділення — у зручному порядку: дію · чи : можна виконати першою,
// якщо від цього не змінюється значення виразу й результат дії — ціле невід'ємне
// число (49 · 66 : 2 → можна почати з 66 : 2; 60 : 6 · 2 → лише з 60 : 6).
// Додавання й віднімання — зліва направо.

import { tokenize } from './expr.js';

const PRI = { '+': 1, '-': 1, '*': 2, '/': 2 };
export const orderCalc = (a, op, b) => ({ '+': a + b, '-': a - b, '*': a * b, '/': a / b })[op];

// Правила (Тарасенкова, 5 кл., § 15; Скворцова, 2 кл., с. 116), сформульовані без
// суперечностей: у Тарасенковій «а потім інші дії в тому порядку, у якому вони
// записані» хибне для (67 + 14) − 4 · 5, і слова «ступінь» у 2 класі ще немає.
export const ORDER_RULES = {
  brackets: 'У виразі з дужками спочатку виконують дії в дужках. Потім — інші дії: спершу множення й ділення, а тоді додавання й віднімання, зліва направо.',
  priority: 'У виразах без дужок спочатку виконують дії множення або ділення, а потім — додавання або віднімання.',
  order: 'Якщо у виразі лише додавання й віднімання, дії виконують по черзі, зліва направо.',
  orderMul: 'Множення й ділення виконують по черзі, зліва направо. Почати з іншої такої дії можна, лише якщо від цього не зміниться значення виразу й вийде ціле число, — тут так не вийде.',
};

// Вираз генератора (a * (b + c)) зі значеннями змінних → токени.
export function orderTokens(expr, vars) {
  return tokenize(expr).map((t) => {
    if (t.type === 'num') return { n: t.value };
    if (t.type === 'var') return { n: vars[t.value] };
    return t.value === '(' || t.value === ')' ? { p: t.value } : { o: t.value };
  });
}

// Значення за правилами: дужки, потім · і :, потім + і −, зліва направо.
export function evalTokens(tokens) {
  const out = [];
  const ops = [];
  const apply = () => { const o = ops.pop(); const b = out.pop(); const a = out.pop(); out.push(orderCalc(a, o, b)); };
  for (const t of tokens) {
    if (t.n != null) out.push(t.n);
    else if (t.p === '(') ops.push('(');
    else if (t.p === ')') { while (ops.at(-1) !== '(') apply(); ops.pop(); }
    else { while (ops.length && ops.at(-1) !== '(' && PRI[ops.at(-1)] >= PRI[t.o]) apply(); ops.push(t.o); }
  }
  while (ops.length) apply();
  return out[0];
}

// Виконати дію i (знак між двома числами) з результатом value; дужки навколо одного числа зникають.
export function reduceTokens(tokens, i, value) {
  const next = [...tokens.slice(0, i - 1), { n: value }, ...tokens.slice(i + 2)];
  for (let k = 1; k < next.length - 1; k++) {
    if (next[k - 1].p === '(' && next[k].n != null && next[k + 1].p === ')') {
      next.splice(k - 1, 3, { n: next[k].n });
      k = 0;
    }
  }
  return next;
}

const computable = (tokens, i) => tokens[i - 1]?.n != null && tokens[i + 1]?.n != null;

// Групи: вирази в найглибших дужках, або весь вираз, якщо дужок немає.
function groups(tokens) {
  const out = [];
  const stack = [];
  tokens.forEach((t, i) => {
    if (t.p === '(') stack.push(i);
    else if (t.p === ')') {
      const st = stack.pop();
      if (!tokens.slice(st + 1, i).some((u) => u.p)) out.push([st + 1, i]);
    }
  });
  return out.length ? out : [[0, tokens.length]];
}

// Номери токенів-дій, які можна виконати зараз.
export function allowedOps(tokens) {
  const allowed = [];
  const whole = evalTokens(tokens);
  for (const [a, b] of groups(tokens)) {
    const ops = [];
    for (let i = a; i < b; i++) if (tokens[i].o) ops.push(i);
    const hi = ops.filter((i) => PRI[tokens[i].o] === 2);
    if (!hi.length) { if (ops.length) allowed.push(ops[0]); continue; }
    hi.forEach((i) => {
      if (!computable(tokens, i)) return;
      const v = orderCalc(tokens[i - 1].n, tokens[i].o, tokens[i + 1].n);
      if (Number.isInteger(v) && v >= 0 && evalTokens(reduceTokens(tokens, i, v)) === whole) allowed.push(i);
    });
  }
  return allowed;
}

// Чому дія i недоступна — ключ правила з ORDER_RULES.
export function whyNotOp(tokens, i) {
  const gs = groups(tokens);
  if (tokens.some((t) => t.p) && !gs.some(([a, b]) => i >= a && i < b)) return 'brackets';
  const [a, b] = gs.find(([x, y]) => i >= x && i < y) ?? [0, tokens.length];
  const hasHi = tokens.slice(a, b).some((t) => t.o && PRI[t.o] === 2);
  if (PRI[tokens[i].o] === 1) return hasHi ? 'priority' : 'order';
  return 'orderMul';
}
