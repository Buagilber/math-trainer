// Інтерфейс: привітання, вибір класу, розділи, рівні, сесія та підсумок.
//
// Кожен екран має свою адресу (#/grade/g2, #/topic/g2-mul…), тому закладка
// відкриває саме той екран, де її зробили, а системна кнопка «Назад»
// на Android повертає на попередній екран.

import { CONFIG } from '../config.js';
import { createRng } from '../core/rng.js';
import { pluralUk } from '../core/generators.js';
import { buildSession, submitAnswer, isFinished, summarize, levelsOf, formatAnswer, checkAnswer } from '../core/session.js';
import { sessionRecord, topicProgress, levelProgress, compareWithPrevious, staleness, worstStaleness } from '../core/progress.js';
import { hintDelayMs, shouldOfferHint, normalizeHint } from '../core/hints.js';
import { esc, mathHtml, emptyInput, applyKey, isComplete, isEmpty, selectField, answerHtml, columnHtml, divisionHtml, writtenDivisionHtml, writtenMultiplicationHtml, directionToggleHtml, keypadHtml, physicalKey } from './answer-input.js';
import { loadContent } from './content.js';
import { longDivision, divisionRows } from '../core/long-division.js';
import { longMultiplication } from '../core/long-multiplication.js';
import { MAX_EXTRA, MULTI_SIGNS, calc, askOptions, meaningOf, noteOptions, multiSummary } from '../core/multistep.js';
import { ORDER_RULES, allowedOps, whyNotOp, reduceTokens, orderCalc } from '../core/order-steps.js';
import { formatAgo } from './format.js';
import { decimalsEqual, parseDecimal } from '../core/numbers.js';
// «9,7» і «9,70» — те саме число.
const sameDecimal = (x, y) => { const a = parseDecimal(String(x)); const b = parseDecimal(String(y)); return !!a && !!b && decimalsEqual(a, b); };
import { openReportDialog, contextText } from './feedback.js';
import { progressStore, storage, pinStore } from './storage.js';

const root = document.getElementById('app');
const WELCOMED_KEY = 'mt.welcomed';
const INPUT_DIR_KEY = 'mt.columnInputDir';
// Бульбашка біля стрілки напряму: раз за сесію, у перших DIR_TIP_SESSIONS сесіях зі стовпчиком.
const DIR_TIP_KEY = 'mt.dirTipSessions';
const DIR_TIP_SESSIONS = 3;
const DIR_TIP_TEXT = {
  rtl: 'Цифри з\'являються справа, як у зошиті. Натисни стрілку, щоб писати зліва направо.',
  ltr: 'Цифри з\'являються зліва направо. Натисни стрілку, щоб писати справа наліво, як у зошиті.',
};

const state = {
  content: null,
  session: null, // активна сесія (core/session.js)
  sessionStartedAt: 0,
  questionStartedAt: 0,
  input: '', // рядок або { whole, num, den, field } для дробів (див. answer-input.js)
  feedback: null, // { correct, item } після відповіді
  // Підказка до поточного прикладу: visible — кнопка 💡 показана, open — картка
  // відкрита, used — дитина відкривала підказку, fresh — щойно з'явилась (анімація).
  hint: { visible: false, open: false, used: false, fresh: false, animate: false },
  // Крок «Обрати дію» в рівнянні: stage 'idle' | 'choose' | 'compute', choice — номер варіанта.
  steps: { stage: 'idle', choice: null },
  // Розписаний запис (ділення кутом чи множення стовпчиком) — див. «конструктор» нижче; null — немає.
  written: null,
  lastInputAt: 0,
  // Напрям введення в стовпчику: 'rtl' (справа наліво, як у зошиті) або 'ltr'.
  // Вибір запам'ятовується на пристрої. dirFlip — щойно перемкнули (анімація стрілки).
  inputDir: storage.get(INPUT_DIR_KEY) === 'ltr' ? 'ltr' : 'rtl',
  dirFlip: false,
  // Бульбашка-пояснення стрілки в цій сесії: 'pending' — ще не показували, 'shown', 'done'.
  dirTip: 'pending',
  contentLoadedAt: 0, // коли востаннє завантажено data/
  refreshPending: false, // оновлення відкладене до кінця тренування
};

// Скидання стану, прив'язаного до одного прикладу: підказка й крок «Обрати дію».
const resetHint = () => {
  state.hint = { visible: false, open: false, used: false, fresh: false, animate: false };
  state.steps = { stage: 'idle', choice: null };
  state.written = null;
  state.multi = null;
  state.lastInputAt = Date.now();
};


const findGrade = (id) => state.content.grades.find((g) => g.id === id);
const findTopic = (id) => state.content.grades.flatMap((g) => g.topics).find((t) => t.id === id);
const gradeOfTopic = (id) => state.content.grades.find((g) => g.topics.some((t) => t.id === id));
const levelName = (level) => state.content.levels[level] ?? `Рівень ${level}`;

// 6200 → «6,2 с», 65000 → «1 хв 5 с».
function formatDuration(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1).replace('.', ',')} с`;
  const min = Math.floor(sec / 60);
  return `${min} хв ${Math.round(sec - min * 60)} с`;
}

// Зірки з кроком 0,5: кожна зірка — сіра основа й жовте заповнення потрібної ширини.
function starsHtml(count, max = 3) {
  const label = String(count).replace('.', ',');
  const stars = Array.from({ length: max }, (_, i) => {
    const fill = Math.max(0, Math.min(1, count - i)) * 100;
    return `<span class="star"><span class="star-fill" style="width:${fill}%">★</span>★</span>`;
  }).join('');
  return `<span class="stars" role="img" aria-label="${label} з ${max} зірок">${stars}</span>`;
}

// Власне вікно підтвердження замість системного confirm().
// Повертає Promise<boolean>. Вікно не залежить від перемальовування екрана
// (наприклад, автоперехід після правильної відповіді), а при переході
// на інший екран (зокрема системна «Назад») його прибирає render().
function confirmDialog({ icon = '', title, text, confirm, cancel }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-backdrop';
    overlay.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
        ${icon ? `<div class="dialog-icon" aria-hidden="true">${icon}</div>` : ''}
        <h2 id="dialog-title">${esc(title)}</h2>
        <p>${esc(text)}</p>
        <div class="dialog-actions">
          <button class="btn btn-primary" data-answer="no">${esc(cancel)}</button>
          <button class="btn" data-answer="yes">${esc(confirm)}</button>
        </div>
      </div>`;
    const close = (result) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
      else e.stopPropagation(); // не передаємо цифри/Enter у клавіатуру сесії
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
      const answer = e.target.closest('[data-answer]')?.dataset.answer;
      if (answer) close(answer === 'yes');
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    overlay.querySelector('[data-answer="no"]').focus();
  });
}

// ---------- звернення про помилку чи пропозицію (docs/FEEDBACK.md) ----------

const reportButton = '<button class="icon-btn report-btn" data-report aria-label="Повідомити про помилку або ідею" title="Повідомити про помилку або ідею">⚑</button>';

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-report]')) openReportDialog(reportContext());
});

// Знімок екрана для звернення: де людина, що бачить і що ввела.
function reportContext() {
  const route = currentRoute();
  const s = state.session;
  const pairs = [['екран', location.hash || '#/'], ['час', new Date().toISOString()]];
  if (route.name === 'grade') pairs.push(['клас', findGrade(route.id)?.title]);
  if (route.name === 'topic') {
    pairs.push(['клас', gradeOfTopic(route.id)?.title], ['розділ', `${findTopic(route.id)?.title} (${route.id})`]);
  }
  if (route.sub === 'play' && s) {
    const fb = state.feedback;
    const item = fb ? fb.item : s.items[s.index];
    const chosen = chosenStep(item);
    pairs.push(
      ['рівень', levelName(s.level)],
      ['приклад', `${fb ? s.index : s.index + 1} з ${s.items.length}`],
      ['завдання', item.exerciseId],
      ['інструкція', item.prompt],
      ['текст', item.text],
      ['правильна відповідь', formatAnswer(item.answerType, item.answer)],
      ['введено', formatAnswer(item.answerType, state.input)],
      ['стан', fb ? (fb.correct ? 'відповідь правильна' : 'відповідь неправильна') : 'відповідь ще не дано'],
      ['підказка', state.hint.open ? 'відкрита' : state.hint.visible ? 'кнопка показана' : 'не показана'],
      ['крок «Обрати дію»', item.steps
        ? (chosen ? `обрано ${chosen.left} ${chosen.sign} ${chosen.right}` : state.steps.stage === 'choose' ? 'обирає дію' : 'не відкривали')
        : undefined],
      ['напрям введення', columnFor(item) ? state.inputDir : undefined],
      ['розв\'язання по діях', state.multi
        ? `${state.multi.mode}/${state.multi.noteMode}: ${state.multi.lines.map((l, i) => `${i + 1}) ${l.expr[0]} ${MULTI_SIGNS[l.expr[1]]} ${l.expr[2]} = ${l.given || '?'}`).join('; ') || 'ще без дій'}`
        : undefined],
    );
  }
  if (route.sub === 'result' && s) {
    const sum = summarize(s);
    pairs.push(
      ['рівень', levelName(s.level)],
      ['результат', `${sum.correct} з ${sum.total}`],
      ['помилки', sum.mistakes.map((m) => `${m.exerciseId}: ${m.text} → ${m.given} (треба ${m.answerText})`).join('; ')],
    );
  }
  pairs.push(
    ['пристрій', navigator.userAgent],
    ['розмір екрана', `${innerWidth}×${innerHeight}`],
    ['режим', matchMedia('(display-mode: standalone)').matches ? 'встановлений застосунок' : 'браузер'],
  );
  return contextText(pairs);
}

// ---------- навігація ----------
//
// history.state.depth — скільки кроків зроблено всередині застосунку.
// Кнопка «←» робить history.back(), якщо є куди повертатися в межах
// застосунку, інакше (відкрили закладку) переходить на батьківський екран.

