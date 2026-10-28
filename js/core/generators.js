// Генератори завдань. Кожне завдання в JSON описане декларативно
// (тип + параметри), а тут — алгоритм, що з опису робить конкретний приклад.
// Специфікація параметрів: docs/CONTENT.md.
//
// Результат будь-якого генератора — «екземпляр завдання»:
//   { exerciseId, text, answerType: 'number'|'choice', answer, choices?, unit? }
// text може містити «□» — місце, куди дитина вписує відповідь.

import { evaluate, formatExpression } from './expr.js';
import { pow10, formatDecimal, normalizeDecimal, compareDecimals } from './numbers.js';

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
    const text = fillText(params.text, vars);

    // З вибором: answer — умова (true → перший варіант, false → другий)
    // або номер варіанта, починаючи з 0.
    if (Array.isArray(params.choices)) {
      const index = typeof value === 'boolean' ? (value ? 0 : 1) : value;
      if (!valid || !Number.isInteger(index) || !params.choices[index]) return null;
      return { text, answerType: 'choice', choices: params.choices.map(String), answer: String(params.choices[index]) };
    }

    if (!valid || !Number.isInteger(value) || !inRange(value, params.result ?? [0, Infinity])) return null;
    if (params.steps && !steps.every((s) => inRange(s, params.steps))) return null;
    return { text, answerType: 'number', answer: value, unit: params.unit };
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

// ---------- decimal: дії з десятковими дробами ----------
//
// Числа задаються цілими «одиницями» й кількістю знаків після коми:
// a: [12, 99], aScale: 1 → від 1,2 до 9,9. Уся арифметика — у цілих числах.

const dec = (units, scale) => ({ units, scale });
// Операнд без зайвого нуля в кінці (2,30 → не генеруємо, бо виглядає як 2,3).
const cleanOperand = (d) => d.scale === 0 || d.units % 10 !== 0;

function decimal(params, rng) {
  const ops = [].concat(params.op ?? '+');
  const sa = params.aScale ?? 1;
  const sb = params.bScale ?? sa;
  const inValue = (d, range) => !range || (compareDecimals(d, dec(range[0], 0)) >= 0 && compareDecimals(d, dec(range[1], 0)) <= 0);

  return retry(() => {
    const op = rng.pick(ops);

    if (op === 'round') {
      const a = dec(rollVar(params.a, rng), sa);
      const to = params.to ?? 0;
      const f = pow10(sa - to);
      if (f <= 1 || a.units % f === 0 || !cleanOperand(a)) return null;
      const rounded = dec(Math.floor((a.units + f / 2) / f), to);
      return {
        text: `${params.label ? `Округли до ${params.label}: ` : ''}${formatDecimal(a)} ≈ ${BLANK}`,
        answerType: 'decimal',
        answer: formatDecimal(rounded),
      };
    }

    if (op === 'compare') {
      const a = dec(rollVar(params.a, rng), sa);
      const shift = pow10(Math.max(sb - sa, 0));
      const b = dec(a.units * shift + rng.int(-(params.near ?? 5), params.near ?? 5), Math.max(sa, sb));
      if (b.units < 0) return null;
      // Однакова кількість знаків — без «7,0»; різна — «3,50 і 3,5» лишаємо, це навчально.
      if (sa === sb && (!cleanOperand(a) || !cleanOperand(b))) return null;
      const diff = compareDecimals(a, b);
      if (diff === 0 && rng.next() > (params.equalShare ?? 0.3)) return null;
      const [left, right] = rng.next() < 0.5 ? [a, b] : [b, a];
      const d = compareDecimals(left, right);
      return {
        text: `${formatDecimal(left)} ${BLANK} ${formatDecimal(right)}`,
        answerType: 'choice',
        choices: ['<', '=', '>'],
        answer: d < 0 ? '<' : d > 0 ? '>' : '=',
      };
    }

    let a, b, r;
    if (op === '/') {
      // a : b = q, де b — ціле, a = b × q; ділення завжди без остачі.
      b = dec(rollVar(params.b, rng), 0);
      const q = dec(rollVar(params.result, rng), sa);
      a = dec(b.units * q.units, sa);
      if (!cleanOperand(a) || !cleanOperand(q)) return null;
      r = q;
    } else {
      a = dec(rollVar(params.a, rng), sa);
      b = dec(rollVar(params.b, rng), sb);
      if (!cleanOperand(a) || !cleanOperand(b)) return null;
      if (op === '*') {
        r = dec(a.units * b.units, sa + sb);
      } else {
        const s = Math.max(sa, sb);
        const x = a.units * pow10(s - sa);
        const y = b.units * pow10(s - sb);
        r = dec(op === '+' ? x + y : x - y, s);
      }
      if (op !== '*' && !inValue(r, params.range)) return null;
    }
    if (r.units < 0) return null;
    const sign = { '+': '+', '-': '−', '*': '×', '/': ':' }[op];
    return {
      text: `${formatDecimal(a)} ${sign} ${formatDecimal(b)} = ${BLANK}`,
      answerType: 'decimal',
      answer: formatDecimal(normalizeDecimal(r)),
    };
  });
}

