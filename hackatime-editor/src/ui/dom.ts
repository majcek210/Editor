type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

/** Tiny DOM builder. Strings are always inserted as text, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function icon(name: string, extra = ''): HTMLElement {
  return h('i', { class: `codicon codicon-${name} ${extra}`.trim(), 'aria-hidden': 'true' });
}

export function iconButton(name: string, title: string, onClick: (e: MouseEvent) => void, extra = ''): HTMLButtonElement {
  return h('button', { class: `icon-btn ${extra}`.trim(), title, 'aria-label': title, onclick: onClick as EventListener }, icon(name));
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
