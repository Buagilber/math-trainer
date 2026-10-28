// Інтерфейс: привітання, вибір класу, розділи, рівні, сесія та підсумок.
//
// Кожен екран має свою адресу (#/grade/g2, #/topic/g2-mul…), тому закладка
// відкриває саме той екран, де її зробили, а системна кнопка «Назад»
// на Android повертає на попередній екран.

import { CONFIG } from '../config.js';
import { createRng } from '../core/rng.js';
import { pluralUk } from '../core/generators.js';
import { buildSession, submitAnswer, isFinished, summarize, levelsOf, formatAnswer } from '../core/session.js';
import { sessionRecord, topicProgress, levelProgress, compareWithPrevious } from '../core/progress.js';
import { hintDelayMs, shouldOfferHint, normalizeHint } from '../core/hints.js';
import { esc, mathHtml, emptyInput, applyKey, isComplete, isEmpty, selectField, answerHtml, keypadHtml, physicalKey } from './answer-input.js';
import { loadContent } from './content.js';
import { progressStore, storage } from './storage.js';

const root = document.getElementById('app');
const WELCOMED_KEY = 'mt.welcomed';

const state = {
  content: null,
  session: null, // активна сесія (core/session.js)
  sessionStartedAt: 0,
  questionStartedAt: 0,
  input: '', // рядок або { whole, num, den, field } для дробів (див. answer-input.js)
  feedback: null, // { correct, item } після відповіді
  // Підказка до поточного прикладу: visible — кнопка 💡 показана, open — картка
  // відкрита, used — дитина відкривала підказку, fresh — щойно з'явилась (анімація).
  hint: { visible: false, open: false, used: false, fresh: false },
  lastInputAt: 0,
  hintBaseAvgMs: null, // середній час на приклад в останній сесії цього рівня
};

const resetHint = () => {
  state.hint = { visible: false, open: false, used: false, fresh: false };
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

function starsHtml(count, max = 3) {
  return `<span class="stars" aria-label="${count} з ${max} зірок">${'★'.repeat(count)}<span class="stars-off">${'★'.repeat(max - count)}</span></span>`;
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
    } catch (e) {
      root.innerHTML = `<div class="center"><p>Не вдалося завантажити завдання.</p><p class="muted">${esc(e.message)}</p>
        <button class="btn" onclick="location.reload()">Спробувати ще раз</button></div>`;
      return;
    }
  }
  window.scrollTo(0, 0);

  // Привітання показується при першому запуску, доки не натиснуто кнопку.
  if (storage.get(WELCOMED_KEY) !== '1') return renderWelcome({ firstRun: true });

  const route = currentRoute();
  root.className = `screen-${route.name || 'grades'}`;
  switch (route.name) {
    case 'about': return renderWelcome({ firstRun: false });
    case 'grade': return renderGrade(route.id);
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
  const tiles = state.content.grades.map((g) => {
    const count = g.topics.length;
    const meta = count ? `${count} ${pluralUk(count, 'розділ', 'розділи', 'розділів')}` : 'Незабаром';
    return `<button class="grade-tile" data-grade="${esc(g.id)}" ${count ? '' : 'disabled'}>
        <span class="grade-number">${esc(g.grade ?? '')}</span>
        <span class="grade-label">клас</span>
        <span class="grade-meta">${meta}</span>
      </button>`;
  }).join('');

  root.innerHTML = `
    <header class="bar">
      <h1>Математика</h1>
      <button class="link-btn" id="about">Про застосунок</button>
    </header>
    <main class="grades">
      <p class="muted">Обери клас:</p>
      <div class="grade-grid">${tiles}</div>
    </main>
    ${problemsHtml()}`;

  root.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => go(`/grade/${b.dataset.grade}`)));
  root.querySelector('#about').addEventListener('click', () => go('/about'));
}

function problemsHtml() {
  const { errors } = state.content;
  return errors.length
    ? `<details class="warning"><summary>Частину завдань не завантажено (${errors.length})</summary><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>`
    : '';
}

