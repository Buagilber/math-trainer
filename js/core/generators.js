// Генератори завдань. Кожне завдання в JSON описане декларативно
// (тип + параметри), а тут — алгоритм, що з опису робить конкретний приклад.
// Специфікація параметрів: docs/CONTENT.md.
//
// Результат будь-якого генератора — «екземпляр завдання»:
//   { exerciseId, text, answerType: 'number'|'choice', answer, choices?, unit? }
// text може містити «□» — місце, куди дитина вписує відповідь.

import { evaluate, formatExpression } from './expr.js';

const BLANK = '□';
const MAX_TRIES = 500;

export class GenerationError extends Error {}

// Значення змінної з опису: [min, max], [min, max, step] або { oneOf: [...] }.
function rollVar(spec, rng) {
  if (Array.isArray(spec)) return rng.int(spec[0], spec[1], spec[2] ?? 1);
  if (spec && Array.isArray(spec.oneOf)) return rng.pick(spec.oneOf);
  if (typeof spec === 'number' || typeof spec === 'string') return spec;
  throw new GenerationError(`Некоректний опис змінної: ${JSON.stringify(spec)}`);
}

function rollVars(specs, rng) {
  const vars = {};
  for (const [name, spec] of Object.entries(specs ?? {})) vars[name] = rollVar(spec, rng);
  return vars;
}

const inRange = (v, range) => !range || (v >= range[0] && v <= range[1]);

function retry(fn) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const result = fn();
    if (result) return result;
  }
  throw new GenerationError('Не вдалося згенерувати приклад з такими обмеженнями');
}

// ---------- arithmetic: a op b = c, з контролем переходу через десяток ----------

function hasCarry(op, a, b) {
  if (op === '+') return (a % 10) + (b % 10) >= 10;
  if (op === '-') return a % 10 < b % 10;
  return false;
}

function arithmetic(params, rng) {
  const ops = [].concat(params.op ?? '+');
  const carry = params.carry ?? 'any';
  const missing = params.missing ?? 'result';

  return retry(() => {
    const op = rng.pick(ops);
    let a, b, c;
    if (op === '/') {
      // a : b = c, де a = b × c — ділення завжди без остачі.
      b = rollVar(params.b, rng);
      c = rollVar(params.result ?? [1, 10], rng);
      a = b * c;
      if (params.a && !inRange(a, params.a)) return null;
    } else {
      a = rollVar(params.a, rng);
      b = rollVar(params.b, rng);
      if (params.commutative && rng.next() < 0.5) [a, b] = [b, a];
      c = op === '+' ? a + b : op === '-' ? a - b : a * b;
      if (op !== '*' && !inRange(c, params.result)) return null;
    }
    if (c < 0) return null;
    if (carry === 'required' && !hasCarry(op, a, b)) return null;
    if (carry === 'forbidden' && hasCarry(op, a, b)) return null;

    const hide = missing === 'any' ? rng.pick(['a', 'b', 'result'])
      : missing === 'operand' ? rng.pick(['a', 'b'])
      : missing;
    const show = { a, b, result: c };
    const answer = show[hide];
    show[hide] = BLANK;
    const sign = { '+': '+', '-': '−', '*': '×', '/': ':' }[op];
    return {
      text: `${show.a} ${sign} ${show.b} = ${show.result}`,
      answerType: 'number',
      answer,
    };
  });
}

// ---------- compare: ліва частина ? права частина ----------

// Сторона порівняння: { number: [min,max] } | { expr, vars, result? } | { near: n }
function rollSide(spec, rng, otherValue) {
  if (spec.number) {
    const v = rollVar(spec.number, rng);
    return { value: v, text: String(v) };
  }
  if (spec.near !== undefined) {
    const v = otherValue + rng.int(-spec.near, spec.near);
    return { value: v, text: String(v) };
  }
  if (spec.expr) {
    const vars = rollVars(spec.vars, rng);
    const { value, steps, valid } = evaluate(spec.expr, vars);
    if (!valid || !Number.isInteger(value) || !inRange(value, spec.result)) return null;
    if (spec.steps && !steps.every((s) => inRange(s, spec.steps))) return null;
    return { value, text: formatExpression(spec.expr, vars) };
  }
  throw new GenerationError(`Некоректна сторона порівняння: ${JSON.stringify(spec)}`);
}

