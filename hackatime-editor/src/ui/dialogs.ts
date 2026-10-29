import { h } from './dom';

function overlay(content: HTMLElement, onDismiss: () => void): { close: () => void } {
  const back = h('div', { class: 'modal-back' }, content);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) {
      close();
      onDismiss();
    }
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      onDismiss();
    }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  function close() {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
  }
  return { close };
}

export function promptText(title: string, value = '', validate?: (v: string) => string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'text-input', value, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
    const err = h('div', { class: 'modal-error' });
    const submit = () => {
      const msg = validate?.(input.value) ?? null;
      if (msg) {
        err.textContent = msg;
        return;
      }
      o.close();
      resolve(input.value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const box = h('div', { class: 'modal' },
      h('div', { class: 'modal-title' }, title),
      input,
      err,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn secondary', onclick: () => { o.close(); resolve(null); } }, 'Cancel'),
        h('button', { class: 'btn', onclick: submit }, 'OK')));
    const o = overlay(box, () => resolve(null));
    setTimeout(() => {
      input.focus();
      const dot = value.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : value.length);
    }, 0);
  });
}

export interface Choice<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
}

export function choose<T extends string>(title: string, message: string, choices: Choice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    const box = h('div', { class: 'modal' },
      h('div', { class: 'modal-title' }, title),
      message ? h('div', { class: 'modal-message' }, message) : null,
      h('div', { class: 'modal-actions' },
        ...choices.map((c) => h('button', { class: c.primary ? 'btn' : 'btn secondary', onclick: () => { o.close(); resolve(c.id); } }, c.label))));
    const o = overlay(box, () => resolve(null));
  });
}

export function alertText(title: string, message: string): Promise<void> {
  return choose(title, message, [{ id: 'ok', label: 'OK', primary: true }]).then(() => undefined);
}

let toastTimer: number | undefined;
export function toast(text: string): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = h('div', { class: 'toast' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2500);
}
