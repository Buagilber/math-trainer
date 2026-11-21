// «Розв'язання по діях» для задач у кілька дій (docs/STEPS-ROLLOUT.md, етап 2).
//
// Дві схеми (за класом і рівнем — catalog.json → grades[].multiStep):
//   ask  — «ми питаємо»: до кожної дії плану наше питання й 4 варіанти;
//   free — «дитина складає сама»: число (з умови, знайдене чи «інше»), знак, число.
// Пояснення до дії: auto — підставляємо ми; pick — дитина обирає кнопками.
//
// Дані задачі (template → params.multiStep):
//   numbers  — числа умови як вирази зі змінних шаблону, у порядку тексту: ["a", "b", "c"];
//   plan     — дії схеми А: [{ op, args: ["b", "c"], question, ops? }], "#1" — результат дії 1;
//   meanings — що означає проміжне число: { "b + c": "поїхало на екскурсію", … };
//   spare    — пояснення-відволікачі: ["було в класі спочатку"];
//   remainder — ділення з остачею (автобуси): «:» дає неповну частку, остачу
//              показуємо поруч — «230 : 45 = 5 (ост. 5)».
// Відповідь задачі — params.answer (вираз від змінних): з нього й перевірка шляху.

import { evaluate } from './expr.js';

export const MAX_EXTRA = 3; // скільки «інших чисел» може бути в наборі одночасно
export const MULTI_SIGNS = { '+': '+', '-': '−', '*': '×', '/': ':' };
const ALL_OPS = ['+', '-', '*', '/'];

export const calc = (l, op, r, { remainder = false } = {}) =>
  (op === '/' && remainder ? Math.floor(l / r) : ({ '+': l + r, '-': l - r, '*': l * r, '/': l / r })[op]);
// Значення дії задачі: у задачах на остачу «:» — неповна частка.
export const lineCalc = (multi, [l, op, r]) => calc(l, op, r, { remainder: !!multi.remainder });
// Остача для запису «(ост. r)»: лише коли частка дитини — справжня неповна частка й остача не 0.
export function remainderOf(multi, [l, op, r], given) {
  if (!multi.remainder || op !== '/' || given === '') return null;
  const rest = l - Number(given) * r;
  return Number.isInteger(Number(given)) && rest > 0 && rest < r ? rest : null;
}

// Дані для екземпляра задачі: числа, план і пояснення з поточними значеннями змінних.
export function buildMultiStep(spec, numeric, answerExpr) {
  const val = (e) => evaluate(String(e), numeric).value;
  return {
    numbers: spec.numbers.map((e) => ({ expr: String(e), value: val(e) })),
    plan: spec.plan.map((st) => ({ op: st.op, args: st.args.map(String), question: st.question, ops: st.ops })),
    meanings: Object.entries(spec.meanings ?? {}).map(([expr, text]) => ({ expr, text, value: val(expr) })),
    spare: spec.spare ?? [],
    remainder: !!spec.remainder,
    answerExpr,
    env: { ...numeric },
  };
}

// Значення аргументу дії плану: «#2» — результат, який дитина отримала в дії 2.
function argValue(multi, arg, lines) {
  if (arg.startsWith('#')) return Number(lines[Number(arg.slice(1)) - 1]?.given);
  return evaluate(arg, multi.env).value;
}

// Схема А: 4 варіанти до дії stepIndex (дії з тими самими числами; для − і :
// більше число першим, крім правильної дії — там порядок автора).
export function askOptions(multi, stepIndex, lines, shuffle) {
  const step = multi.plan[stepIndex];
  const [a, b] = step.args.map((arg) => argValue(multi, arg, lines));
  const refs = step.args.map((arg) => (arg.startsWith('#') ? `l:${Number(arg.slice(1)) - 1}` : null));
  const options = (step.ops ?? ALL_OPS).map((op) => {
    const swap = (op === '-' || op === '/') && op !== step.op && b > a;
    return { op, left: swap ? b : a, right: swap ? a : b, refs: swap ? [refs[1], refs[0]] : refs, correct: op === step.op };
  });
  // Ділення без остачі тут не вийде (9 : 4) — такий варіант лише плутає.
  return shuffle(options.filter((o) => o.correct || o.op !== '/' || (o.right !== 0 && o.left % o.right === 0)));
}