function go(path, { replace = false } = {}) {
  const depth = (history.state?.depth ?? 0) + (replace ? 0 : 1);
  if (replace) history.replaceState({ depth }, '', `#${path}`);
  else history.pushState({ depth }, '', `#${path}`);
  render();
}

function up(parentPath) {
  if ((history.state?.depth ?? 0) > 0) history.back();
  else go(parentPath, { replace: true });
}

window.addEventListener('popstate', render);

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] ?? '', id: parts[1], sub: parts[2] };
}

async function render() {
  document.querySelectorAll('.dialog-backdrop').forEach((el) => el.remove());
  if (!state.content) {
    root.className = '';
    root.innerHTML = '<div class="center muted">Завантаження…</div>';
    try {
      state.content = await loadContent();
      state.contentLoadedAt = Date.now();
    } catch (e) {
      root.innerHTML = `<div class="center"><p>Не вдалося завантажити завдання.</p><p class="muted">${esc(e.message)}</p>
        <button class="btn" onclick="location.reload()">Спробувати ще раз</button></div>`;
      return;
    }
  }
  window.scrollTo(0, 0);
  // Оновлення, відкладене до кінця тренування (див. «Оновлення контенту»).
  if (state.refreshPending && currentRoute().sub !== 'play') {
    state.refreshPending = false;
    refreshContent();
  }

  // Привітання показується при першому запуску, доки не натиснуто кнопку.
  if (storage.get(WELCOMED_KEY) !== '1') return renderWelcome({ firstRun: true });

  const route = currentRoute();
  root.className = `screen-${route.name || 'grades'}`;
  switch (route.name) {
    case 'about': return renderWelcome({ firstRun: false });
    case 'grade': return renderGrade(route.id);
    case 'pinned': return renderPinned();
    case 'topic':
      if (route.sub === 'play') return state.session?.topicId === route.id ? renderSession() : go(`/topic/${route.id}`, { replace: true });
      if (route.sub === 'result') return state.session?.topicId === route.id ? renderSummary() : go(`/topic/${route.id}`, { replace: true });
      return renderTopic(route.id);
    default: return renderGrades();
  }
}

// ---------- привітання / «Про застосунок» ----------

function renderWelcome({ firstRun }) {
  root.className = 'screen-welcome';
  const available = state.content.grades.filter((g) => g.topics.length).map((g) => g.title);
  const availableText = available.length
    ? `Зараз ${available.length > 1 ? 'доступні' : 'доступний'}: ${available.join(', ')}. Інші класи — незабаром.`
    : '';

  root.innerHTML = `
    ${firstRun ? '' : '<button class="icon-btn welcome-back" id="back" aria-label="Назад">←</button>'}
    <main class="welcome">
      <div class="welcome-hero" aria-hidden="true">
        <div class="demo-card demo-back">6 × 4 = <span class="blank">24</span></div>
        <div class="demo-card demo-front">8 + 7 = <span class="blank ok">15</span></div>
      </div>
      <span class="beta-badge">🌱 Рання версія</span>
      <h1>Математика без підручника</h1>
      <p class="welcome-lead">Тренажер прикладів за програмою НУШ. Обери клас і тему — і одразу розв'язуй.</p>
      <ul class="welcome-points">
        <li><span class="point-icon">⚡</span><span><b>Швидко.</b> Не треба шукати зошит чи підручник</span></li>
        <li><span class="point-icon">🎲</span><span><b>Щоразу нові приклади</b> з обраної теми</span></li>
        <li><span class="point-icon">📊</span><span><b>Видно прогрес:</b> зірки, точність і час</span></li>
      </ul>
      <button class="btn btn-primary btn-cta" id="start">${firstRun ? 'Почати тренування' : 'До тренажера'}</button>
      <p class="welcome-note muted">${esc(availableText)}<br>Безкоштовно і без реєстрації. Прогрес зберігається на цьому пристрої.</p>
      <p class="welcome-disclaimer">Застосунок ще розвивається, тож подекуди можуть траплятися неточності. Ми постійно їх виправляємо.</p>
    </main>`;

  root.querySelector('#start').addEventListener('click', () => {
    if (firstRun) {
      storage.set(WELCOMED_KEY, '1');
      render(); // відкриваємо той екран, на який людина прийшла (за замовчуванням — вибір класу)
    } else {
      up('/');
    }
  });
  root.querySelector('#back')?.addEventListener('click', () => up('/'));
}

// ---------- вибір класу ----------

function renderGrades() {
  const records = progressStore.all();
  const pinned = pinnedTopics();
  const staleOf = (topics) => worstStaleness(topics.map((t) => topicStaleness(records, t)));
  const dot = (level) => (level ? `<span class="stale-dot ${level}" aria-label="${STALE_LABEL[level]}"></span>` : '');

  const pinnedTile = `<button class="grade-tile pinned-tile" data-pinned>
      ${dot(staleOf(pinned))}
      <span class="grade-number">📌</span>
      <span class="grade-label">Обрані</span>
      <span class="grade-meta">${pinned.length ? `${pinned.length} ${pluralUk(pinned.length, 'розділ', 'розділи', 'розділів')}` : 'порожньо'}</span>
    </button>`;
  const tiles = state.content.grades.map((g) => {
    const count = g.topics.length;
    const meta = count ? `${count} ${pluralUk(count, 'розділ', 'розділи', 'розділів')}` : 'Незабаром';
    return `<button class="grade-tile" data-grade="${esc(g.id)}" ${count ? '' : 'disabled'}>
        ${dot(staleOf(pinned.filter((t) => g.topics.includes(t))))}
        <span class="grade-number">${esc(g.grade ?? '')}</span>
        <span class="grade-label">клас</span>
        <span class="grade-meta">${meta}</span>
      </button>`;
  }).join('');

  root.innerHTML = `
    <header class="bar">
      <h1>Математика</h1>
      <button class="link-btn" id="about">Про застосунок</button>
      ${reportButton}
    </header>
    <main class="grades">
      <p class="muted">Обери клас:</p>
      <div class="grade-grid">${pinnedTile}${tiles}</div>
    </main>
    ${problemsHtml()}`;

  root.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => go(`/grade/${b.dataset.grade}`)));
  root.querySelector('[data-pinned]').addEventListener('click', () => go('/pinned'));
  root.querySelector('#about').addEventListener('click', () => go('/about'));
}

function problemsHtml() {
  const { errors } = state.content;
  return errors.length
    ? `<details class="warning"><summary>Частину завдань не завантажено (${errors.length})</summary><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>`
    : '';
}

// ---------- розділи класу й обрані ----------
//
// Закріплені розділи (📌) стоять угорі списку класу, а на екрані «Обрані» —
// усі разом: за класами, у межах класу — за порядком у програмі.
// Закріплений розділ, який давно не тренували, підсвічується (core/progress.js → staleness).

const STALE_LABEL = { warn: 'давно не тренувались', alert: 'дуже давно не тренувались' };

const topicStaleness = (records, t) => staleness(topicProgress(records, t.id, levelsOf(t)).lastAt);

function pinnedTopics() {
  const ids = new Set(pinStore.all());
  return state.content.grades.flatMap((g) => g.topics.filter((t) => ids.has(t.id)));
}

function topicCardHtml(t, records) {
  const p = topicProgress(records, t.id, levelsOf(t));
  const pinned = pinStore.has(t.id);
  const stale = pinned ? staleness(p.lastAt) : null;
  return `<div class="topic-item${stale ? ` stale-${stale}` : ''}">
      <button class="topic-card" data-topic="${esc(t.id)}">
        <span class="topic-icon">${esc(t.icon ?? '📘')}</span>
        <span class="topic-title">${esc(t.title)}</span>
        <span class="topic-meta">${p.sessions
          ? `${starsHtml(p.rating ?? 0)}<span class="ago"${stale ? ` title="${STALE_LABEL[stale]}"` : ''}>${formatAgo(p.lastAt)}</span>`
          : '<span class="muted">Ще не розпочато</span>'}</span>
      </button>
      <button class="pin-btn${pinned ? ' on' : ''}" data-pin="${esc(t.id)}" aria-pressed="${pinned}"
        aria-label="${pinned ? 'Відкріпити розділ' : 'Закріпити розділ'}">📌</button>
    </div>`;
}

function bindTopicCards(rerender) {
  root.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => go(`/topic/${b.dataset.topic}`)));
  root.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => {
    pinStore.toggle(b.dataset.pin);
    rerender();
  }));
}

function renderGrade(gradeId) {
  const grade = findGrade(gradeId);
  if (!grade || !grade.topics.length) return go('/', { replace: true });
  const records = progressStore.all();
  const pinned = grade.topics.filter((t) => pinStore.has(t.id));
  const rest = grade.topics.filter((t) => !pinStore.has(t.id));
  const sep = pinned.length && rest.length ? '<div class="topics-sep" role="separator"></div>' : '';

  root.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Назад">←</button>
      <h1>${esc(grade.title)}</h1>
      ${reportButton}
    </header>
    <main class="topics">${pinned.map((t) => topicCardHtml(t, records)).join('')}${sep}${rest.map((t) => topicCardHtml(t, records)).join('')}</main>`;

  root.querySelector('#back').addEventListener('click', () => up('/'));
  bindTopicCards(render);
}

function renderPinned() {
  const records = progressStore.all();
  const topics = pinnedTopics();
  const scrollY = window.scrollY;
  root.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Назад">←</button>
      <h1>Обрані</h1>
      ${reportButton}
    </header>
    <main class="topics">${topics.length
      ? topics.map((t) => topicCardHtml(t, records)).join('')
      : '<p class="muted topics-empty">Тут будуть важливі розділи. Щоб додати розділ, відкрий клас і натисни 📌 на картці розділу.</p>'}</main>`;
  window.scrollTo(0, scrollY);

  root.querySelector('#back').addEventListener('click', () => up('/'));
  bindTopicCards(renderPinned);
}

