// Поле відповіді та екранна клавіатура — окремо для кожного типу відповіді.
// Клавіатуру обирає тип завдання, а не клас: молодші класи, де відповіді
// цілі, бачать лише цифри, ⌫ і ✓.
//
//   number   — цифри;
//   decimal  — цифри + «,»;
//   fraction — поля [ціла частина] чисельник / знаменник і кнопка «→» між ними;
//   choice   — кнопки з варіантами.

import { MAX_ANSWER_DIGITS } from '../core/validate.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Розряди у великих числах: 345678 → «345 678» (вузький нерозривний пробіл).
// Чотиризначні числа не ділимо — так прийнято в підручниках.
export const groupDigits = (s) => String(s).replace(/\d{5,}/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f'));

const fracHtml = (num, den) => `<span class="frac"><span class="frac-num">${num}</span><span class="frac-den">${den}</span></span>`;

// Текст завдання → HTML: екранування, розряди, нерозривний пробіл після
// числа («7 см» не розривається), n/d — «двоповерховий» дріб.
// ops: true — знаки дій (між пробілами) різними кольорами, щоб зміну дії
// між прикладами було видно одразу.
// times — яким знаком показувати множення: генератори пишуть «×», а клас може
// задати свій (у 5 класі за підручником «·»; див. notation у catalog.json).
export function mathHtml(text, { ops = false, times = '×' } = {}) {
  let html = groupDigits(esc(times === '×' ? text : String(text).replaceAll('×', times)))
    .replace(/(\d) (?=\S)/g, '$1\u00a0')
    .replace(/(\d+)\/(\d+)/g, (_, n, d) => fracHtml(n, d));
  if (ops) html = html.replace(/(^|[\s\u00a0])([+−×·:])(?=[\s\u00a0])/g, (_, before, op) => `${before}${opHtml(op)}`);
  return html;
}

const OP_CLASS = { '+': 'op-plus', '−': 'op-minus', '×': 'op-times', '·': 'op-times', ':': 'op-divide' };
export const opHtml = (op) => `<span class="op ${OP_CLASS[op] ?? ''}">${esc(op)}</span>`;

const needsWhole = (item) => item.answerType === 'fraction' && !!item.answer.whole;
const FRACTION_FIELDS = (item) => (needsWhole(item) ? ['whole', 'num', 'den'] : ['num', 'den']);

export function emptyInput(item) {
  if (item?.answerType === 'fraction') return { whole: '', num: '', den: '', field: FRACTION_FIELDS(item)[0] };
  return '';
}

export function isEmpty(item, input) {
  if (item.answerType === 'fraction') return !input.whole && !input.num && !input.den;
  return !input;
}

export function isComplete(item, input) {
  switch (item.answerType) {
    case 'fraction': return !!input.num && !!input.den && (!needsWhole(item) || !!input.whole);
    // Кома не може стояти з краю: «5,» (зліва направо) чи «,5» (справа наліво) — ще не число.
    case 'decimal': return !!input && !input.endsWith(',') && !input.startsWith(',');
    default: return !!input;
  }
}

const appendDigit = (value, digit, max = MAX_ANSWER_DIGITS) => {
  if (value === '0') return digit; // без нулів попереду
  return value.replace(',', '').length < max ? value + digit : value;
};

// Справа наліво (стовпчик): нова цифра стає ліворуч. Нуль першим дозволений —
// одиниці відповіді можуть дорівнювати 0.
const prependDigit = (value, digit, max = MAX_ANSWER_DIGITS) =>
  (value.replace(',', '').length < max ? digit + value : value);

// Натискання клавіші → новий стан поля. key: '0'…'9', ',', 'next', 'del'.
// rtl: true — введення справа наліво (лише для чисел у стовпчику).
export function applyKey(item, input, key, { rtl = false } = {}) {
  if (rtl && item.answerType !== 'fraction') {
    if (key === 'del') return input.slice(1);
    if (key === ',') {
      // Кома після дробової частини: «42» → «,42». Порожнє поле — нічого.
      if (item.answerType !== 'decimal' || !input || input.includes(',')) return input;
      return `,${input}`;
    }
    if (/^\d$/.test(key)) return prependDigit(input, key);
    return input;
  }
  if (item.answerType === 'fraction') {
    const fields = FRACTION_FIELDS(item);
    const next = { ...input };
    const i = fields.indexOf(next.field);
    if (key === 'next') next.field = fields[(i + 1) % fields.length];
    else if (key === 'del') {
      if (next[next.field]) next[next.field] = next[next.field].slice(0, -1);
      else if (i > 0) next.field = fields[i - 1];
    } else if (/^\d$/.test(key)) next[next.field] = appendDigit(next[next.field], key, 4);
    return next;
  }
  if (key === 'del') return input.slice(0, -1);
  if (key === ',') {
    if (item.answerType !== 'decimal' || input.includes(',')) return input;
    return (input || '0') + ',';
  }
  if (/^\d$/.test(key)) return appendDigit(input, key);
  return input;
}

export const selectField = (input, field) => ({ ...input, field });

// Поле відповіді. state: null (вводиться) | 'ok' | 'bad'.
// group: false — без розрядних пробілів (у стовпчику цифри мають стояти під розрядами).
// caret: 'left' | 'right' — миготливий курсор там, де з'явиться наступна цифра.
export function answerHtml(item, input, state, { group = true, caret = null } = {}) {
  const mark = state ? ` ${state}` : '';
  if (item.answerType === 'fraction') {
    const box = (field) => {
      const active = !state && input.field === field ? ' active' : '';
      const empty = !input[field] ? ' empty' : '';
      return `<span class="frac-box${active}${empty}" data-field="${field}">${esc(input[field] || '\u00a0')}</span>`;
    };
    return `<span class="frac-input${mark}">${needsWhole(item) ? box('whole') : ''}`
      + `<span class="frac">${box('num')}${box('den')}</span></span>`;
  }
  const empty = !state && !input ? ' empty' : '';
  const shown = state === 'bad' ? input || '?' : input;
  const text = esc((group ? groupDigits : String)(shown || (caret && !state ? '' : '\u00a0')));
  if (caret && !state) {
    const caretEl = '<span class="caret" aria-hidden="true"></span>';
    return `<span class="blank${empty}">${caret === 'left' ? caretEl + text : text + caretEl}</span>`;
  }
  return `<span class="blank${mark}${empty}">${text}</span>`;
}

// \u041f\u0435\u0440\u0435\u043c\u0438\u043a\u0430\u0447 \u043d\u0430\u043f\u0440\u044f\u043c\u0443 \u0432\u0432\u0435\u0434\u0435\u043d\u043d\u044f \u0432 \u0441\u0442\u043e\u0432\u043f\u0447\u0438\u043a\u0443: \u2190 \u0441\u043f\u0440\u0430\u0432\u0430 \u043d\u0430\u043b\u0456\u0432\u043e, \u2192 \u0437\u043b\u0456\u0432\u0430 \u043d\u0430\u043f\u0440\u0430\u0432\u043e.
// flip \u2014 \u0449\u043e\u0439\u043d\u043e \u043f\u0435\u0440\u0435\u043c\u043a\u043d\u0443\u043b\u0438: \u0441\u0442\u0440\u0456\u043b\u043a\u0430 \u0440\u043e\u0437\u0432\u0435\u0440\u0442\u0430\u0454\u0442\u044c\u0441\u044f \u0437 \u0430\u043d\u0456\u043c\u0430\u0446\u0456\u0454\u044e.
export function directionToggleHtml(dir, { disabled = false, flip = false } = {}) {
  const label = dir === 'rtl' ? '\u0426\u0438\u0444\u0440\u0438 \u0432\u0432\u043e\u0434\u044f\u0442\u044c\u0441\u044f \u0441\u043f\u0440\u0430\u0432\u0430 \u043d\u0430\u043b\u0456\u0432\u043e. \u041d\u0430\u0442\u0438\u0441\u043d\u0438, \u0449\u043e\u0431 \u0437\u043c\u0456\u043d\u0438\u0442\u0438' : '\u0426\u0438\u0444\u0440\u0438 \u0432\u0432\u043e\u0434\u044f\u0442\u044c\u0441\u044f \u0437\u043b\u0456\u0432\u0430 \u043d\u0430\u043f\u0440\u0430\u0432\u043e. \u041d\u0430\u0442\u0438\u0441\u043d\u0438, \u0449\u043e\u0431 \u0437\u043c\u0456\u043d\u0438\u0442\u0438';
  return `<button class="dir-toggle ${dir}${flip ? ' flip' : ''}" id="dir-toggle" aria-label="${label}" title="${label}" ${disabled ? 'disabled' : ''}>\u2190</button>`;
}

// Приклад стовпчиком: числа одне над одним, знак зліва, риска, під нею поле відповіді.
// Цифри однакової ширини (tabular-nums) і без розрядних пробілів, тож розряди стоять
// точно один під одним. align "comma": кома під комою — короткі дробові частини
// доповнюємо невидимими «цифровими» пробілами, а число без коми — ще й «пробілом коми».
export function columnHtml(column, answerBox, toggle = '') {
  let rows = column.rows;
  if (column.align === 'comma') {
    const fracLen = rows.map((r) => (r.split(',')[1] ?? '').length);
    const max = Math.max(...fracLen);
    if (max) {
      rows = rows.map((r, i) => r + (r.includes(',') ? '' : '\u2008') + '\u2007'.repeat(max - fracLen[i]));
    }
  }
  // Знак дії — між двома числами по вертикалі, як у підручниках.
  return `<div class="column-task">
      <span class="col-sign">${opHtml(column.sign)}</span>
      <span class="col-num col-top">${esc(rows[0])}</span>
      <span class="col-num col-bottom">${esc(rows[1])}</span>
      <span class="col-line"></span>
      <span class="col-toggle">${toggle}</span><span class="col-answer">${answerBox}</span>
    </div>`;
}

// Клавіатура під тип відповіді.
export function keypadHtml(item, input, disabled) {
  const dis = disabled ? 'disabled' : '';
  if (item.answerType === 'choice') {
    return `<div class="choices">${item.choices.map((c) => `<button class="key choice" data-choice="${esc(c)}" ${dis}>${esc(c)}</button>`).join('')}</div>`;
  }
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button class="key" data-key="${d}" ${dis}>${d}</button>`).join('');
  const del = `<button class="key key-del" data-key="del" ${dis} aria-label="Стерти">⌫</button>`;
  const zero = `<button class="key" data-key="0" ${dis}>0</button>`;
  const ok = (wide) => `<button class="key key-ok${wide ? ' key-wide' : ''}" data-key="ok" ${disabled || !isComplete(item, input) ? 'disabled' : ''} aria-label="Перевірити">✓</button>`;

  if (item.answerType === 'decimal') {
    return `<div class="numpad">${digits}<button class="key key-extra" data-key="," ${dis} aria-label="Кома">,</button>${zero}${del}${ok(true)}</div>`;
  }
  if (item.answerType === 'fraction') {
    return `<div class="numpad">${digits}<button class="key key-extra" data-key="next" ${dis} aria-label="Наступне поле">→</button>${zero}${del}${ok(true)}</div>`;
  }
  return `<div class="numpad">${digits}${del}${zero}${ok(false)}</div>`;
}

// Клавіша фізичної клавіатури → клавіша екранної (або null).
export function physicalKey(item, e) {
  if (/^[0-9]$/.test(e.key)) return e.key;
  if (e.key === 'Backspace') return 'del';
  if (e.key === 'Enter') return 'ok';
  if (item.answerType === 'decimal' && (e.key === ',' || e.key === '.')) return ',';
  if (item.answerType === 'fraction' && (e.key === '/' || e.key === 'Tab' || e.key === 'ArrowRight')) return 'next';
  return null;
}
