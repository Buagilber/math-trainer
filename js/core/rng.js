// Детермінований генератор випадкових чисел (mulberry32).
// Однаковий seed дає однакову послідовність — це потрібно для тестів
// і легко відтворюється в будь-якій мові (Kotlin/Swift).

export function createRng(seed = Date.now()) {
  let state = seed >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Ціле число з [min, max] з кроком step.
  function int(min, max, step = 1) {
    const count = Math.floor((max - min) / step) + 1;
    return min + step * Math.floor(next() * count);
  }

  function pick(list) {
    return list[Math.floor(next() * list.length)];
  }

  // Вибір елемента з урахуванням ваги (getWeight(item) >= 0).
  function weighted(list, getWeight) {
    const total = list.reduce((sum, item) => sum + getWeight(item), 0);
    let r = next() * total;
    for (const item of list) {
      r -= getWeight(item);
      if (r < 0) return item;
    }
    return list[list.length - 1];
  }

  function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  return { next, int, pick, weighted, shuffle };
}