// ---------- вибір рівня ----------

function renderTopic(topicId) {
  const topic = findTopic(topicId);
  if (!topic) return go('/', { replace: true });
  const records = progressStore.all();

  const levelCard = (level) => {
    const p = levelProgress(records, topic.id, level);
    const stats = p.sessions
      ? `<span class="level-stats">Сесій: ${p.sessions} · точність загалом ${Math.round(p.accuracy * 100)}%</span>
         <span class="level-stats">Остання сесія: ${formatAgo(p.lastAt)}${p.lastAvgMs != null ? ` · ${formatDuration(p.lastAvgMs)} на приклад` : ''}</span>`
      : '<span class="level-stats">Ще не пройдено</span>';
    return `
      <button class="level-card" data-level="${level}">
        <span class="level-head">
          <span class="level-name">${esc(levelName(level))}</span>
          ${starsHtml(p.stars ?? 0)}
        </span>
        ${topic.levelNotes?.[level] ? `<span class="level-note">${esc(topic.levelNotes[level])}</span>` : ''}
        ${stats}
      </button>`;
  };

  root.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Назад">←</button>
      <h1>${esc(topic.icon ?? '')} ${esc(topic.title)}</h1>
      ${reportButton}
    </header>
    <main class="levels">
      <p class="muted">Обери рівень складності:</p>
      ${levelsOf(topic).map(levelCard).join('')}
    </main>`;

  root.querySelector('#back').addEventListener('click', () => up(`/grade/${gradeOfTopic(topic.id)?.id ?? ''}`));
  root.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => startSession(topic, Number(b.dataset.level))));
}

function startSession(topic, level, { replace = false } = {}) {
  state.session = buildSession(topic, level, createRng());
  state.dirTip = 'pending';
  state.sessionStartedAt = Date.now();
  state.questionStartedAt = Date.now();
  state.input = emptyInput(state.session.items[0]);
  state.feedback = null;
  resetHint();
  go(`/topic/${topic.id}/play`, { replace });
}

// ---------- сесія ----------

function renderSession() {
  const s = state.session;
  const fb = state.feedback;
  // Після відповіді index уже вказує на наступний приклад, а показуємо поточний.
  const item = fb ? fb.item : s.items[s.index];
  const number = fb ? s.index : s.index + 1;
  const topic = findTopic(s.topicId);

  const st = state.steps;
  const chosen = chosenStep(item);
  const column = columnFor(item);
  const rtl = !!column && !isDivision(column) && state.inputDir === 'rtl';
  const answerBox = answerHtml(item, state.input, fb ? (fb.correct ? 'ok' : 'bad') : null,
    { group: !column, caret: column ? (rtl ? 'left' : 'right') : null });
  const toggle = column && !isDivision(column) ? directionToggleHtml(state.inputDir, { disabled: !!fb, flip: state.dirFlip }) + dirTipHtml(item) : '';
  state.dirFlip = false;
  const hasInlineBlank = item.text.includes('□');
  // Рівняння з x показуємо так само великим шрифтом і з кольоровими знаками, як приклади.
  const isFormula = hasInlineBlank || !!item.answerPrefix;
  const work = item.column ? workHtml(item, item.column, answerBox, toggle, '', !!fb) : null;
  const prompt = work ? work.inner
    // Коли дитина обирає чи вже обрала дію, поле відповіді — у блоці кроку, а в прикладі лишається □.
    : isFormula ? mh(item.text, { ops: true }).replace('□', st.stage === 'idle' && (!state.multi || state.multi.phase === 'answer' || fb) ? answerBox : '<span class="blank-static">□</span>')
    : mh(item.text);
  // Під завданням без □: «Відповідь: □ см» або, для рівнянь, «x = □».
  // Коли дитина обирає чи вже обрала дію, x вводиться в блоці кроку.
  // «Розв'язання по діях»: поле відповіді є одразу (можна відповісти без дій), а під час дій — лише коли дитина вирішила вписати відповідь окремо.
  const m = state.multi;
  const answerRow = hasInlineBlank || item.column || st.stage !== 'idle' || (m && m.phase !== 'answer' && !fb) ? ''
    : `<div class="answer-row">${esc(item.answerPrefix ?? 'Відповідь:')} ${answerBox} ${esc(item.unit ?? '')}</div>`;
  const stepsArea = item.steps ? stepsAreaHtml(item, chosen, answerBox, toggle, !!fb) : item.multi || item.order ? multiAreaHtml(item, !!fb) : '';

  const canonical = item.steps?.canonical;
  const pathFailed = fb && !fb.correct && s.results.at(-1)?.multi?.pathOk === false && checkAnswer(item, state.input);
  // Обрана дія порахована неправильно, хоча число збіглося з відповіддю прикладу.
  const stepCalcFailed = fb && !fb.correct && chosen && checkAnswer(item, state.input) && Number(state.input) !== chosen.value;
  const feedback = fb
    ? fb.correct
      ? '<div class="feedback ok">Молодець! 🎉</div>'
      : stepCalcFailed
      ? `<div class="feedback bad">${mh(`${chosen.left} ${chosen.sign} ${chosen.right}`, { ops: true })} = ${mh(String(chosen.value))}, а не ${mh(String(state.input))}. Обрано не ту дію: ${esc(item.steps.label ?? item.answerPrefix ?? 'x =')} ${mh(`${canonical.left} ${canonical.sign} ${canonical.right}`, { ops: true })}.</div>
         <button class="btn btn-primary next" id="next">Далі</button>`
      : pathFailed
      ? `<div class="feedback bad">Відповідь збігається, але дії задачу не розв'язують: з іншими числами вони дали б іншу відповідь.</div>
         <button class="btn btn-primary next" id="next">Далі</button>`
      : `<div class="feedback bad">Правильна відповідь: <b>${mh(formatAnswer(item.answerType, item.answer))}</b>${canonical
          ? `, бо ${esc(item.steps.label ?? item.answerPrefix ?? 'x =')} ${mh(`${canonical.left} ${canonical.sign} ${canonical.right}`, { ops: true })}` : ''}</div>
         <button class="btn btn-primary next" id="next">Далі</button>`
    : '';

  // Місце для 💡 зарезервоване завжди, тож поява кнопки нічого не зсуває.
  const h = state.hint;
  const hintButton = `<button class="hint-btn${h.visible && !fb ? ' shown' : ''}${h.fresh ? ' fresh' : ''}${h.open ? ' active' : ''}" id="hint" aria-label="Підказка" ${h.visible && !fb ? '' : 'tabindex="-1" aria-hidden="true" disabled'}>💡</button>`;
  h.fresh = false;

  root.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="quit" aria-label="Завершити">✕</button>
      <div class="progress"><div class="progress-fill" style="width:${(s.index / s.items.length) * 100}%"></div></div>
      ${hintButton}
      <span class="counter">${number}/${s.items.length}</span>
      ${reportButton}
    </header>
    <main class="session">
      <p class="session-topic muted">${esc(topic?.title ?? '')} · ${esc(levelName(s.level))}</p>
      ${item.prompt ? `<p class="task-prompt">${esc(item.prompt)}</p>` : ''}
      <div class="task ${item.column ? 'task-column' : isFormula ? 'task-inline' : 'task-text'} ${!item.column && isFormula && item.text.length > 16 ? 'task-long' : ''}">${prompt}</div>
      ${work ? work.after : ''}
      ${answerRow}
      ${stepsArea}
      ${feedback}
    </main>
    ${keypadHtml(item, multiKeypadInput(item), !!fb || st.stage === 'choose' || multiKeypadOff(), state.written && { ok: writtenReady(state.written), comma: !!state.written.answerText })}`;

  root.querySelector('#quit').addEventListener('click', async () => {
    // Якщо ще нічого не розв'язано, втрачати нічого — виходимо без питань.
    const solved = s.results.length;
    if (solved && !(await confirmDialog({
      icon: '⏸️',
      title: 'Завершити тренування?',
      text: `Розв'язано ${solved} з ${s.items.length}. Якщо вийти зараз, результат цієї спроби не збережеться.`,
      confirm: 'Вийти',
      cancel: 'Продовжити',
    }))) return;
    up(`/topic/${s.topicId}`);
  });
  root.querySelector('#next')?.addEventListener('click', advance);
  const toggleHint = () => {
    if (state.hint.open) return closeHint();
    state.hint.open = true;
    state.hint.used = true;
    state.hint.animate = true;
    renderSession();
  };
  root.querySelector('#hint').addEventListener('click', () => state.hint.visible && toggleHint());
  root.querySelector('#dir-toggle')?.addEventListener('click', () => {
    // Перемикання очищає поле: перевертати вже введені цифри — лише плутанина.
    state.inputDir = state.inputDir === 'rtl' ? 'ltr' : 'rtl';
    storage.set(INPUT_DIR_KEY, state.inputDir);
    state.input = emptyInput(item);
    if (state.written) {
      if (state.written.active === 'q') state.written.q = '';
      else state.written.rows[state.written.active] = '';
      tidyRows(state.written);
    }
    state.lastInputAt = Date.now();
    state.dirFlip = true;
    state.dirTip = state.dirTip === 'shown' ? 'done' : state.dirTip;
    renderSession();
  });
  root.querySelector('#dir-tip')?.addEventListener('click', () => {
    state.dirTip = 'done';
    renderSession();
  });
  // Розписаний запис: активне поле не ховається під клавіатурою.
  if (state.written && !fb) root.querySelector('.ld-field.active')?.scrollIntoView({ block: 'nearest' });
  if (h.open && !fb) renderHintLayer(item, h.animate);
  h.animate = false;
  root.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => pressKey(b.dataset.key)));
  if ((item.multi || item.order) && !fb) bindMulti(item);
  root.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.choice)));
  // Крок «Обрати дію»: idle → choose → compute; «Змінити дію» повертає до вибору.
  const setStage = (stage, choice = null) => {
    state.steps = { stage, choice };
    state.written = null;
    // Задачі на остачу (find: 'remainder'): обране ділення одразу розписане — остача
    // з'являється лише в кінці ділення, а відповідь — останнє поле (issue #5).
    const picked = stage === 'compute' ? item.steps.options[choice] : null;
    if (picked?.op === '/' && item.steps.find === 'remainder') {
      openWritten('div', 'remainder', longDivision(picked.left, picked.right), [picked.left, picked.right]);
    }
    state.input = emptyInput(item);
    state.lastInputAt = Date.now();
    renderSession();
  };
  root.querySelector('#steps-open')?.addEventListener('click', () => setStage('choose'));
  root.querySelector('#steps-cancel')?.addEventListener('click', () => setStage('idle'));
  root.querySelector('#steps-change')?.addEventListener('click', () => setStage('choose'));
  root.querySelector('#lm-open')?.addEventListener('click', () => {
    const [a, b] = columnFor(item).rows.map(asInteger);
    openWritten('mul', 'sum', longMultiplication(a, b), [a, b]);
    if (item.answerType === 'decimal') state.written.answerText = item.answer;
    state.input = emptyInput(item);
    state.lastInputAt = Date.now();
    renderSession();
  });
  root.querySelector('#ld-open')?.addEventListener('click', () => {
    const c = columnFor(item);
    openWritten('div', 'quotient', longDivision(asInteger(c.dividend), c.divisor), [asInteger(c.dividend), c.divisor]);
    if (item.answerType === 'decimal') state.written.answerText = item.answer;
    state.input = emptyInput(item);
    state.lastInputAt = Date.now();
    renderSession();
  });
  if (!fb) {
    root.querySelectorAll('[data-row]').forEach((el) => el.addEventListener('click', () => {
      state.written.active = el.dataset.row === 'q' ? 'q' : Number(el.dataset.row);
      renderSession();
    }));
  }
  root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => setStage('compute', Number(b.dataset.step))));
  if (!fb) {
    root.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('click', () => {
      state.input = selectField(state.input, el.dataset.field);
      state.lastInputAt = Date.now();
      renderSession();
    }));
  }
}