// Пояснення до числа: перше з meanings, значення якого збігається (порівняння — за значенням).
export function meaningOf(multi, value) {
  return multi.meanings.find((m) => Math.abs(m.value - value) < 1e-9)?.text ?? null;
}

// Кнопки «Що ми дізналися?»: правильне пояснення (якщо є) і ще 2 з інших та відволікачів.
export function noteOptions(multi, value, shuffle) {
  const right = meaningOf(multi, value);
  const others = shuffle([...new Set([...multi.meanings.map((m) => m.text), ...multi.spare])].filter((t) => t !== right));
  return shuffle([...(right ? [right] : []), ...others.slice(0, right ? 2 : 3)]);
}

// Перевірка шляху (схема Б). lines: [{ expr: [l, op, r], refs: [ref, ref], given }],
// ref — «n:i» (i-те число умови), «l:j» (результат дії j), «x» (інше число, стала).
// Дії складаються у вираз від чисел умови; підставляємо інші значення змінних
// шаблону: якщо вираз щоразу дає те саме, що відповідь задачі, — шлях правильний.
// Число з умови могло бути сталою («· 2», коли сторона теж 2), тож пробуємо
// обидва прочитання кожного такого числа.
export function pathValid(multi, lines, finalLine, { trials = 8, random = Math.random } = {}) {
  if (finalLine == null || !lines[finalLine]) return null;
  const slots = [];
  lines.forEach((l, i) => l.refs.forEach((r, k) => { if (r?.startsWith('n:')) slots.push(`${i}:${k}`); }));
  const envs = Array.from({ length: trials }, () =>
    Object.fromEntries(Object.keys(multi.env).map((v) => [v, 2 + Math.floor(random() * 60)])));
  const masks = Math.min(1 << slots.length, 256);
  for (let mask = 0; mask < masks; mask++) {
    const asConst = new Set(slots.filter((_, b) => mask & (1 << b)));
    if (envs.every((env) => matches(multi, lines, finalLine, asConst, env))) return true;
  }
  return false;
}

function matches(multi, lines, finalLine, asConst, env) {
  const numbers = multi.numbers.map((n) => evaluate(n.expr, env).value);
  const seen = new Set();
  const lineValue = (i) => {
    if (seen.has(i)) return NaN; // захист від циклів
    seen.add(i);
    const l = lines[i];
    const [a, b] = l.refs.map((r, k) => {
      const shown = k === 0 ? l.expr[0] : l.expr[2];
      if (!r || r === 'x' || asConst.has(`${i}:${k}`)) return shown;
      if (r.startsWith('n:')) return numbers[Number(r.slice(2))];
      return lineValue(Number(r.slice(2)));
    });
    seen.delete(i);
    return calc(a, l.expr[1], b, { remainder: !!multi.remainder });
  };
  const got = lineValue(finalLine);
  const want = evaluate(multi.answerExpr, env).value;
  return Number.isFinite(got) && Math.abs(got - want) < 1e-6 * Math.max(1, Math.abs(want));
}

// Підсумок для результату: кожна дія (пораховано / дія / пояснення) і шлях.
export function multiSummary(multi, state, given) {
  const lines = state.lines.filter((l) => l.given !== '');
  const finalLine = state.finalLine ?? (() => {
    const i = lines.map((l) => l.given).lastIndexOf(String(given));
    return i >= 0 ? i : null;
  })();
  return {
    mode: state.mode,
    noteMode: state.noteMode,
    lines: lines.map((l) => ({
      expr: l.expr,
      given: l.given,
      calcOk: Number(l.given) === lineCalc(multi, l.expr),
      actionOk: state.mode === 'ask' ? !!l.rightOption : null,
      note: l.note ?? null,
      noteOk: state.noteMode === 'pick' && l.note ? meaningOf(multi, Number(l.given)) === l.note : null,
    })),
    pathOk: state.mode === 'free' && lines.length ? pathValid(multi, lines, finalLine) : null,
  };
}