// ---------- розділи класу ----------

function renderGrade(gradeId) {
  const grade = findGrade(gradeId);
  if (!grade || !grade.topics.length) return go('/', { replace: true });
  const records = progressStore.all();

  const cards = grade.topics.map((t) => {
    const p = topicProgress(records, t.id);
    const best = Math.max(0, ...Object.values(p.bestStars));
    return `<button class="topic-card" data-topic="${esc(t.id)}">
        <span class="topic-icon">${esc(t.icon ?? '📘')}</span>
        <span class="topic-title">${esc(t.title)}</span>
        <span class="topic-meta">${p.sessions ? starsHtml(best) : '<span class="muted">Ще не розпочато</span>'}</span>
      </button>`;
  }).join('');

  root.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Назад">←</button>
      <h1>${esc(grade.title)}</h1>
    </header>
    <main class="topics">${cards}</main>`;

  root.querySelector('#back').addEventListener('click', () => up('/'));
  root.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => go(`/topic/${b.dataset.topic}`)));
}

// ---------- вибір рівня ----------

function renderTopic(topicId) {
  const topic = findTopic(topicId);
  if (!topic) return go('/', { replace: true });
  const records = progressStore.all();

  const levelCard = (level) => {
    const p = levelProgress(records, topic.id, level);
    const stats = p.sessions
      ? `<span class="level-stats">Сесій: ${p.sessions} · точність ${Math.round(p.accuracy * 100)}%</span>
         ${p.lastAvgMs != null ? `<span class="level-stats">Остання сесія: ${formatDuration(p.lastAvgMs)} на приклад</span>` : ''}`
      : '<span class="level-stats">Ще не пройдено</span>';
    return `
      <button class="level-card" data-level="${level}">
        <span class="level-head">
          <span class="level-name">${esc(levelName(level))}</span>
          ${starsHtml(p.bestStars)}
        </span>
        ${stats}
      </button>`;
  };

  root.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="back" aria-label="Назад">←</button>
      <h1>${esc(topic.icon ?? '')} ${esc(topic.title)}</h1>
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
  state.sessionStartedAt = Date.now();
  state.questionStartedAt = Date.now();
  state.input = emptyInput(state.session.items[0]);
  state.feedback = null;
  state.hintBaseAvgMs = levelProgress(progressStore.all(), topic.id, level).lastAvgMs;
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

  const answerBox = answerHtml(item, state.input, fb ? (fb.correct ? 'ok' : 'bad') : null);
  const hasInlineBlank = item.text.includes('□');
  const prompt = hasInlineBlank ? mathHtml(item.text).replace('□', answerBox) : mathHtml(item.text);
  const answerRow = hasInlineBlank ? '' : `<div class="answer-row">Відповідь: ${answerBox} ${esc(item.unit ?? '')}</div>`;

  const feedback = fb
    ? fb.correct
      ? '<div class="feedback ok">Молодець! 🎉</div>'
      : `<div class="feedback bad">Правильна відповідь: <b>${mathHtml(formatAnswer(item.answerType, item.answer))}</b></div>
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
    </header>
    <main class="session">
      <p class="session-topic muted">${esc(topic?.title ?? '')} · ${esc(levelName(s.level))}</p>
      <div class="task ${hasInlineBlank ? 'task-inline' : 'task-text'} ${hasInlineBlank && item.text.length > 16 ? 'task-long' : ''}">${prompt}</div>
      ${answerRow}
      ${feedback}
    </main>
    ${keypadHtml(item, state.input, !!fb)}`;

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
    state.hint.open = !state.hint.open;
    if (state.hint.open) state.hint.used = true;
    renderSession();
  };
  root.querySelector('#hint').addEventListener('click', () => state.hint.visible && toggleHint());
  if (h.open && !fb) renderHintLayer(item, toggleHint);
  root.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => pressKey(b.dataset.key)));
  root.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.choice)));
  if (!fb) {
    root.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('click', () => {
      state.input = selectField(state.input, el.dataset.field);
      state.lastInputAt = Date.now();
      renderSession();
    }));
  }
}

// Картка підказки — окремим шаром поверх екрана. Вона стоїть одразу під
// прикладом і може перекрити клавіатуру, але не більше ніж наполовину;
// якщо текст довший, прокручується лише він, а «Зрозуміло» завжди видно.
// Тап поза карткою закриває її (і не натискає клавішу під нею).
function renderHintLayer(item, close) {
  const hint = normalizeHint(item.hint);
  if (!hint) return;
  const layer = document.createElement('div');
  layer.className = 'hint-layer';
  layer.innerHTML = `
    <div class="hint-card" role="dialog" aria-label="Підказка">
      <div class="hint-body">
        <ul class="hint-rules">${hint.rules.map((r) => `<li>${mathHtml(r)}</li>`).join('')}</ul>
        ${hint.scheme.length ? `<div class="hint-scheme">${hint.scheme.map((l) => `<div>${mathHtml(l)}</div>`).join('')}</div>` : ''}
      </div>
      <div class="hint-footer"><button class="link-btn" id="hint-close">Зрозуміло</button></div>
    </div>`;
  root.append(layer);

  const card = layer.querySelector('.hint-card');
  const anchor = (root.querySelector('.answer-row') ?? root.querySelector('.task')).getBoundingClientRect();
  const pad = root.querySelector('.numpad, .choices')?.getBoundingClientRect();
  const width = Math.min(520, innerWidth - 32);
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, 16), innerWidth - width - 16);
  const top = anchor.bottom + 12;
  // Клавіатура під карткою (а не збоку, як на планшеті) — перекриваємо не більше половини.
  const overlapsPad = pad && left < pad.right && left + width > pad.left;
  const bottomLimit = overlapsPad ? pad.top + pad.height / 2 : innerHeight - 16;
  Object.assign(card.style, { top: `${top}px`, left: `${left}px`, width: `${width}px`, maxHeight: `${Math.max(bottomLimit - top, 140)}px` });

  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  layer.querySelector('#hint-close').addEventListener('click', close);
}

window.addEventListener('resize', () => { if (onSessionScreen() && state.hint.open) renderSession(); });

const currentItem = () => state.session.items[state.session.index];

function pressKey(key) {
  if (state.feedback) return;
  const item = currentItem();
  if (key === 'ok') {
    if (isComplete(item, state.input)) answer(state.input);
    return;
  }
  state.input = applyKey(item, state.input, key);
  state.lastInputAt = Date.now();
  renderSession();
}

function answer(given) {
  if (state.feedback) return;
  const item = currentItem();
  const { session, result } = submitAnswer(state.session, given, Date.now() - state.questionStartedAt, { hintUsed: state.hint.used });
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
    delayMs: hintDelayMs(item, state.session.level, state.hintBaseAvgMs),
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
    if (e.key === 'Escape' || e.key === 'Enter') {
      state.hint.open = false;
      renderSession();
    }
    return;
  }
  const item = currentItem();
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
    ? `<h2>Помилки</h2><ul class="mistakes">${sum.mistakes.map((m) => {
        const answerText = m.answerText ?? String(m.answer);
        const text = m.text.includes('□') ? m.text.replace('□', answerText) : `${m.text} — ${answerText}`;
        return `<li><span>${mathHtml(text)}</span> <span class="given">твоя відповідь: ${mathHtml(m.given)}</span></li>`;
      }).join('')}</ul>`
    : '';

  root.innerHTML = `
    <header class="bar"><h1>${esc(topic?.title ?? 'Підсумок')}</h1></header>
    <main class="summary">
      <div class="summary-stars">${starsHtml(sum.stars)}</div>
      <p class="summary-praise">${praise}</p>
      <p class="summary-score">Правильно <b>${sum.correct}</b> з ${sum.total}</p>
      ${accuracyLine}
      ${timeLine}
      ${speedLine}
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

// ---------- старт ----------

history.replaceState({ depth: 0 }, '', location.hash || '#/');
render();