// Помилка в підсумку.
//   Приклад з □:      «2 + 3 = 5» (з правильною відповіддю) · твоя відповідь ✗
//   Рівняння (x =):   рівняння · твоя відповідь ✗ · обрана дія (червона/зелена) ·
//                     правильно: x = 441, бо x = 578 − 137
//   Текстова задача:  умова · твоя відповідь ✗ · правильно: …
// Круглі значки: білий хрестик у червоному колі й біла галочка в зеленому —
// не плутаються з «x» у рівнянні.
const MARK = {
  ok: '<span class="mark ok" aria-label="правильно">✓</span>',
  bad: '<span class="mark bad" aria-label="неправильно">✕</span>',
};

function mistakeHtml(m) {
  const answerText = m.answerText ?? String(m.answer);
  const expr = (e) => `${e.left} ${e.sign} ${e.right}`;
  const prefix = m.answerPrefix ? `${esc(m.answerPrefix)} ` : '';
  const given = `<span class="given">твоя відповідь: ${prefix}${mh(m.given)} ${MARK.bad}</span>`;
  const step = m.step
    ? `<span class="m-step ${m.step.correct ? 'ok' : 'bad'}">обрана дія: ${prefix}${mh(expr(m.step))} ${m.step.correct ? MARK.ok : MARK.bad}</span>`
    : '';
  // Розписане ділення чи множення: проміжні рядки (без цифр частки й суми — їх видно з відповіді).
  // Неправильний рядок — правильне число й «у тебе …».
  const rows = (m.written ?? []).filter((r) => r.kind !== 'q' && r.kind !== 'sum'); // сума — це сама відповідь
  const written = rows.length
    ? `<span class="m-step m-written">розписано: ${rows.map((r) => (r.kind === 'extra'
      ? `<span>${esc(r.given)} (зайвий рядок)</span>`
      : r.correct
      ? `<span class="ok">${esc(r.given)} ${MARK.ok}</span>`
      : r.value == null
      ? `<span class="bad">${esc(r.given || '—')} ${MARK.bad}</span>`
      : r.correct
      ? `<span class="ok">${r.value} ${MARK.ok}</span>`
      : `<span class="bad">${r.value} ${MARK.bad} (у тебе ${esc(r.given || '—')})</span>`)).join(' · ')}</span>`
    : '';
  // Розв'язання по діях: дії з позначками і, якщо дитина складала сама, — чи розв'язує шлях задачу.
  const multi = m.multi?.lines?.length
    ? `<span class="m-step m-written">по діях: ${m.multi.lines.map((l, i) => {
      const ok = l.calcOk && l.actionOk !== false && l.noteOk !== false;
      return `<span class="${ok ? 'ok' : 'bad'}">${i + 1}) ${mh(`${l.expr[0]} ${MULTI_SIGNS[l.expr[1]]} ${l.expr[2]}`)} = ${esc(l.given)} ${ok ? MARK.ok : MARK.bad}</span>`;
    }).join(' · ')}${m.multi.pathOk === false ? ' · <span class="bad">числа підібрано під відповідь</span>' : ''}</span>`
    : '';
  if (m.text.includes('□')) {
    // Правильна відповідь — у зеленій рамці на місці поля, щоб було видно,
    // яке саме число (чи знак) треба було знайти (issue #2).
    const answerBox = `<span class="m-answer">${mh(answerText)}</span>`;
    return `<li><span>${mh(m.text, { ops: true }).replace('□', answerBox)}</span>${given}${step}${written}${multi}</li>`;
  }
  const why = m.canonical ? `, бо ${prefix}${mh(expr(m.canonical), { ops: true })}` : '';
  return `<li><span>${mh(m.text, { ops: !!m.answerPrefix })}</span>${given}${step}${written}${multi}`
    + `<span class="m-right">правильно: ${prefix}${mh(answerText)}${why}</span></li>`;
}

// ---------- крок «Обрати дію» (docs/EQUATION-STEPS.md) ----------

const chosenStep = (item) => (item.steps && state.steps.stage === 'compute' ? item.steps.options[state.steps.choice] : null);

// Стовпчик для поточного введення: сам приклад стовпчиком або обрана дія:
// +, −, × — стовпчиком, ділення — кутом ({ kind: 'divide' }).
function columnFor(item) {
  if (item.column) return item.column;
  const chosen = chosenStep(item);
  if (!chosen || item.steps.inline) return null; // 2 клас: обрана дія — у рядок
  if (chosen.op === '/') return { kind: 'divide', dividend: chosen.left, divisor: chosen.right };
  return { rows: [String(chosen.left), String(chosen.right)], sign: chosen.sign, align: 'right' };
}

// «Розписати множення» — для цілих чисел стовпчиком, коли другий множник має
// кілька цифр (неповні добутки). Множення з винесеними нулями й дроби — без нього.
// Десяткові множники теж (1,3 · 4,9): неповні добутки — як для натуральних, кома — у добутку.
const canWriteMultiplication = (c) => {
  const digits = (r) => String(r).replace(',', '');
  return !!c && c.sign === '×' && c.align === 'right' && c.rows.every((r) => /^\d+(,\d+)?$/.test(r)) && digits(c.rows[1]).length >= 2;
};
const asInteger = (r) => Number(String(r).replace(',', '')); // «4,9» → 49

// Частку при діленні кутом пишуть зліва направо (від старшого розряду),
// тож перемикача напряму там немає.
const isDivision = (column) => column?.kind === 'divide';

// Бульбашка під стрілкою напряму введення (на першому стовпчику сесії, перші 3 сесії).
function dirTipHtml(item) {
  if (state.feedback || state.dirTip === 'done' || !isEmpty(item, state.input)) return '';
  if (state.dirTip === 'pending') {
    const shown = Number(storage.get(DIR_TIP_KEY)) || 0;
    if (shown >= DIR_TIP_SESSIONS) {
      state.dirTip = 'done';
      return '';
    }
    storage.set(DIR_TIP_KEY, String(shown + 1));
    state.dirTip = 'shown';
  }
  return `<button class="dir-tip" id="dir-tip" aria-label="Закрити пояснення">${esc(DIR_TIP_TEXT[state.inputDir])}</button>`;
}

function stepsAreaHtml(item, chosen, answerBox, toggle, answered) {
  const { stage } = state.steps;
  const label = item.steps.label ?? item.answerPrefix ?? 'x =';
  if (stage === 'idle') {
    return answered ? '' : '<div class="steps-area"><button class="link-btn steps-btn" id="steps-open">Обрати дію</button></div>';
  }
  if (stage === 'choose') {
    const options = item.steps.options.map((o, i) =>
      `<button class="btn step-option" data-step="${i}">${mh(`${o.left} ${o.sign} ${o.right}`, { ops: true })}</button>`).join('');
    return `<div class="steps-area">
        <p class="steps-question">${esc(item.steps.question ?? 'Як знайти x?')}</p>
        <div class="steps-options">${options}</div>
        <button class="link-btn" id="steps-cancel">Ввести відповідь одразу</button>
      </div>`;
  }
  const column = columnFor(item);
  const w = column ? workHtml(item, column, answerBox, toggle, label, answered) : null;
  const work = w
    ? `<div class="task task-column">${w.inner}</div>${w.after}`
    : `<div class="task task-inline">${esc(label)} ${mh(`${chosen.left} ${chosen.sign} ${chosen.right}`, { ops: true })} = ${answerBox}</div>`;
  return `<div class="steps-area">${work}${answered ? '' : '<button class="link-btn" id="steps-change">Змінити дію</button>'}</div>`;
}

