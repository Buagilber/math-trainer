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
export const MAX_HINT_LENGTH = 200;

const isTextTask = (item) => !item.text.includes('□');

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
