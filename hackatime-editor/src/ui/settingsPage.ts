import { h, icon } from './dom';
import { toast } from './dialogs';
import type { EditorApp } from './app';
import { describeFailure, exitMeaning } from '../core/tracker/tracker';
import { redactText } from '../core/tracker/redact';

const SETUP_URL = 'https://hackatime.hackclub.com/my/wakatime_setup';

export function renderSettings(host: HTMLElement, app: EditorApp): void {
  const tracker = app.tracker;
  const info = tracker.getInfo();
  const state = tracker.getState();

  const keyInput = h('input', { class: 'text-input', type: 'password', placeholder: info?.hasApiKey ? 'A key is saved. Paste a new one to replace it.' : 'Paste your Hackatime API key', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const saveKey = async () => {
    const v = keyInput.value.trim();
    if (!v) return;
    try {
      await tracker.setApiKey(v);
      keyInput.value = '';
      toast('API key saved');
      await app.runTrackingTest();
    } catch (e) {
      toast(`Could not save key: ${errorText(e)}`);
      app.rerender();
    }
  };

  const statusLine = state.on
    ? h('div', { class: 'tracking-badge on' }, icon('pass'), h('span', {}, 'Tracking is on. Heartbeats go through wakatime-cli only.'))
    : h('div', { class: 'tracking-badge off' }, icon('warning'), h('span', {}, `Tracking is off: ${state.reason}`));

  const test = app.lastTest;
  let testBox: HTMLElement | null = null;
  if (test.running) testBox = h('div', { class: 'test-result' }, icon('loading', 'codicon-modifier-spin'), ' Running wakatime-cli...');
  else if (test.result) {
    const r = test.result;
    if ('error' in r) testBox = h('div', { class: 'test-result fail' }, h('strong', {}, 'Test failed'), h('pre', {}, r.error));
    else {
      const ok = r.exitCode === 0;
      testBox = h('div', { class: `test-result ${ok ? 'ok' : 'fail'}` },
        h('strong', {}, ok ? 'Test passed: wakatime-cli exited 0 and tracking is on.' : 'Test failed. Tracking stays off.'),
        h('div', {}, `Exit code: ${r.exitCode === null ? 'none' : r.exitCode} (${exitMeaning(r.exitCode)}), ${r.durationMs} ms`),
        !ok ? h('pre', {}, redactText(describeFailure(r))) : null,
        r.stdout ? h('details', {}, h('summary', {}, 'stdout'), h('pre', {}, redactText(r.stdout))) : null,
        r.stderr ? h('details', {}, h('summary', {}, 'stderr'), h('pre', {}, redactText(r.stderr))) : null,
        ok ? h('p', { class: 'muted' }, 'The CLI may hold a heartbeat in its own offline queue for up to 30 seconds (its rate limit) before syncing.') : null);
    }
  }

  const row = (label: string, control: HTMLElement, hint?: string) =>
    h('div', { class: 'setting' }, h('div', { class: 'setting-label' }, label), hint ? h('div', { class: 'setting-hint' }, hint) : null, control);

  const fontSize = h('div', { class: 'stepper' },
    h('button', { class: 'btn secondary', onclick: () => void app.setPrefs({ fontSize: Math.max(8, app.prefs.fontSize - 1) }) }, '-'),
    h('span', { class: 'stepper-value' }, `${app.prefs.fontSize}px`),
    h('button', { class: 'btn secondary', onclick: () => void app.setPrefs({ fontSize: Math.min(32, app.prefs.fontSize + 1) }) }, '+'));
  const wrap = h('input', { type: 'checkbox', checked: app.prefs.softWrap });
  wrap.addEventListener('change', () => void app.setPrefs({ softWrap: wrap.checked }));
  const tab = h('select', { class: 'text-input' }, ...[2, 4, 8].map((n) => h('option', { value: n, selected: app.prefs.tabSize === n }, String(n))));
  tab.addEventListener('change', () => void app.setPrefs({ tabSize: Number(tab.value) }));

  const facts: [string, string][] = info
    ? [
        ['wakatime-cli', info.available ? `${info.cliVersion ?? 'unknown version'} (${info.abi ?? '?'}, ${info.cgo ? 'cgo, Android DNS resolver' : 'pure Go resolver'})` : `not available: ${info.reason ?? 'unknown reason'}`],
        ['Binary', info.binaryPath ?? 'none'],
        ['API URL', info.apiUrl],
        ['Plugin / User-Agent', `hackatime-editor/${info.appVersion}`],
        ['Test file', info.testEntity],
      ]
    : [['wakatime-cli', 'native plugin not available (not running on Android)']];

  host.append(h('div', { class: 'page settings' },
    h('h1', {}, 'Settings'),
    h('h2', {}, 'Hackatime'),
    statusLine,
    state.on ? null : state.detail ? h('pre', { class: 'error-detail' }, redactText(state.detail)) : null,
    row('API key', h('div', { class: 'inline' }, keyInput, h('button', { class: 'btn', onclick: () => void saveKey() }, 'Save key')),
      'Get your key from the Hackatime setup page. It is stored only in the wakatime-cli config file in the app\'s private storage.'),
    h('a', { class: 'link', href: SETUP_URL, target: '_blank', rel: 'noopener' }, SETUP_URL),
    h('div', { class: 'inline buttons' },
      h('button', { class: 'btn', disabled: test.running || !info?.available, onclick: () => void app.runTrackingTest() }, icon('debug-start'), ' Test tracking'),
      h('button', { class: 'btn secondary', onclick: () => app.openPage('log') }, icon('output'), ' Show Tracking Log'),
      info?.hasApiKey ? h('button', { class: 'btn secondary', onclick: () => void tracker.clearApiKey().then(() => { toast('API key removed'); app.rerender(); }) }, 'Remove key') : null),
    testBox,
    h('table', { class: 'facts' }, ...facts.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))),
    h('h2', {}, 'Editor'),
    row('Font size', fontSize),
    row('Soft wrap', h('label', { class: 'check' }, wrap, ' Wrap long lines')),
    row('Tab size', tab),
    h('h2', {}, 'About'),
    h('p', { class: 'muted' }, 'Hackatime Editor is not affiliated with Hack Club or WakaTime. Icons: Codicons (CC BY 4.0). Editor: CodeMirror 6 (MIT). Tracking: wakatime-cli (BSD 3-Clause).')));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
}