// Обчислення стовпчиком чи кутом — і для прикладу, записаного стовпчиком
// (item.column), і для дії, обраної на кроці «Обрати дію». inner — сам запис,
// after — кнопка «Розписати ділення / множення» під ним.
function workHtml(item, column, answerBox, toggle, label, answered) {
  const w = state.written;
  const marks = w && answered ? writtenMarks(w) : null;
  if (isDivision(column)) {
    return w
      ? { inner: writtenDivisionHtml(column, w, marks), after: '' }
      : { inner: divisionHtml(column, answerBox, label), after: answered ? '' : '<button class="link-btn" id="ld-open">Розписати ділення</button>' };
  }
  if (w?.type === 'mul') {
    const mulToggle = answered ? '' : directionToggleHtml(state.inputDir, { flip: state.dirFlip }) + dirTipHtml(item);
    return { inner: writtenMultiplicationHtml(column.rows[0], column.rows[1], timesSign(column.sign), w, { marks, rtl: state.inputDir === 'rtl', toggle: mulToggle }), after: '' };
  }
  return {
    inner: columnHtml({ ...column, sign: timesSign(column.sign) }, answerBox, toggle, label),
    after: canWriteMultiplication(column) && !answered ? '<button class="link-btn" id="lm-open">Розписати множення</button>' : '',
  };
}

// Картка підказки — окремим шаром поверх екрана. Вона стоїть одразу під
// прикладом і може перекрити клавіатуру, але не більше ніж наполовину;
// якщо текст довший, прокручується лише він, а «Зрозуміло» завжди видно.
// Тап поза карткою закриває її (і не натискає клавішу під нею).
//
// Якщо картка не вміщається над клавіатурою, блок прикладу на час підказки
// піднімається — рівно на стільки, скільки бракує, але не вище ніж на
// HINT_SHIFT_TOP_GAP під верхньою панеллю. Зсув менший за HINT_SHIFT_MIN
// не робимо: він не звільняє місця, лише смикає екран. Отже, якщо від панелі
// до прикладу менше ніж 12 + 40 = 52 px, приклад не рухається.
const HINT_SHIFT_TOP_GAP = 12;
const HINT_SHIFT_MIN = 40;

function renderHintLayer(item, animate) {
  const hint = normalizeHint(item.hint);
  if (!hint) return;
  const layer = document.createElement('div');
  layer.className = 'hint-layer';
  layer.innerHTML = `
    <div class="hint-card" role="dialog" aria-label="Підказка">
      <div class="hint-body">
        <ul class="hint-rules">${hint.rules.map((r) => `<li>${mh(r)}</li>`).join('')}</ul>
        ${hint.scheme.length ? `<div class="hint-scheme">${hint.scheme.map((l) => `<div>${mh(l)}</div>`).join('')}</div>` : ''}
      </div>
      <div class="hint-footer"><button class="link-btn" id="hint-close">Зрозуміло</button></div>
    </div>`;
  root.append(layer);

  const card = layer.querySelector('.hint-card');
  const main = root.querySelector('.session');
  const header = root.querySelector('.bar').getBoundingClientRect();
  const blockTop = main.firstElementChild.getBoundingClientRect().top;
  const anchor = (root.querySelector('.steps-area') ?? root.querySelector('.answer-row') ?? root.querySelector('.task')).getBoundingClientRect();
  const pad = root.querySelector('.numpad, .choices')?.getBoundingClientRect();
  const width = Math.min(520, innerWidth - 32);
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, 16), innerWidth - width - 16);
  // Клавіатура під карткою (а не збоку, як на планшеті).
  const overlapsPad = pad && left < pad.right && left + width > pad.left;

  // Природна висота картки та скільки місця не вистачає над клавіатурою.
  Object.assign(card.style, { left: `${left}px`, width: `${width}px`, top: '0px' });
  const naturalHeight = card.getBoundingClientRect().height;
  const freeBottom = overlapsPad ? pad.top - 8 : innerHeight - 16;
  const lacking = naturalHeight - (freeBottom - (anchor.bottom + 12));
  const room = blockTop - header.bottom - HINT_SHIFT_TOP_GAP;
  let shift = lacking > 0 ? Math.min(lacking, room) : 0;
  if (shift < HINT_SHIFT_MIN) shift = 0;

  if (shift) {
    if (!animate) main.style.transition = 'none';
    main.getBoundingClientRect(); // зафіксувати початкову позицію для анімації
    main.style.transform = `translateY(${-shift}px)`;
    if (!animate) requestAnimationFrame(() => { main.style.transition = ''; });
  }

  const top = anchor.bottom - shift + 12;
  const bottomLimit = overlapsPad ? pad.top + pad.height / 2 : innerHeight - 16;
  Object.assign(card.style, { top: `${top}px`, maxHeight: `${Math.max(bottomLimit - top, 140)}px` });

  layer.addEventListener('click', (e) => { if (e.target === layer) closeHint(); });
  layer.querySelector('#hint-close').addEventListener('click', closeHint);
}

// Закриття без перемальовування екрана, щоб приклад плавно повернувся на місце.
function closeHint() {
  state.hint.open = false;
  root.querySelector('.hint-layer')?.remove();
  root.querySelector('#hint')?.classList.remove('active');
  const main = root.querySelector('.session');
  if (main) main.style.transform = '';
}

window.addEventListener('resize', () => { if (onSessionScreen() && state.hint.open) renderSession(); });

const currentItem = () => state.session.items[state.session.index];

// Позначення класу активної сесії (catalog.json → grades[].notation), напр. { times: '·' }.
const notation = () => (state.session && gradeOfTopic(state.session.topicId)?.notation) || {};
const timesSign = (sign) => (sign === '×' ? notation().times ?? '×' : sign);
const mh = (text, opts = {}) => mathHtml(text, { ...opts, times: notation().times ?? '×' });
const isRtl = (item) => { const c = columnFor(item); return !!c && !isDivision(c) && state.inputDir === 'rtl'; };

function pressKey(key) {
  if (state.feedback || state.steps.stage === 'choose') return;
  const item = currentItem();
  if (state.written) return pressWrittenKey(key);
  if (state.multi && MULTI_INPUT_PHASES.includes(state.multi.phase)) return pressMultiKey(key);
  if (key === 'ok') {
    if (isComplete(item, state.input)) answer(state.input);
    return;
  }
  state.input = applyKey(item, state.input, key, { rtl: isRtl(item) });
  state.lastInputAt = Date.now();
  if (state.dirTip === 'shown' && !isEmpty(item, state.input)) state.dirTip = 'done'; // перша цифра — бульбашка зникає
  renderSession();
}

// ---------- розписаний запис: конструктор (docs/EQUATION-STEPS.md) ----------
//
// state.written = { type: 'div' | 'mul', answer, expected, q, rows, active }:
//   q      — поле частки під дільником (лише ділення), будь-скільки цифр;
//   rows   — рядки під діленим / множниками; заповнений рядок додає під собою
//            ще один порожній (неактивний), порожній — нічого не додає;
//   active — 'q' або номер рядка; курсор сам не рухається — поле обирає дитина;
//   answer — що є відповіддю: 'quotient' (поле частки), 'remainder' / 'sum'
//            (останній заповнений рядок);
//   expected — правильний розв'язок: для розташування рядків і перевірки після відповіді.

function openWritten(type, answerKind, expected, numbers) {
  state.written = { type, answer: answerKind, expected, numbers, q: '', rows: [''], active: type === 'div' ? 'q' : 0 };
}

// Останній порожній рядок лише один: під заповненим з'являється новий, а зайві
// порожні в кінці зникають (дитина стерла рядок — зник і порожній під ним).
function tidyRows(w) {
  while (w.rows.length > 1 && !w.rows.at(-1) && !w.rows.at(-2)) w.rows.pop();
  if (w.rows.at(-1)) w.rows.push('');
  if (typeof w.active === 'number' && w.active >= w.rows.length) w.active = w.rows.length - 1;
}

const lastFilledRow = (w) => [...w.rows].reverse().find((r) => r) ?? '';

function writtenAnswer(w) {
  return w.answer === 'quotient' ? w.q : lastFilledRow(w);
}

const writtenReady = (w) => !!writtenAnswer(w);

// Що зберегти в результаті. Ділення: рядки перевіряються за введеними числами
// (divisionRows — дитина може піти своїм шляхом, issue #8); множення: рядок
// порівнюємо з рядком правильного розв'язку з тим самим номером (зайві — 'extra').
function writtenResult(w) {
  const rows = w.rows.filter((r, i) => r || i < w.rows.length - 1);
  if (w.type === 'div') {
    const [dividend, divisor] = w.numbers;
    const layout = divisionRows(dividend, divisor, rows);
    // Десяткова частка (19,4 : 2 = 9,7) порівнюється з відповіддю прикладу.
    const q = w.answerText
      ? { kind: 'q', value: w.answerText, given: w.q, correct: !!w.q && sameDecimal(w.q, w.answerText) }
      : { kind: 'q', value: Math.floor(dividend / divisor), given: w.q };
    return [
      q,
      ...rows.map((given, i) => ({ kind: layout[i].kind, value: layout[i].value, given, correct: !!given && layout[i].correct })),
    ];
  }
  const slots = w.expected;
  return rows.map((given, i) => {
    const kind = slots[i]?.kind ?? 'extra';
    // Сума десяткових множників — з комою: порівнюємо з відповіддю прикладу.
    if (kind === 'sum' && w.answerText) return { kind, value: w.answerText, given, correct: !!given && sameDecimal(given, w.answerText) };
    return { kind, value: slots[i]?.value ?? null, given };
  });
}

// Після відповіді: позначки для полів { q, 0, 1, … }.
function writtenMarks(w) {
  const marks = {};
  writtenResult(w).forEach((r, i) => {
    marks[w.type === 'div' ? (i === 0 ? 'q' : i - 1) : i] = r.correct ?? (r.given !== '' && Number(r.given) === r.value);
  });
  return marks;
}

