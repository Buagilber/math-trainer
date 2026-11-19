// Звернення про помилку чи пропозицію (docs/FEEDBACK.md).
//
// Сайт статичний, тож створити issue напряму не можна (потрібен токен GitHub).
// Натомість відкриваємо форму нового issue на GitHub, уже заповнену:
// тип (шаблон із мітками), опис і контекст екрана. Людина додає скріншот
// (за бажанням) і надсилає.

import { CONFIG } from '../config.js';
import { esc } from './answer-input.js';

const KINDS = {
  bug: { template: 'app-bug.yml', title: '[Помилка] ', label: '🐞 Помилка', placeholder: 'Що не так? Можна одним реченням.' },
  idea: { template: 'app-idea.yml', title: '[Пропозиція] ', label: '💡 Пропозиція', placeholder: 'Що змінити чи додати?' },
};

// Пари [ключ, значення] → рядки «ключ: "значення"» (YAML, зручно розбирати агентові).
// Порожні значення пропускаємо.
export function contextText(pairs) {
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`)
    .join('\n');
}

export function issueUrl(kind, description, context) {
  const k = KINDS[kind];
  const summary = description.trim().split('\n')[0].slice(0, 70);
  const params = new URLSearchParams({ template: k.template, title: k.title + summary, description: description.trim(), context });
  return `https://github.com/${CONFIG.feedbackRepo}/issues/new?${params}`;
}

// Вікно звернення. context — знімок екрана на момент натискання ⚑.
export function openReportDialog(context) {
  let kind = 'bug';
  const overlay = document.createElement('div');
  overlay.className = 'dialog-backdrop';
  overlay.innerHTML = `
    <div class="dialog report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <h2 id="report-title">Повідомити</h2>
      <div class="report-kinds" role="radiogroup">
        ${Object.entries(KINDS).map(([id, k]) => `<button class="report-kind${id === kind ? ' active' : ''}" data-kind="${id}" role="radio" aria-checked="${id === kind}">${k.label}</button>`).join('')}
      </div>
      <textarea class="report-text" rows="4" placeholder="${esc(KINDS[kind].placeholder)}"></textarea>
      <p class="report-note">Відкриється GitHub із заповненою формою — натисни «Create». Дані про цей екран додадуться самі.</p>
      <p class="report-note report-shot">📷 Потрібен скріншот? Натисни «Скасувати», зроби знімок екрана й натисни ⚑ знову — на GitHub додаси його з галереї.</p>
      <div class="dialog-actions">
        <button class="btn btn-primary" data-action="send">Відкрити GitHub</button>
        <button class="btn" data-action="cancel">Скасувати</button>
      </div>
    </div>`;

  const text = overlay.querySelector('.report-text');
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  // Не передаємо натискання клавіш у клавіатуру сесії (введення в поле працює як звичайно).
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close();
    const k = e.target.closest('[data-kind]')?.dataset.kind;
    if (k) {
      kind = k;
      overlay.querySelectorAll('[data-kind]').forEach((b) => {
        b.classList.toggle('active', b.dataset.kind === kind);
        b.setAttribute('aria-checked', String(b.dataset.kind === kind));
      });
      text.placeholder = KINDS[kind].placeholder;
      text.focus();
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancel') close();
    if (action === 'send') {
      window.open(issueUrl(kind, text.value, context), '_blank', 'noopener');
      close();
    }
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  text.focus();
}