// ---------- fraction: звичайні дроби з однаковими знаменниками ----------
//
// mode: add | sub | compare | toMixed | toImproper | addMixed | subMixed
// (можна масивом). Текст використовує запис n/d — інтерфейс показує його
// «двоповерховим» дробом.

function fraction(params, rng) {
  const modes = [].concat(params.mode ?? 'add');
  return retry(() => {
    const mode = rng.pick(modes);
    const d = rollVar(params.den ?? [3, 12], rng);
    const part = () => rng.int(1, d - 1);
    const whole = () => rollVar(params.whole ?? [1, 5], rng);
    const ask = (text, answer) => ({ text, answerType: 'fraction', answer });

    switch (mode) {
      case 'add': {
        const a = part(), b = part();
        if (a + b >= d) return null;
        return ask(`${a}/${d} + ${b}/${d} = ${BLANK}`, { num: a + b, den: d });
      }
      case 'sub': {
        const a = part(), b = part();
        if (a <= b) return null;
        return ask(`${a}/${d} − ${b}/${d} = ${BLANK}`, { num: a - b, den: d });
      }
      case 'compare': {
        const a = part(), b = part();
        if (a === b && rng.next() > (params.equalShare ?? 0.2)) return null;
        return {
          text: `${a}/${d} ${BLANK} ${b}/${d}`,
          answerType: 'choice',
          choices: ['<', '=', '>'],
          answer: a < b ? '<' : a > b ? '>' : '=',
        };
      }
      case 'toMixed': {
        const w = whole(), n = part();
        return ask(`Запиши мішаним числом: ${w * d + n}/${d} = ${BLANK}`, { whole: w, num: n, den: d });
      }
      case 'toImproper': {
        const w = whole(), n = part();
        return ask(`Запиши неправильним дробом: ${w} ${n}/${d} = ${BLANK}`, { num: w * d + n, den: d });
      }
      case 'addMixed': {
        const w1 = whole(), w2 = whole(), n1 = part(), n2 = part();
        const n = n1 + n2;
        if (n === d) return null;
        if (n > d && !params.carry) return null;
        return ask(`${w1} ${n1}/${d} + ${w2} ${n2}/${d} = ${BLANK}`,
          { whole: w1 + w2 + (n > d ? 1 : 0), num: n > d ? n - d : n, den: d });
      }
      case 'subMixed': {
        const w1 = whole(), w2 = whole(), n1 = part(), n2 = part();
        if (n1 === n2) return null;
        const borrow = n1 < n2;
        if (borrow && !params.carry) return null;
        const w = w1 - w2 - (borrow ? 1 : 0);
        if (w < 1) return null;
        return ask(`${w1} ${n1}/${d} − ${w2} ${n2}/${d} = ${BLANK}`,
          { whole: w, num: borrow ? n1 + d - n2 : n1 - n2, den: d });
      }
    }
    throw new GenerationError(`Невідомий режим дробів «${mode}»`);
  });
}

export const GENERATORS = { arithmetic, compare, template, expression, decimal, fraction };

// Фіксоване завдання з JSON (без генерації).
// answerType: "decimal" (answer: "2,5") або "fraction" (answer: { num, den } / { whole, num, den }).
function fixed(exercise) {
  const isChoice = Array.isArray(exercise.choices);
  const answerType = isChoice ? 'choice' : exercise.answerType ?? 'number';
  const answer = answerType === 'choice' || answerType === 'decimal' ? String(exercise.answer)
    : answerType === 'fraction' ? exercise.answer
    : Number(exercise.answer);
  return {
    text: exercise.text,
    answerType,
    answer,
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