// Цифри — в активне поле. У діленні (і в полі частки) курсор завжди праворуч від
// останньої цифри, ⌫ стирає справа наліво. Множення рахують від одиниць — там
// цифри йдуть у вибраному напрямі (типово справа наліво).
function pressWrittenKey(key) {
  const w = state.written;
  if (key === 'ok') {
    if (!writtenReady(w)) return;
    // Розписаний запис із «Порахувати в стовпчик» (розв'язання по діях): результат — у рядок дії, без перевірки.
    if (w.returnTo === 'multi') {
      state.multi.input = writtenAnswer(w);
      state.multi.phase = 'typing';
      state.written = null;
      return renderSession();
    }
    answer(writtenAnswer(w));
    return;
  }
  const value = w.active === 'q' ? w.q : w.rows[w.active] ?? '';
  const rtl = w.type === 'mul' && state.inputDir === 'rtl';
  let next = value;
  if (key === 'del') next = rtl ? value.slice(1) : value.slice(0, -1);
  else if (/^\d$/.test(key) && value.length < 7) next = rtl ? key + value : value + key;
  // Кома — для десяткової частки чи добутку: одна на число й не першою.
  else if (key === ',' && w.answerText && value && !value.includes(',')) next = rtl ? key + value : value + key;
  if (w.active === 'q') w.q = next;
  else w.rows[w.active] = next;
  tidyRows(w);
  if (state.dirTip === 'shown' && next) state.dirTip = 'done';
  state.lastInputAt = Date.now();
  renderSession();
}

// ---------- «Розв'язання по діях» (core/multistep.js, docs/STEPS-ROLLOUT.md, етап 2) ----------
//
// state.multi = { mode: 'ask' | 'free', noteMode: 'auto' | 'pick', phase, lines, options, build,
//                 extra, input, noteOpts, finalLine, col }
//   phase: build (обрати / скласти дію) → typing (порахувати) → [column] → [note] →
//          next (схема Б: ще дія чи відповідь) … → answer (вписати відповідь окремо);
//   lines: [{ expr: [l, op, r], refs: [ref, ref], given, typing, rightOption?, note? }],
//          ref — «n:i» (число умови), «l:j» (результат дії j), «x» (інше число).
// Схема й пояснення — за класом і рівнем (catalog.json → grades[].multiStep).

const MULTI_INPUT_PHASES = ['typing', 'other', 'column'];
const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function multiModeFor(level) {
  const [mode, noteMode] = gradeOfTopic(state.session.topicId)?.multiStep?.[level] ?? ['ask', 'auto'];
  return { mode, noteMode };
}

function openMulti(item) {
  if (item.order) {
    // Порядок дій: дитина торкається знака у виразі; вираз скорочується після кожної дії.
    state.multi = { mode: 'order', noteMode: null, phase: 'pick', lines: [], tokens: item.order.tokens, slips: 0, input: '', finalLine: null };
    return;
  }
  const { mode, noteMode } = multiModeFor(state.session.level);
  state.multi = { mode, noteMode, phase: 'build', lines: [], build: {}, extra: [], input: '', finalLine: null };
  if (mode === 'ask') state.multi.options = askOptions(item.multi, 0, [], shuffled);
}

// Що вводиться з клавіатури зараз (для активності ✓).
function multiKeypadInput(item) {
  const m = state.multi;
  if (!m || (!item.multi && !item.order)) return state.input;
  if (m.phase === 'column') return m.col.input;
  return MULTI_INPUT_PHASES.includes(m.phase) ? m.input : state.input;
}
// Клавіатура неактивна, поки дитина обирає дію, число чи пояснення.
const multiKeypadOff = () => !!state.multi && !MULTI_INPUT_PHASES.includes(state.multi.phase) && state.multi.phase !== 'answer';

const multiExpr = ([l, op, r]) => mh(`${l} ${MULTI_SIGNS[op]} ${r}`, { ops: true });
const multiCaret = '<span class="caret"></span>';

// Вираз зі знаками-кнопками (порядок дій): дитина торкається знака дії, яку виконує.
function orderExprHtml(tokens, clickable) {
  const sign = (op) => timesSign(MULTI_SIGNS[op]);
  return `<div class="ms-expr">${tokens.map((t, i) => (t.n != null ? `<span>${mh(String(t.n))}</span>`
    : t.p ? `<span class="ms-par">${t.p}</span>`
    : clickable ? `<button class="ms-op" data-ms-op="${i}" aria-label="Дія ${sign(t.o)}">${mh(` ${sign(t.o)} `, { ops: true })}</button>`
    : `<span>${mh(` ${sign(t.o)} `, { ops: true })}</span>`)).join(' ')}</div>`;
}

// Підсумок порядку дій для результату: обчислення кожної дії й кількість спроб «не з тієї дії».
function orderSummary(m) {
  return {
    mode: 'order',
    lines: m.lines.filter((l) => l.given !== '').map((l) => ({ expr: l.expr, given: l.given, calcOk: Number(l.given) === orderCalc(...l.expr), actionOk: null, note: null, noteOk: null })),
    pathOk: null,
    slips: m.slips,
  };
}

function multiAreaHtml(item, answered) {
  const m = state.multi;
  if (!m) return answered ? '' : '<div class="steps-area"><button class="link-btn steps-btn" id="ms-open">Розв\'язати по діях</button></div>';
  const res = answered ? state.session.results.at(-1)?.multi : null;
  const lines = m.lines.map((l, i) => multiLineHtml(item, l, i, res?.lines[i])).join('');
  const pathLine = res?.pathOk != null
    ? `<p class="ms-hint">${res.pathOk ? '✓ Дії розв\'язують задачу.' : '✕ Числа підібрано під відповідь: з іншими числами ці дії дали б іншу відповідь.'}</p>` : '';
  const expr = m.mode === 'order' && !answered && m.tokens.length > 1 ? orderExprHtml(m.tokens, m.phase === 'pick') : '';
  const slips = m.mode === 'order' && answered && m.slips
    ? `<p class="ms-hint">Спроб почати не з тієї дії: ${m.slips} — як і підказка, на зірки не впливає.</p>` : '';
  return `<div class="steps-area ms">${expr}${lines ? `<div class="ms-lines">${lines}</div>` : ''}${answered ? pathLine + slips : multiWorkHtml(item)}</div>`;
}

function multiLineHtml(item, line, i, res) {
  const typing = line.typing && state.multi.phase !== 'column';
  const value = typing ? `<span class="ms-box active">${esc(state.multi.input)}${multiCaret}</span>` : `<b>${esc(line.given)}</b>`;
  const noteText = state.multi.noteMode === 'auto' ? (line.typing ? null : meaningOf(item.multi, Number(line.given))) : state.multi.noteMode === 'pick' ? line.note : null;
  const marks = res ? [
    res.calcOk ? `<span class="ms-mark ok">${MARK.ok} пораховано</span>` : `<span class="ms-mark bad">${MARK.bad} має бути ${mh(String(+calc(...line.expr).toFixed(4)))}</span>`,
    res.actionOk === false ? `<span class="ms-mark bad">${MARK.bad} дія</span>` : '',
    res.noteOk === true ? `<span class="ms-mark ok">${MARK.ok} пояснення</span>` : res.noteOk === false ? `<span class="ms-mark bad">${MARK.bad} пояснення</span>` : '',
  ].join(' ') : '';
  const cls = res ? (res.calcOk && res.actionOk !== false && res.noteOk !== false ? ' ok' : ' bad') : '';
  return `<div class="ms-line${cls}"><span class="ms-no">${i + 1})</span> ${multiExpr(line.expr)} = ${value}${noteText ? ` <span class="ms-note">— ${esc(noteText)}</span>` : ''}${marks ? ` <span class="ms-marks">${marks}</span>` : ''}</div>`;
}

