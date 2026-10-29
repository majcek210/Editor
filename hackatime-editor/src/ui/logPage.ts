import { h, icon } from './dom';
import type { EditorApp } from './app';
import { WakaCli, type Invocation } from '../native/wakacli';
import { redactArgs, redactText } from '../core/tracker/redact';
import { exitMeaning } from '../core/tracker/tracker';

/**
 * Read-only view of every wakatime-cli invocation. The log is written by the
 * native plugin only; there is no API to edit or clear it from the app.
 */
export async function renderTrackingLog(host: HTMLElement, app: EditorApp): Promise<void> {
  const list = h('div', { class: 'log-list' });
  const page = h('div', { class: 'page log' },
    h('div', { class: 'page-head' },
      h('h1', {}, 'Tracking Log'),
      h('button', { class: 'btn secondary', onclick: () => app.rerender() }, icon('refresh'), ' Refresh')),
    h('p', { class: 'muted' }, 'Every wakatime-cli run, recorded by the native plugin: arguments (API key redacted), exit code, stdout, stderr and time. Read-only.'),
    list);
  host.append(page);

  let entries: Invocation[] = [];
  try {
    entries = (await WakaCli.getLog({ limit: 500 })).entries;
  } catch (e) {
    list.append(h('div', { class: 'tree-error' }, `Log not available: ${e instanceof Error ? e.message : String(e)}`));
    return;
  }
  if (!entries.length) list.append(h('p', { class: 'muted' }, 'No invocations yet.'));
  for (const e of entries) {
    const ok = e.exitCode === 0;
    list.append(h('div', { class: `log-entry ${ok ? 'ok' : 'fail'}` },
      h('div', { class: 'log-head' },
        h('span', { class: `badge ${ok ? 'ok' : 'fail'}` }, e.exitCode === null ? 'no exit' : `exit ${e.exitCode}`),
        h('span', {}, new Date(e.timestamp).toLocaleString()),
        h('span', { class: 'muted' }, `${e.reason}, ${e.durationMs} ms`)),
      h('div', { class: 'muted small' }, exitMeaning(e.exitCode)),
      e.error ? h('pre', { class: 'log-err' }, redactText(e.error)) : null,
      h('div', { class: 'log-label' }, 'arguments'),
      h('pre', {}, redactArgs(e.args).join(' ')),
      h('div', { class: 'log-label' }, 'stdout'),
      h('pre', {}, e.stdout ? redactText(e.stdout) : '(empty)'),
      h('div', { class: 'log-label' }, 'stderr'),
      h('pre', {}, e.stderr ? redactText(e.stderr) : '(empty)')));
  }
}
