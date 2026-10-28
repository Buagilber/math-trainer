// Інтерфейс: привітання, вибір класу, розділи, рівні, сесія та підсумок.
//
// Кожен екран має свою адресу (#/grade/g2, #/topic/g2-mul…), тому закладка
// відкриває саме той екран, де її зробили, а системна кнопка «Назад»
// на Android повертає на попередній екран.

import { CONFIG } from '../config.js';
import { createRng } from '../core/rng.js';
import { pluralUk } from '../core/generators.js';
import { buildSession, submitAnswer, isFinished, summarize, levelsOf } from '../core/session.js';
import { sessionRecord, topicProgress, levelProgress, compareWithPrevious } from '../core/progress.js';
import { loadContent } from './content.js';
import { progressStore, storage } from './storage.js';

const root = document.getElementById('app');
const WELCOMED_KEY = 'mt.welcomed';

const state = {
  content: null,
  session: null, // активна сесія (core/session.js)
  sessionStartedAt: 0,
  questionStartedAt: 0,
  input: '',
  feedback: null, // { correct, answer, item } після відповіді
};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

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
    ${firstRun ? '' : '<header class="bar"><button class="icon-btn" id="back" aria-label="Назад">←</button></header>'}
    <main class="welcome">
      <div class="welcome-hero" aria-hidden="true">
        <div class="demo-card demo-back">6 × 4 = <span class="blank">24</span></div>
        <div class="demo-card demo-front">8 + 7 = <span class="blank ok">15</span></div>
      </div>
      <h1>Математика без підручника</h1>
      <p class="welcome-lead">Тренажер прикладів за програмою НУШ. Обери клас і тему — і одразу розв'язуй.</p>
      <ul class="welcome-points">
        <li><span class="point-icon">⚡</span><span><b>Швидко.</b> Не треба шукати зошит чи підручник</span></li>
        <li><span class="point-icon">🎲</span><span><b>Щоразу нові приклади</b> з обраної теми</span></li>
        <li><span class="point-icon">📊</span><span><b>Видно прогрес:</b> зірки, точність і час</span></li>
      </ul>
      <button class="btn btn-primary btn-cta" id="start">${firstRun ? 'Почати тренування' : 'До тренажера'}</button>
      <p class="welcome-note muted">${esc(availableText)}<br>Безкоштовно і без реєстрації. Прогрес зберігається на цьому пристрої.</p>
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
  state.input = '';
  state.feedback = null;
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
  const shown = fb ? (fb.correct ? state.input : state.input || '?') : state.input;

  const blankClass = `blank ${fb ? (fb.correct ? 'ok' : 'bad') : ''} ${!fb && !state.input ? 'empty' : ''}`;
  const blank = `<span class="${blankClass}">${esc(shown || ' ')}</span>`;
  const hasInlineBlank = item.text.includes('□');
  // Нерозривний пробіл після числа, щоб «7 см» не розривалось між рядками.
  const text = esc(item.text).replace(/(\d) (?=\S)/g, '$1 ');
  const prompt = hasInlineBlank ? text.replace('□', blank) : text;
  const answerRow = hasInlineBlank ? '' : `<div class="answer-row">Відповідь: ${blank} ${esc(item.unit ?? '')}</div>`;

  const feedback = fb
    ? fb.correct
      ? '<div class="feedback ok">Молодець! 🎉</div>'
      : `<div class="feedback bad">Правильна відповідь: <b>${esc(fb.answer)}</b></div>
         <button class="btn btn-primary next" id="next">Далі</button>`
    : '';

  const input = item.answerType === 'choice'
    ? `<div class="choices">${item.choices.map((c) => `<button class="key choice" data-choice="${esc(c)}" ${fb ? 'disabled' : ''}>${esc(c)}</button>`).join('')}</div>`
    : `<div class="numpad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button class="key" data-key="${d}" ${fb ? 'disabled' : ''}>${d}</button>`).join('')}
        <button class="key key-del" data-key="del" ${fb ? 'disabled' : ''} aria-label="Стерти">⌫</button>
        <button class="key" data-key="0" ${fb ? 'disabled' : ''}>0</button>
        <button class="key key-ok" data-key="ok" ${fb || !state.input ? 'disabled' : ''} aria-label="Перевірити">✓</button>
      </div>`;

  root.innerHTML = `
    <header class="bar">
      <button class="icon-btn" id="quit" aria-label="Завершити">✕</button>
      <div class="progress"><div class="progress-fill" style="width:${(s.index / s.items.length) * 100}%"></div></div>
      <span class="counter">${number}/${s.items.length}</span>
    </header>
    <main class="session">
      <p class="session-topic muted">${esc(topic?.title ?? '')} · ${esc(levelName(s.level))}</p>
      <div class="task ${hasInlineBlank ? 'task-inline' : 'task-text'}">${prompt}</div>
      ${answerRow}
      ${feedback}
    </main>
    ${input}`;

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
  root.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => pressKey(b.dataset.key)));
  root.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => answer(b.dataset.choice)));
}

function pressKey(key) {
  if (state.feedback) return;
  if (key === 'del') state.input = state.input.slice(0, -1);
  else if (key === 'ok') { if (state.input) answer(state.input); return; }
  else if (state.input.length < 4) state.input = state.input === '0' ? key : state.input + key;
  renderSession();
}

function answer(given) {
  if (state.feedback) return;
  const item = state.session.items[state.session.index];
  const { session, result } = submitAnswer(state.session, given, Date.now() - state.questionStartedAt);
  state.session = session;
  state.input = String(given);
  state.feedback = { correct: result.correct, answer: item.answer, item };
  renderSession();
  if (result.correct) setTimeout(advance, CONFIG.correctAdvanceMs);
}

function advance() {
  if (!state.feedback) return;
  state.feedback = null;
  state.input = '';
  state.questionStartedAt = Date.now();
  if (isFinished(state.session)) {
    progressStore.add(sessionRecord(state.session, { startedAt: state.sessionStartedAt }));
    go(`/topic/${state.session.topicId}/result`, { replace: true });
  } else {
    renderSession();
  }
}

const onSessionScreen = () => currentRoute().sub === 'play' && state.session;

// Фізична клавіатура (планшет з клавіатурою, десктоп).
document.addEventListener('keydown', (e) => {
  if (!onSessionScreen()) return;
  if (state.feedback) {
    if (e.key === 'Enter' && !state.feedback.correct) advance();
    return;
  }
  const item = state.session.items[state.session.index];
  if (item?.answerType === 'choice') {
    if (['<', '>', '='].includes(e.key)) answer(e.key);
    return;
  }
  if (/^[0-9]$/.test(e.key)) pressKey(e.key);
  else if (e.key === 'Backspace') pressKey('del');
  else if (e.key === 'Enter') pressKey('ok');
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
        const text = m.text.includes('□') ? m.text.replace('□', String(m.answer)) : `${m.text} — ${m.answer}`;
        return `<li><span>${esc(text)}</span> <span class="given">твоя відповідь: ${esc(m.given)}</span></li>`;
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