function multiWorkHtml(item) {
  const m = state.multi;
  const n = m.lines.length;
  const answerLink = '<button class="link-btn" id="ms-answer">Вписати відповідь</button>';
  switch (m.phase) {
    case 'pick':
      return `<p class="steps-question">${n + 1}) Яку дію виконати? Торкнись знака у виразі.</p>${answerLink}`;
    case 'why':
      return `<div class="ms-builder"><p class="steps-question">Цю дію ще рано виконувати</p><p class="ms-rule">${esc(ORDER_RULES[m.why])}</p><button class="link-btn" id="ms-why-ok">Зрозуміло</button></div>`;
    case 'typing':
      return `<p class="ms-hint">Порахуй і натисни ✓</p>${multiColumnAllowed(m.lines.at(-1)) ? '<button class="link-btn" id="ms-column">Порахувати в стовпчик</button>' : ''}`;
    case 'column':
      return multiColumnHtml(m.lines.at(-1).expr);
    case 'note':
      return `<p class="steps-question">Що ми дізналися?</p><div class="ms-choices">${m.noteOpts.map((t, i) => `<button class="btn step-option" data-ms-note="${i}">${esc(t)}</button>`).join('')}</div>`;
    case 'next':
      return `<div class="ms-row"><button class="btn" id="ms-more">Ще дія</button><button class="btn btn-primary" id="ms-final">Це відповідь</button></div>${answerLink}`;
    case 'answer':
      return '<p class="ms-hint">Впиши відповідь і натисни ✓</p>';
    case 'other':
      return `<div class="ms-builder">${multiSlotHtml()}<div class="ms-slot"><span class="ms-box active">${esc(m.input)}${multiCaret}</span></div>
        <p class="ms-hint">Якщо для розрахунку бракує якогось числа, впиши його сам. Воно з'явиться серед чисел, і його можна прибрати будь-коли.</p>
        <button class="link-btn" id="ms-clear">Скласти інакше</button></div>`;
    default: break;
  }
  if (m.mode === 'ask') {
    const step = item.multi.plan[n];
    return `<p class="steps-question">${n + 1}) ${esc(step.question)}</p>
      <div class="steps-options">${m.options.map((o, i) => `<button class="btn step-option" data-ms-opt="${i}">${multiExpr([o.left, o.op, o.right])}</button>`).join('')}</div>
      ${answerLink}`;
  }
  // Схема Б: дитина складає дію з чисел умови, знайдених результатів та «інших чисел».
  const b = m.build;
  const stage = b.l == null ? 'l' : b.o == null ? 'o' : 'r';
  const full = m.extra.length >= MAX_EXTRA;
  const chips = [
    ...item.multi.numbers.map((num, i) => `<button class="ms-chip" data-ms-num="${num.value}" data-ms-ref="n:${i}">${mh(String(num.value))}</button>`),
    ...m.lines.map((l, i) => (l.given === '' ? '' : `<button class="ms-chip found" data-ms-num="${esc(l.given)}" data-ms-ref="l:${i}">${mh(l.given)}</button>`)),
    ...m.extra.map((x) => `<span class="ms-extra"><button class="ms-chip" data-ms-num="${x}" data-ms-ref="x">${mh(String(x))}</button><button class="ms-chip ms-x" data-ms-del="${x}" aria-label="Прибрати число ${x}">×</button></span>`),
    `<button class="ms-chip" id="ms-other" ${full ? 'disabled' : ''}>інше число…</button>`,
  ].join('');
  const tip = { l: 'Торкнись першого числа — з умови чи вже знайденого.', o: 'Обери дію.', r: 'Торкнись другого числа.' }[stage];
  return `<div class="ms-builder">
      <p class="steps-question">${n + 1}) Склади дію</p>
      ${multiSlotHtml()}
      ${stage === 'o'
        ? `<div class="ms-chips">${['+', '-', '*', '/'].map((op) => `<button class="ms-chip ms-sign" data-ms-sign="${op}">${mh(MULTI_SIGNS[op], { ops: true })}</button>`).join('')}</div>`
        : `<div class="ms-chips">${chips}</div>`}
      <p class="ms-hint">${tip}${full && stage !== 'o' ? ` Інших чисел — не більше ${MAX_EXTRA}: прибери зайве ×, щоб додати нове.` : ''}</p>
      ${b.l != null ? '<button class="link-btn" id="ms-clear">Скласти інакше</button>' : ''}
    </div>${n ? '' : answerLink}`;
}

function multiSlotHtml() {
  const b = state.multi.build;
  const slot = (v) => (v == null ? '<span class="blank-static">□</span>' : mh(String(v)));
  return `<div class="ms-slot">${slot(b.l)} ${b.o ? mh(MULTI_SIGNS[b.o], { ops: true }) : '<span class="blank-static">?</span>'} ${slot(b.r)} = <span class="blank-static">□</span></div>`;
}

// «Порахувати в стовпчик» — лише в класах зі стовпчиком (не в 2 класі) і для цілих чисел.
function multiColumnAllowed(line) {
  return gradeOfTopic(state.session.topicId)?.grade >= 3 && line.expr.every((v, k) => k === 1 || Number.isInteger(v));
}

// Стовпчик (+ − ×) чи кут (:) з числами дії; результат повертається в рядок дії без перевірки.
// Числа для стовпчика: при множенні більше число — зверху, як у підручнику (47 · 3, а не 3 · 47).
function multiColumnNumbers([l, op, r]) {
  return op === '*' && String(r).length > String(l).length ? [r, l] : [l, r];
}

function multiColumnHtml(expr) {
  const m = state.multi;
  const op = expr[1];
  const [l, r] = multiColumnNumbers(expr);
  const kut = op === '/';
  const w = state.written?.returnTo === 'multi' ? state.written : null;
  const back = '<button class="link-btn" id="ms-col-back">Назад до дії</button>';
  // Розписаний запис (неповні добутки / ділення-конструктор) — та сама форма, що й у прикладах стовпчиком;
  // ✓ повертає суму чи частку в рядок дії.
  if (w) {
    const form = w.type === 'div'
      ? writtenDivisionHtml({ dividend: l, divisor: r }, w)
      : writtenMultiplicationHtml(l, r, timesSign(MULTI_SIGNS[op]), w,
        { rtl: state.inputDir === 'rtl', toggle: directionToggleHtml(state.inputDir, { flip: state.dirFlip }) });
    return `<div class="task task-column">${form}</div><p class="ms-hint">✓ — повернути ${w.type === 'div' ? 'частку' : 'результат'} у дію.</p>${back}`;
  }
  const box = `<span class="blank${kut ? '' : ' rtl'}">${kut ? '' : multiCaret}${esc(m.col.input)}${kut ? multiCaret : ''}</span>`;
  const column = { rows: [String(l), String(r)], sign: MULTI_SIGNS[op], align: 'right' };
  const form = kut ? divisionHtml({ dividend: l, divisor: r }, box)
    : columnHtml({ ...column, sign: timesSign(column.sign) }, box);
  const writeBtn = kut ? '<button class="link-btn" id="ms-ld-open">Розписати ділення</button>'
    : op === '*' && canWriteMultiplication(column) ? '<button class="link-btn" id="ms-lm-open">Розписати множення</button>' : '';
  return `<div class="task task-column">${form}</div>
    <p class="ms-hint">${kut ? 'Частку пиши зліва направо.' : 'Цифри — справа наліво, як у зошиті.'} ✓ — повернути результат у дію.</p>
    ${writeBtn}${back}`;
}

function bindMulti(item) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
  const go = () => { state.lastInputAt = Date.now(); renderSession(); };
  on('#ms-open', () => { openMulti(item); go(); });
  on('[data-ms-op]', (el) => {
    const m = state.multi;
    const i = Number(el.dataset.msOp);
    if (!allowedOps(m.tokens).includes(i)) { m.slips += 1; m.why = whyNotOp(m.tokens, i); m.phase = 'why'; return go(); }
    const t = m.tokens;
    m.lines.push({ expr: [t[i - 1].n, t[i].o, t[i + 1].n], refs: ['x', 'x'], given: '', typing: true });
    m.pendingOp = i;
    m.phase = 'typing';
    m.input = '';
    go();
  });
  on('#ms-why-ok', () => { state.multi.phase = 'pick'; go(); });
  on('#ms-answer', () => { state.multi.phase = 'answer'; state.input = emptyInput(item); go(); });
  on('[data-ms-opt]', (el) => {
    const o = state.multi.options[Number(el.dataset.msOpt)];
    state.multi.lines.push({ expr: [o.left, o.op, o.right], refs: o.refs.map((r) => r ?? 'x'), given: '', typing: true, rightOption: o.correct });
    state.multi.phase = 'typing'; state.multi.input = ''; go();
  });
  on('[data-ms-num]', (el) => multiOperand(Number(el.dataset.msNum), el.dataset.msRef));
  on('[data-ms-sign]', (el) => { state.multi.build.o = el.dataset.msSign; go(); });
  on('#ms-other', () => { state.multi.phase = 'other'; state.multi.input = ''; go(); });
  on('[data-ms-del]', (el) => { state.multi.extra = state.multi.extra.filter((x) => x !== Number(el.dataset.msDel)); go(); });
  on('#ms-clear', () => { state.multi.build = {}; state.multi.phase = 'build'; go(); });
  on('[data-ms-note]', (el) => { state.multi.lines.at(-1).note = state.multi.noteOpts[Number(el.dataset.msNote)]; afterMultiLine(item); });
  on('#ms-more', () => { state.multi.phase = 'build'; go(); });
  on('#ms-final', () => { state.multi.finalLine = state.multi.lines.length - 1; answer(state.multi.lines.at(-1).given); });
  on('#ms-column', () => { state.multi.phase = 'column'; state.multi.col = { input: '' }; go(); });
  on('#ms-col-back', () => { state.multi.phase = 'typing'; state.written = null; go(); });
  on('#ms-lm-open', () => {
    const [l, r] = multiColumnNumbers(state.multi.lines.at(-1).expr);
    openWritten('mul', 'sum', longMultiplication(l, r), [l, r]);
    state.written.returnTo = 'multi';
    go();
  });
  on('#ms-ld-open', () => {
    const [l, , r] = state.multi.lines.at(-1).expr;
    openWritten('div', 'quotient', longDivision(l, r), [l, r]);
    state.written.returnTo = 'multi';
    go();
  });
}

function multiOperand(value, ref) {
  const m = state.multi;
  const b = m.build;
  if (b.l == null) Object.assign(b, { l: value, lr: ref });
  else if (b.o && b.r == null) Object.assign(b, { r: value, rr: ref });
  if (b.l != null && b.o && b.r != null) {
    m.lines.push({ expr: [b.l, b.o, b.r], refs: [b.lr, b.rr], given: '', typing: true });
    m.build = {};
    m.phase = 'typing';
    m.input = '';
  } else m.phase = 'build';
  state.lastInputAt = Date.now();
  renderSession();
}

