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
export const groupDigits = (s) => String(s).replace(/\d{5,}/g, (n) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ' '));

const fracHtml = (num, den) => `<span class="frac"><span class="frac-num">${num}</span><span class="frac-den">${den}</span></span>`;

// Текст завдання → HTML: екранування, розряди, нерозривний пробіл після
// числа («7 см» не розривається), n/d — «двоповерховий» дріб.
export function mathHtml(text) {
  return groupDigits(esc(text))
    .replace(/(\d) (?=\S)/g, '$1 ')
    .replace(/(\d+)\/(\d+)/g, (_, n, d) => fracHtml(n, d));
}

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
    case 'decimal': return !!input && !input.endsWith(',');
    default: return !!input;
  }
}

const appendDigit = (value, digit, max = MAX_ANSWER_DIGITS) => {
  if (value === '0') return digit; // без нулів попереду
  return value.replace(',', '').length < max ? value + digit : value;
};

// Натискання клавіші → новий стан поля. key: '0'…'9', ',', 'next', 'del'.
export function applyKey(item, input, key) {
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
export function answerHtml(item, input, state) {
  const mark = state ? ` ${state}` : '';
  if (item.answerType === 'fraction') {
    const box = (field) => {
      const active = !state && input.field === field ? ' active' : '';
      const empty = !input[field] ? ' empty' : '';
      return `<span class="frac-box${active}${empty}" data-field="${field}">${esc(input[field] || ' ')}</span>`;
    };
    return `<span class="frac-input${mark}">${needsWhole(item) ? box('whole') : ''}`
      + `<span class="frac">${box('num')}${box('den')}</span></span>`;
  }
  const empty = !state && !input ? ' empty' : '';
  const shown = state === 'bad' ? input || '?' : input;
  return `<span class="blank${mark}${empty}">${esc(groupDigits(shown || ' '))}</span>`;
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
