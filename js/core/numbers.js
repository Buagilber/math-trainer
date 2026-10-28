// Точна арифметика для десяткових і звичайних дробів — без похибок float.
//
// Десятковий дріб: { units, scale } = units / 10^scale (2,35 → { units: 235, scale: 2 }).
// Звичайний дріб:  { whole?, num, den }            (1 2/7 → { whole: 1, num: 2, den: 7 }).

export const pow10 = (k) => 10 ** k;

export function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

// ---------- десяткові ----------

// Прибирає нулі в кінці дробової частини: 2,50 → 2,5.
export function normalizeDecimal({ units, scale }) {
  while (scale > 0 && units % 10 === 0) {
    units /= 10;
    scale--;
  }
  return { units, scale };
}

// Запис з комою, рівно scale знаків після коми (3,50 лишається 3,50).
export function formatDecimal({ units, scale }) {
  const neg = units < 0;
  let s = String(Math.abs(units));
  if (scale > 0) {
    s = s.padStart(scale + 1, '0');
    s = `${s.slice(0, -scale)},${s.slice(-scale)}`;
  }
  return (neg ? '-' : '') + s;
}

// «12,5», «12.5», «12» → { units, scale }; некоректний рядок → null.
export function parseDecimal(text) {
  const m = /^(\d+)(?:[,.](\d+))?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  return normalizeDecimal({ units: Number(m[1] + frac), scale: frac.length });
}

// Знак різниці a − b (від'ємне, 0 або додатне).
export function compareDecimals(a, b) {
  const s = Math.max(a.scale, b.scale);
  return a.units * pow10(s - a.scale) - b.units * pow10(s - b.scale);
}

export const decimalsEqual = (a, b) => compareDecimals(a, b) === 0;

// ---------- звичайні ----------

export const improper = ({ whole = 0, num, den }) => ({ num: whole * den + num, den });

export function compareFractions(a, b) {
  const x = improper(a);
  const y = improper(b);
  return x.num * y.den - y.num * x.den;
}

export const fractionsEqual = (a, b) => compareFractions(a, b) === 0;

export function formatFraction({ whole, num, den }) {
  const f = `${num}/${den}`;
  return whole ? `${whole} ${f}` : f;
}
