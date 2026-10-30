// Правило появи підказки (специфікація — docs/HINTS.md).
//
// Кнопка 💡 з'являється, коли одночасно:
//   1) час на приклад ≥ поріг = clamp(2 × мій середній час на рівні, мінімум, 45 с),
//      мінімум = 15 / 20 / 25 с для рівнів 1 / 2 / 3, +10 с для текстових задач;
//      автор контенту може задати свій поріг (hintAfterSec);
//   2) дитина не вводить відповідь: поле порожнє або не змінювалося 8 с.

export const HINT_MIN_SEC = { 1: 15, 2: 20, 3: 25 };
export const TEXT_TASK_EXTRA_SEC = 10;
export const HINT_MAX_SEC = 45;
export const INPUT_IDLE_MS = 8000;
export const MAX_HINT_LENGTH = 200; // підказка-рядок
export const MAX_HINT_RULES = 4;
export const MAX_HINT_SCHEME = 4;
export const MAX_HINT_LINE = 120; // один рядок правила чи схеми

// Підказка в даних — рядок або { rules: [...], scheme: [...] }.
//   rules  — що робити, кожне правило окремим рядком;
//   scheme — назви частин прикладу («зменшуване − від'ємник = різниця»).
// Повертає { rules, scheme } або null, якщо підказки немає.
export function normalizeHint(hint) {
  if (!hint) return null;
  if (typeof hint === 'string') return { rules: [hint], scheme: [] };
  return { rules: [].concat(hint.rules ?? []), scheme: [].concat(hint.scheme ?? []) };
}

// Перелік порушень формату (порожній — підказка коректна).
export function hintProblems(hint) {
  if (hint === undefined) return [];
  if (typeof hint === 'string') {
    return hint.length > MAX_HINT_LENGTH ? [`підказка довша за ${MAX_HINT_LENGTH} символів`] : [];
  }
  if (!hint || typeof hint !== 'object' || !Array.isArray(hint.rules ?? []) || !Array.isArray(hint.scheme ?? [])) {
    return ['підказка має бути рядком або { rules: [...], scheme: [...] }'];
  }
  const { rules, scheme } = normalizeHint(hint);
  const problems = [];
  if (!rules.length) problems.push('у підказці немає правил (rules)');
  if (rules.length > MAX_HINT_RULES) problems.push(`у підказці більше ${MAX_HINT_RULES} правил`);
  if (scheme.length > MAX_HINT_SCHEME) problems.push(`у схемі підказки більше ${MAX_HINT_SCHEME} рядків`);
  if ([...rules, ...scheme].some((l) => typeof l !== 'string' || l.length > MAX_HINT_LINE)) {
    problems.push(`рядок підказки довший за ${MAX_HINT_LINE} символів`);
  }
  return problems;
}

// Текстова задача — без □ у тексті; рівняння з x (answerPrefix) до них не належать.
const isTextTask = (item) => !item.text.includes('□') && !item.answerPrefix;

export function hintDelayMs(item, level, lastAvgMs) {
  if (item.hintAfterSec) return item.hintAfterSec * 1000;
  const min = ((HINT_MIN_SEC[level] ?? HINT_MIN_SEC[3]) + (isTextTask(item) ? TEXT_TASK_EXTRA_SEC : 0)) * 1000;
  const max = Math.max(min, HINT_MAX_SEC * 1000);
  const adaptive = lastAvgMs ? 2 * lastAvgMs : 0;
  return Math.min(Math.max(adaptive, min), max);
}

export function shouldOfferHint({ item, elapsedMs, sinceInputMs, inputEmpty, delayMs }) {
  if (!item.hint) return false;
  return elapsedMs >= delayMs && (inputEmpty || sinceInputMs >= INPUT_IDLE_MS);
}
