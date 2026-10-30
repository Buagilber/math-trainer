// Формати для показу користувачу.

import { pluralUk } from '../core/generators.js';
import { calendarDaysBetween } from '../core/progress.js';

// Як давно була остання сесія: «сьогодні», «вчора», «5 днів тому»,
// «3 тижні тому» (з 14 днів), «4 місяці тому» (з 60 днів), «понад рік тому».
export function formatAgo(timestamp, now = Date.now()) {
  const days = Math.max(0, calendarDaysBetween(timestamp, now));
  if (days === 0) return 'сьогодні';
  if (days === 1) return 'вчора';
  if (days < 14) return `${days} ${pluralUk(days, 'день', 'дні', 'днів')} тому`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${pluralUk(weeks, 'тиждень', 'тижні', 'тижнів')} тому`;
  }
  if (days < 365) {
    // Середній місяць ≈ 30,44 дня; межі — 2…11 місяців, далі «понад рік».
    const months = Math.min(11, Math.max(2, Math.round(days / 30.44)));
    return `${months} ${pluralUk(months, 'місяць', 'місяці', 'місяців')} тому`;
  }
  return 'понад рік тому';
}