function compare(params, rng) {
  return retry(() => {
    const left = rollSide(params.left, rng);
    if (!left) return null;
    const right = rollSide(params.right, rng, left.value);
    if (!right || right.value < 0) return null;
    if (right.value === left.value && rng.next() > (params.equalShare ?? 0.3)) return null;
    const answer = left.value < right.value ? '<' : left.value > right.value ? '>' : '=';
    return {
      text: `${left.text} ${BLANK} ${right.text}`,
      answerType: 'choice',
      choices: ['<', '=', '>'],
      answer,
    };
  });
}

// ---------- template: довільний текст зі змінними та формулою відповіді ----------

// Українські форми множини: 1 яблуко, 2 яблука, 5 яблук.
export function pluralUk(n, one, few, many) {
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

// Підстановка в текст:
//   {a}             — значення змінної або виразу ({a + b})
//   {a|яблуко|яблука|яблук} — слово в потрібній формі для числа a
//   {=a + b}        — вираз у шкільному записі (12 + 5)
export function fillText(text, vars) {
  return text.replace(/\{([^}]+)\}/g, (_, body) => {
    const parts = body.split('|');
    if (parts.length === 4) {
      const n = evaluate(parts[0].trim(), vars).value;
      return pluralUk(n, parts[1], parts[2], parts[3]);
    }
    if (body.startsWith('=')) return formatExpression(body.slice(1), vars);
    const key = body.trim();
    if (key in vars && typeof vars[key] === 'string') return vars[key];
    return String(evaluate(key, vars).value);
  });
}

function template(params, rng) {
  return retry(() => {
    const vars = rollVars(params.vars, rng);
    const numeric = Object.fromEntries(Object.entries(vars).filter(([, v]) => typeof v === 'number'));
    for (const cond of params.where ?? []) {
      if (!evaluate(cond, numeric).value) return null;
    }
    const { value, steps, valid } = evaluate(params.answer, numeric);
    if (!valid || !Number.isInteger(value) || !inRange(value, params.result ?? [0, Infinity])) return null;
    if (params.steps && !steps.every((s) => inRange(s, params.steps))) return null;
    return {
      text: fillText(params.text, vars),
      answerType: 'number',
      answer: value,
      unit: params.unit,
    };
  });
}

// ---------- expression: обчисли значення виразу (порядок дій) ----------

function expression(params, rng) {
  const exprs = [].concat(params.expr);
  return retry(() => {
    const expr = rng.pick(exprs);
    const vars = rollVars(params.vars, rng);
    const { value, steps, valid } = evaluate(expr, vars);
    if (!valid || !Number.isInteger(value) || !inRange(value, params.result ?? [0, Infinity])) return null;
    if (params.steps && !steps.every((s) => inRange(s, params.steps))) return null;
    return {
      text: `${formatExpression(expr, vars)} = ${BLANK}`,
      answerType: 'number',
      answer: value,
    };
  });
}

export const GENERATORS = { arithmetic, compare, template, expression };

// Фіксоване завдання з JSON (без генерації).
function fixed(exercise) {
  const isChoice = Array.isArray(exercise.choices);
  return {
    text: exercise.text,
    answerType: isChoice ? 'choice' : 'number',
    answer: isChoice ? String(exercise.answer) : Number(exercise.answer),
    choices: exercise.choices?.map(String),
    unit: exercise.unit,
  };
}

export function generateInstance(exercise, rng) {
  let instance;
  if (exercise.kind === 'fixed') {
    instance = fixed(exercise);
  } else {
    const gen = GENERATORS[exercise.generator];
    if (!gen) throw new GenerationError(`Невідомий генератор «${exercise.generator}»`);
    instance = gen(exercise.params ?? {}, rng);
  }
  if (instance.answerType === 'choice' && exercise.shuffleChoices) {
    instance.choices = rng.shuffle(instance.choices);
  }
  return { exerciseId: exercise.id, ...instance };
}
