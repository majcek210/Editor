import { h, clear } from './dom';
import { fuzzyFilter } from '../core/fuzzy';

export interface QuickItem {
  label: string;
  description?: string;
  detail?: string;
  run: () => void;
}

export interface QuickPickOptions {
  placeholder: string;
  value?: string;
  /** Static items filtered fuzzily, or a function for custom results. */
  items: QuickItem[] | ((query: string) => QuickItem[]);
  /** Called on Enter when there are no items (for example Go to Line). */
  onAccept?: (query: string) => void;
  matchOn?: 'label' | 'description';
}

let current: { close: () => void } | null = null;

export function isPaletteOpen(): boolean {
  return current !== null;
}

export function closePalette(): void {
  current?.close();
}

/** The command palette / quick open widget at the top of the editor. */
export function showQuickPick(opts: QuickPickOptions): void {
  current?.close();
  const input = h('input', { class: 'qp-input', placeholder: opts.placeholder, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', value: opts.value ?? '' });
  const list = h('div', { class: 'qp-list', role: 'listbox' });
  const box = h('div', { class: 'quickpick' }, input, list);
  const back = h('div', { class: 'qp-back' }, box);
  let shown: QuickItem[] = [];
  let sel = 0;

  const render = () => {
    const q = input.value;
    if (typeof opts.items === 'function') shown = opts.items(q);
    else {
      const key = opts.matchOn === 'description' ? (i: QuickItem) => `${i.description ?? ''}/${i.label}` : (i: QuickItem) => i.label;
      shown = fuzzyFilter(q, opts.items, key).map((r) => r.item);
    }
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    clear(list);
    shown.forEach((it, i) => {
      const row = h('div', { class: `qp-item${i === sel ? ' selected' : ''}`, role: 'option' },
        h('span', { class: 'qp-label' }, it.label),
        it.description ? h('span', { class: 'qp-desc' }, it.description) : null,
        it.detail ? h('span', { class: 'qp-detail' }, it.detail) : null);
      row.addEventListener('click', () => accept(i));
      list.append(row);
    });
    if (!shown.length && !opts.onAccept) list.append(h('div', { class: 'qp-empty' }, 'No matching results'));
    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  };
  const accept = (i: number) => {
    const it = shown[i];
    if (it) {
      close();
      it.run();
    } else if (opts.onAccept) {
      const q = input.value;
      close();
      opts.onAccept(q);
    }
  };
  input.addEventListener('input', () => {
    sel = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { accept(sel); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
  });
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  function close() {
    back.remove();
    current = null;
  }
  current = { close };
  document.body.append(back);
  render();
  setTimeout(() => input.focus(), 0);
}
