// Ділення кутом з проміжними рядками (docs/EQUATION-STEPS.md → «Розписати ділення»).
//
// longDivision(745, 8) повертає поля в тому порядку, у якому ділять на папері:
//   q — цифра частки;
//   p — добуток під неповним діленим (від'ємник);
//   d — різниця разом зі знесеною цифрою (наступне неповне ділене);
//   r — остача (останній рядок).
// Для p, d, r: from…to — номери цифр діленого (з 0), під якими стоїть рядок.
// Ширина рядка — по можливих цифрах, а не по фактичному значенню, щоб поле
// не підказувало, скільки цифр у відповіді: різниця менша за дільник, тож
// займає не більше цифр, ніж дільник.
//
// 745 : 8 → q 9 · p 72 (0…1) · d 25 (1…2) · q 3 · p 24 (1…2) · r 1 (2…2).
// 816 : 8 → q 1 · p 8 · d 16 · q 0 · q 2 · p 16 · r 0 (0 у частці — коли знесене
// число менше за дільник: зносимо ще цифру, а в частці пишемо 0).

export function longDivision(dividend, divisor) {
  const digits = String(dividend).split('').map(Number);
  const last = digits.length - 1;
  const restWidth = String(divisor).length;
  const fields = [];

  // Перше неповне ділене — найкоротший початок числа, не менший за дільник.
  let pos = 0;
  let cur = digits[0];
  while (cur < divisor && pos < last) cur = cur * 10 + digits[++pos];
  let from = 0;

  for (;;) {
    const q = Math.floor(cur / divisor);
    fields.push({ kind: 'q', value: q });
    if (q === 0) {
      // Ділене менше за дільник: частка 0, остача — саме ділене.
      fields.push({ kind: 'r', value: cur, from, to: pos });
      break;
    }
    const product = q * divisor;
    fields.push({ kind: 'p', value: product, from, to: pos });
    const rest = cur - product;
    const restFrom = Math.max(from, pos - restWidth + 1);
    if (pos === last) {
      fields.push({ kind: 'r', value: rest, from: restFrom, to: pos });
      break;
    }
    // Зносимо цифру; поки число менше за дільник — у частці 0 і зносимо ще.
    // Спершу дитина записує різницю з усіма знесеними цифрами, потім нулі частки (issue #6).
    cur = rest * 10 + digits[++pos];
    const zeros = [];
    while (cur < divisor && pos < last) {
      zeros.push({ kind: 'q', value: 0 });
      cur = cur * 10 + digits[++pos];
    }
    if (cur < divisor) {
      fields.push({ kind: 'r', value: cur, from: restFrom, to: pos }, ...zeros, { kind: 'q', value: 0 });
      break;
    }
    fields.push({ kind: 'd', value: cur, from: restFrom, to: pos }, ...zeros);
    from = restFrom;
  }
  return fields;
}

// Частка, складена з цифр q, введених дитиною (порожні цифри — пропуск).
export const quotientOf = (fields, values) =>
  fields.map((f, i) => (f.kind === 'q' ? values[i] ?? '' : '')).join('');

// Рядки, які дитина сама вписала під діленим (конструктор, issue #8): дитина
// може відняти й більший добуток одразу (72 − 70, а не 7 − 5), тож і місце
// рядка, і його перевірку визначаємо за введеними числами, а не за одним
// «правильним» розв'язком. Рядки йдуть по черзі: від'ємник, різниця, від'ємник…
//   від'ємник — під найкоротшим початком діленого, не меншим за нього
//              (перший), або під попередньою різницею; правильний, якщо
//              ділиться на дільник і не більший за зменшуване;
//   різниця    — зменшуване мінус від'ємник і знесені цифри (0, 1, 2… —
//              скільки дитина знесла); правильна, якщо збігається з одним
//              із цих варіантів; value — правильна з однією знесеною цифрою.
// Повертає для кожного рядка { kind: 'p' | 'd', end, minuendStart, correct, value }:
// end — номер цифри діленого, під якою закінчується рядок.
export function divisionRows(dividend, divisor, rows) {
  const digits = String(dividend).split('').map(Number);
  const last = digits.length - 1;
  const out = [];
  let minuend = 0;
  let mEnd = 0;
  let mStart = 0;
  let sub = null;
  rows.forEach((raw, i) => {
    const v = raw === '' ? null : Number(raw);
    if (i % 2 === 0) {
      if (i === 0) {
        const target = v ?? divisor;
        let end = 0;
        let val = digits[0];
        while (val < target && end < last) val = val * 10 + digits[++end];
        minuend = val;
        mEnd = end;
        mStart = 0;
      }
      sub = v;
      out.push({ kind: 'p', end: mEnd, minuendStart: mStart, correct: v != null && v > 0 && v % divisor === 0 && v <= minuend, value: null });
      return;
    }
    const rest = sub == null ? null : minuend - sub;
    const withDigits = (k) => Number(String(rest) + digits.slice(mEnd + 1, mEnd + 1 + k).join(''));
    let k = null;
    if (v != null && rest != null && rest >= 0) {
      for (let j = 0; j <= last - mEnd && k == null; j++) if (withDigits(j) === v) k = j;
    }
    const brought = k ?? Math.min(1, last - mEnd);
    const end = mEnd + brought;
    const value = rest != null && rest >= 0 ? withDigits(Math.min(1, last - mEnd)) : null;
    out.push({ kind: 'd', end, minuendStart: null, correct: k != null, value });
    minuend = v ?? value ?? 0;
    mStart = end - (raw || String(minuend)).length + 1;
    mEnd = end;
  });
  return out;
}
