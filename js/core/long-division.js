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
// 816 : 8 → q 1 · p 8 · q 0 · d 16 · q 2 · p 16 · r 0 (0 у частці — коли знесене
// число менше за дільник: пишемо 0 і зносимо наступну цифру).

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
    cur = rest * 10 + digits[++pos];
    while (cur < divisor && pos < last) {
      fields.push({ kind: 'q', value: 0 });
      cur = cur * 10 + digits[++pos];
    }
    if (cur < divisor) {
      fields.push({ kind: 'q', value: 0 }, { kind: 'r', value: cur, from: restFrom, to: pos });
      break;
    }
    fields.push({ kind: 'd', value: cur, from: restFrom, to: pos });
    from = restFrom;
  }
  return fields;
}

// Частка, складена з цифр q, введених дитиною (порожні цифри — пропуск).
export const quotientOf = (fields, values) =>
  fields.map((f, i) => (f.kind === 'q' ? values[i] ?? '' : '')).join('');