function pressMultiKey(key) {
  const m = state.multi;
  const item = currentItem();
  if (m.phase === 'column') {
    const kut = m.lines.at(-1).expr[1] === '/';
    const v = m.col.input;
    if (key === 'del') m.col.input = kut ? v.slice(0, -1) : v.slice(1);
    else if (key === 'ok') { if (v) { m.input = v; m.phase = 'typing'; } }
    else if (/^\d$/.test(key) && v.length < 7) m.col.input = kut ? v + key : key + v;
    return renderSession();
  }
  if (key === 'del') { m.input = m.input.slice(0, -1); return renderSession(); }
  if (key !== 'ok') {
    if (/^\d$/.test(key) && m.input.length < 7) m.input += key;
    state.lastInputAt = Date.now();
    return renderSession();
  }
  if (!m.input) return;
  const n = Number(m.input);
  if (m.phase === 'other') {
    // Число з умови чи вже знайдене — це воно і є; нове — лишається в наборі (до MAX_EXTRA).
    const ni = item.multi.numbers.findIndex((x) => x.value === n);
    const li = m.lines.findIndex((l) => l.given !== '' && Number(l.given) === n);
    const ref = ni >= 0 ? `n:${ni}` : li >= 0 ? `l:${li}` : 'x';
    if (ref === 'x' && !m.extra.includes(n) && m.extra.length < MAX_EXTRA) m.extra.push(n);
    m.input = '';
    return multiOperand(n, ref);
  }
  const line = m.lines.at(-1);
  line.given = m.input;
  line.typing = false;
  m.input = '';
  if (m.noteMode === 'pick') {
    m.noteOpts = noteOptions(item.multi, n, shuffled);
    m.phase = 'note';
    return renderSession();
  }
  afterMultiLine(item);
}

function afterMultiLine(item) {
  const m = state.multi;
  if (m.mode === 'order') {
    // Вираз скорочується числом, яке порахувала дитина; коли лишилось одне число — це відповідь.
    m.tokens = reduceTokens(m.tokens, m.pendingOp, Number(m.lines.at(-1).given));
    if (m.tokens.length === 1) {
      m.finalLine = m.lines.length - 1;
      return answer(m.lines.at(-1).given);
    }
    m.phase = 'pick';
    return renderSession();
  }
  if (m.mode === 'ask') {
    if (m.lines.length < item.multi.plan.length) {
      m.phase = 'build';
      m.options = askOptions(item.multi, m.lines.length, m.lines, shuffled);
      return renderSession();
    }
    m.finalLine = m.lines.length - 1; // відповідь — результат останньої дії плану
    return answer(m.lines.at(-1).given);
  }
  m.phase = 'next';
  renderSession();
}

function answer(given) {
  if (state.feedback) return;
  const item = currentItem();
  const chosen = chosenStep(item);
  const { session, result } = submitAnswer(state.session, given, Date.now() - state.questionStartedAt,
    { hintUsed: state.hint.used, step: chosen,
      written: state.written ? writtenResult(state.written) : null,
      multi: state.multi && item.multi ? multiSummary(item.multi, state.multi, given)
        : state.multi && item.order ? orderSummary(state.multi) : null });
  state.session = session;
  state.input = given;
  state.hint.open = false;
  state.feedback = { correct: result.correct, item };
  renderSession();
  if (result.correct) setTimeout(advance, CONFIG.correctAdvanceMs);
}

function advance() {
  if (!state.feedback) return;
  state.feedback = null;
  state.questionStartedAt = Date.now();
  resetHint();
  if (isFinished(state.session)) {
    progressStore.add(sessionRecord(state.session, { startedAt: state.sessionStartedAt }));
    go(`/topic/${state.session.topicId}/result`, { replace: true });
  } else {
    state.input = emptyInput(currentItem());
    renderSession();
  }
}

const onSessionScreen = () => currentRoute().sub === 'play' && state.session;

// Раз на секунду перевіряємо, чи пора тихо показати 💡 (правило — core/hints.js).
setInterval(() => {
  if (!onSessionScreen() || state.feedback || state.hint.visible) return;
  const item = currentItem();
  if (!item) return;
  const now = Date.now();
  const offer = shouldOfferHint({
    item,
    elapsedMs: now - state.questionStartedAt,
    sinceInputMs: now - state.lastInputAt,
    inputEmpty: isEmpty(item, state.input),
    delayMs: hintDelayMs(item, state.session.level),
  });
  if (offer) {
    state.hint.visible = true;
    state.hint.fresh = true;
    renderSession();
  }
}, 1000);

// Фізична клавіатура (планшет з клавіатурою, десктоп).
document.addEventListener('keydown', (e) => {
  if (!onSessionScreen()) return;
  if (state.feedback) {
    if (e.key === 'Enter' && !state.feedback.correct) advance();
    return;
  }
  // Поки відкрита підказка, клавіші не вводять відповідь; Esc або Enter її закривають.
  if (state.hint.open) {
    if (e.key === 'Escape' || e.key === 'Enter') closeHint();
    return;
  }
  const item = currentItem();
  if (state.steps.stage === 'choose') {
    if (e.key === 'Escape') { state.steps = { stage: 'idle', choice: null }; renderSession(); }
    return;
  }
  if (item?.answerType === 'choice') {
    if (['<', '>', '='].includes(e.key)) answer(e.key);
    return;
  }
  const key = physicalKey(item, e);
  if (key) {
    e.preventDefault();
    pressKey(key);
  }
});

// ---------- підсумок ----------

function renderSummary() {
  const s = state.session;
  const topic = findTopic(s.topicId);
  const sum = summarize(s);
  const praise = ['Спробуй ще раз — у тебе вийде!', 'Непогано!', 'Добре!', 'Чудово!'][sum.stars];

  // Поточна сесія вже в журналі, тож previous — попередня сесія цього рівня.
  const { previous } = levelProgress(progressStore.all(), s.topicId, s.level);
  const cmp = compareWithPrevious(sum, previous);

  // Порядок рядків: точність → середній час → швидкість.
  const accuracyLine = cmp.accuracy?.trend === 'up'
    ? `<p class="trend ok">▲ Точність вища, ніж минулого разу, на ${cmp.accuracy.diffPct}%</p>`
    : cmp.accuracy?.trend === 'down'
      ? `<p class="trend slow">▼ Точність нижча, ніж минулого разу, на ${-cmp.accuracy.diffPct}%</p>`
      : '';
  // Нерозв'язані рівняння за причинами; сума категорій = кількість помилок.
  const st = sum.stepStats;
  const stepParts = [
    [st.method, 'неправильна дія'], [st.calc, 'помилка в обчисленні'],
    [st.both, 'і дія, і обчислення'], [st.noStep, 'без вибору дії'],
  ].filter(([n]) => n).map(([n, label]) => `<span>${label}: ${n}</span>`);
  const stepsLine = st.used && stepParts.length
    ? `<div class="trend muted step-stats">Не розв'язано: ${sum.total - sum.correct}<div class="step-parts">${stepParts.join('')}</div></div>`
    : '';
  const hintLine = sum.hintsUsed
    ? `<p class="trend muted">Підказкою скористались: ${sum.hintsUsed} ${pluralUk(sum.hintsUsed, 'раз', 'рази', 'разів')}</p>`
    : '';
  const timeLine = sum.avgMs != null
    ? `<p class="summary-time">Середній час на приклад: <b>${formatDuration(sum.avgMs)}</b></p>`
    : '';
  const speedLine = cmp.first
    ? '<p class="trend muted">Це перша сесія на цьому рівні</p>'
    : !cmp.speed
      ? ''
      : cmp.speed.trend === 'same'
        ? '<p class="trend muted">Швидкість така сама, як минулого разу</p>'
        : cmp.speed.trend === 'faster'
          ? `<p class="trend ok">▲ Швидше, ніж минулого разу, на ${formatDuration(-cmp.speed.diffMs)}</p>`
          : `<p class="trend slow">▼ Повільніше, ніж минулого разу, на ${formatDuration(cmp.speed.diffMs)}</p>`;

  const mistakes = sum.mistakes.length
    ? `<h2>Помилки</h2><ul class="mistakes">${sum.mistakes.map(mistakeHtml).join('')}</ul>`
    : '';

  root.innerHTML = `
    <header class="bar"><h1>${esc(topic?.title ?? 'Підсумок')}</h1>${reportButton}</header>
    <main class="summary">
      <div class="summary-stars">${starsHtml(sum.stars)}</div>
      <p class="summary-praise">${praise}</p>
      <p class="summary-score">Правильно <b>${sum.correct}</b> з ${sum.total}</p>
      ${accuracyLine}
      ${timeLine}
      ${speedLine}
      ${stepsLine}
      ${hintLine}
      ${mistakes}
      <div class="summary-actions">
        <button class="btn btn-primary" id="again">Ще раз</button>
        <button class="btn" id="to-topic">Інший рівень</button>
        <button class="btn" id="to-grade">До розділів</button>
      </div>
    </main>`;

  const gradeId = gradeOfTopic(s.topicId)?.id;
  root.querySelector('#again').addEventListener('click', () => startSession(topic, s.level, { replace: true }));
  root.querySelector('#to-topic').addEventListener('click', () => { state.session = null; up(`/topic/${s.topicId}`); });
  root.querySelector('#to-grade').addEventListener('click', () => { state.session = null; go(`/grade/${gradeId}`, { replace: true }); });
}

// ---------- оновлення контенту ----------
//
// Застосунок на телефоні часто не перезапускається, а лише повертається з фону.
// Якщо він пробув у фоні довше за CONTENT_REFRESH_MS, тихо перечитуємо data/
// і, якщо щось змінилося, перемальовуємо екран класів чи розділів.
// Посеред тренування нічого не чіпаємо — оновимо після його завершення.

const CONTENT_REFRESH_MS = 60 * 1000;

async function refreshContent() {
  try {
    const fresh = await loadContent();
    state.contentLoadedAt = Date.now();
    if (JSON.stringify(fresh) === JSON.stringify(state.content)) return;
    state.content = fresh;
    const { sub } = currentRoute();
    if (sub !== 'play' && sub !== 'result') render();
  } catch {
    // Немає мережі — лишаємо те, що є; спробуємо наступного разу.
  }
}

function onResume() {
  if (!state.content || Date.now() - (state.contentLoadedAt ?? 0) < CONTENT_REFRESH_MS) return;
  if (currentRoute().sub === 'play') state.refreshPending = true;
  else refreshContent();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onResume(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) onResume(); });

// ---------- старт ----------

// Service worker: свіжі й узгоджені файли після оновлень сайту, робота офлайн (див. sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

history.replaceState({ depth: 0 }, '', location.hash || '#/');
render();
