import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { openSearchPanel, closeSearchPanel, searchPanelOpen, selectNextOccurrence } from '@codemirror/search';
import { cursorCharLeft, cursorCharRight, cursorLineDown, cursorLineUp } from '@codemirror/commands';
import { Preferences } from '@capacitor/preferences';
import { App as CapApp } from '@capacitor/app';

import { h, icon, iconButton, clear } from './dom';
import { alertText, choose, promptText, toast } from './dialogs';
import { closePalette, isPaletteOpen, showQuickPick, type QuickItem } from './palette';
import { renderSettings } from './settingsPage';
import { renderTrackingLog } from './logPage';
import { CommandRegistry } from '../core/commands';
import { activatePlugins, type ActiveFileInfo, type EditorPlugin, type PluginContext, type StatusItem } from '../core/plugins';
import type { Tracker, TrackingState, FileActivity } from '../core/tracker/tracker';
import type { ActivityKind } from '../core/tracker/throttle';
import type { Invocation } from '../native/wakacli';
import { createState, fontConf, fontTheme, goToLine, insertText, isUserEdit, languageConf, redo, tabConf, tabExtensions, undo, wrapConf, type EditorPrefs } from '../editor/setup';
import { LANGUAGES, detectLanguage, type LanguageDef } from '../editor/languages';
import { Project, baseName, joinRel, listProjects, parentRel, validName, type Entry, type ProjectRef, type RootKind } from '../fs/project';

interface FileTab {
  kind: 'file';
  rel: string;
  name: string;
  state: EditorState;
  dirty: boolean;
  lang: LanguageDef;
  binary?: boolean;
}

interface PageTab {
  kind: 'page';
  page: 'settings' | 'log';
  name: string;
}

type Tab = FileTab | PageTab;

const DEFAULT_PREFS: EditorPrefs = { fontSize: 14, softWrap: false, tabSize: 4 };
const MAX_OPEN_BYTES = 2 * 1024 * 1024;
const WIDE_QUERY = '(min-width: 900px), (orientation: landscape) and (min-width: 640px)';

export class EditorApp {
  readonly commands = new CommandRegistry();
  prefs: EditorPrefs = { ...DEFAULT_PREFS };
  project: Project | null = null;
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private view!: EditorView;
  private fileIndex: Entry[] | null = null;
  private expanded = new Set<string>(['']);
  private children = new Map<string, Entry[]>();
  private sidebarView: 'explorer' | 'search' = 'explorer';
  private sidebarOpen = false;
  private wide = window.matchMedia(WIDE_QUERY);
  private statusItems: HTMLElement;
  private activeFileListeners = new Set<(f: ActiveFileInfo | null) => void>();
  private docListeners = new Set<(f: ActiveFileInfo) => void>();
  private trackingState: TrackingState = { on: false, reason: 'starting' };
  private lastSearch = { query: '', regex: false, caseSensitive: false, wholeWord: false };

  // layout
  private root: HTMLElement;
  private sidebar!: HTMLElement;
  private sidebarBody!: HTMLElement;
  private tabBar!: HTMLElement;
  private editorHost!: HTMLElement;
  private pageHost!: HTMLElement;
  private welcome!: HTMLElement;
  private status!: Record<'tracking' | 'pos' | 'indent' | 'encoding' | 'language' | 'project', HTMLElement>;
  private statusBar!: HTMLElement;
  private kbBar!: HTMLElement;
  private activityButtons = new Map<string, HTMLElement>();

  constructor(root: HTMLElement, readonly tracker: Tracker) {
    this.root = root;
    this.statusItems = h('div', { class: 'status-plugins' });
  }

  // ------------------------------------------------------------------ setup

  async start(plugins: EditorPlugin[]): Promise<void> {
    const saved = await Preferences.get({ key: 'prefs' });
    if (saved.value) this.prefs = { ...DEFAULT_PREFS, ...JSON.parse(saved.value) };
    this.buildLayout();
    this.registerCommands();
    this.bindGlobalEvents();
    this.tracker.onChange((s) => {
      this.trackingState = s;
      this.renderTrackingStatus();
    });
    await activatePlugins(plugins, this.pluginContext());

    const ref = await Preferences.get({ key: 'project' });
    const proj: ProjectRef = ref.value ? JSON.parse(ref.value) : { root: 'EXTERNAL', path: 'projects/welcome' };
    await this.openProject(proj, !ref.value);
    const openTabs = await Preferences.get({ key: 'openTabs' });
    if (openTabs.value) {
      // Restoring tabs is not user activity, so it never sends heartbeats.
      for (const rel of JSON.parse(openTabs.value) as string[]) await this.openFile(rel, false).catch(() => undefined);
    }
    this.layout();
    this.renderAll();
  }

  private buildLayout(): void {
    clear(this.root);
    const bar = h('div', { class: 'titlebar' },
      iconButton('menu', 'Toggle Sidebar', () => this.toggleSidebar(), 'menu-btn'),
      h('div', { class: 'title-center' },
        h('button', { class: 'command-center', onclick: () => this.showCommands() }, icon('search'), h('span', {}, 'Search files and commands'))),
      iconButton('terminal-cmd', 'Command Palette (Ctrl+Shift+P)', () => this.showCommands()));

    const activity = h('nav', { class: 'activitybar' });
    const addAct = (id: string, ic: string, title: string, run: () => void) => {
      const b = iconButton(ic, title, run, 'act-btn');
      this.activityButtons.set(id, b);
      activity.append(b);
    };
    addAct('explorer', 'files', 'Explorer', () => this.showSidebar('explorer'));
    addAct('search', 'search', 'Search', () => this.showSidebar('search'));
    activity.append(h('div', { class: 'spacer' }));
    addAct('log', 'output', 'Tracking Log', () => this.openPage('log'));
    addAct('settings', 'settings-gear', 'Settings', () => this.openPage('settings'));

    this.sidebarBody = h('div', { class: 'sidebar-body' });
    // At phone width the activity bar is hidden; the drawer carries the same entries.
    const drawerActs = h('div', { class: 'drawer-acts' },
      iconButton('files', 'Explorer', () => this.showSidebar('explorer')),
      iconButton('search', 'Search', () => this.showSidebar('search')),
      iconButton('output', 'Tracking Log', () => this.openPage('log')),
      iconButton('settings-gear', 'Settings', () => this.openPage('settings')));
    this.sidebar = h('aside', { class: 'sidebar' }, drawerActs, this.sidebarBody);
    const scrim = h('div', { class: 'scrim', onclick: () => this.setSidebar(false) });

    this.tabBar = h('div', { class: 'tabbar', role: 'tablist' });
    this.editorHost = h('div', { class: 'editor-host' });
    this.pageHost = h('div', { class: 'page-host' });
    this.welcome = h('div', { class: 'welcome' });
    const editorArea = h('section', { class: 'editor-area' }, this.tabBar, this.editorHost, this.pageHost, this.welcome);

    this.kbBar = this.keyboardBar();

    const st = (cls: string, title: string, onClick?: () => void) =>
      h('button', { class: `status-item ${cls}`, title, onclick: onClick as EventListener | undefined, tabindex: onClick ? 0 : -1 });
    this.status = {
      tracking: st('tracking', 'Hackatime tracking status', () => this.openPage('settings')),
      project: st('project', 'Open Folder', () => this.pickProject()),
      pos: st('pos', 'Go to Line', () => this.promptGoToLine()),
      indent: st('indent', 'Indentation'),
      encoding: st('encoding', 'Encoding'),
      language: st('language', 'Change Language Mode', () => this.pickLanguage()),
    };
    this.statusBar = h('footer', { class: 'statusbar' },
      h('div', { class: 'status-left' }, this.status.tracking, this.status.project),
      h('div', { class: 'status-right' }, this.statusItems, this.status.pos, this.status.indent, this.status.encoding, this.status.language));

    this.root.append(bar, h('div', { class: 'main' }, activity, this.sidebar, scrim, editorArea), this.kbBar, this.statusBar);

    const listener = EditorView.updateListener.of((u) => this.onEditorUpdate(u));
    this.editorExtra = listener;
    this.view = new EditorView({ state: createState('', [], this.prefs, listener), parent: this.editorHost });
    this.view.contentDOM.setAttribute('autocapitalize', 'off');
    this.view.contentDOM.setAttribute('autocorrect', 'off');
  }

  private editorExtra: import('@codemirror/state').Extension = [];

  private bindGlobalEvents(): void {
    // Only real input events count as user activity for the tracker.
    const note = () => this.tracker.throttle.noteUserInput();
    for (const ev of ['keydown', 'pointerdown', 'beforeinput', 'wheel'] as const) {
      document.addEventListener(ev, note, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => this.tracker.throttle.setForeground(document.visibilityState === 'visible'));
    CapApp.addListener('appStateChange', ({ isActive }) => this.tracker.throttle.setForeground(isActive)).catch(() => undefined);
    CapApp.addListener('pause', () => this.tracker.throttle.setForeground(false)).catch(() => undefined);
    CapApp.addListener('resume', () => this.tracker.throttle.setForeground(true)).catch(() => undefined);
    CapApp.addListener('backButton', () => this.onBack()).catch(() => undefined);

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      let handled = true;
      if (e.shiftKey && k === 'p') this.showCommands();
      else if (e.shiftKey && k === 'f') this.showSidebar('search');
      else if (e.shiftKey && k === 'e') this.showSidebar('explorer');
      else if (!e.shiftKey && k === 'p') this.quickOpen();
      else if (!e.shiftKey && k === 's') void this.saveActive();
      else if (e.altKey && k === 's') void this.saveAll();
      else if (!e.shiftKey && k === 'w') void this.closeTab(this.active);
      else if (!e.shiftKey && k === 'g') this.promptGoToLine();
      else if (!e.shiftKey && k === 'b') this.toggleSidebar();
      else if (k === ',') this.openPage('settings');
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });

    this.wide.addEventListener('change', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.updateKeyboardBar());
    this.view.contentDOM.addEventListener('focus', () => this.updateKeyboardBar());
    this.view.contentDOM.addEventListener('blur', () => setTimeout(() => this.updateKeyboardBar(), 50));
  }

  private onBack(): void {
    if (isPaletteOpen()) return closePalette();
    const modal = document.querySelector('.modal-back');
    if (modal) return modal.remove();
    if (!this.wide.matches && this.sidebarOpen) return this.setSidebar(false);
    if (searchPanelOpen(this.view.state)) {
      closeSearchPanel(this.view);
      return;
    }
    void CapApp.minimizeApp().catch(() => undefined);
  }

  private pluginContext(): PluginContext {
    return {
      commands: this.commands,
      addStatusItem: ({ title, onClick }): StatusItem => {
        const el = h('button', { class: 'status-item', title: title ?? '', onclick: onClick as EventListener | undefined });
        this.statusItems.append(el);
        return {
          setText: (t) => {
            el.textContent = t;
            el.hidden = !t;
          },
          dispose: () => el.remove(),
        };
      },
      onActiveFileChange: (fn) => {
        this.activeFileListeners.add(fn);
        return () => this.activeFileListeners.delete(fn);
      },
      onDocumentChange: (fn) => {
        this.docListeners.add(fn);
        return () => this.docListeners.delete(fn);
      },
    };
  }

  private activeFileInfo(): ActiveFileInfo | null {
    const t = this.active;
    if (!t || t.kind !== 'file') return null;
    return { name: t.name, language: t.lang.name, text: t.state.doc.toString() };
  }

  // --------------------------------------------------------------- commands

  private registerCommands(): void {
    const c = (id: string, title: string, run: () => unknown, keybinding?: string) => this.commands.register({ id, title, run, keybinding });
    c('file.open', 'Open File...', () => this.quickOpen(), 'Ctrl+P');
    c('file.save', 'Save', () => this.saveActive(), 'Ctrl+S');
    c('file.saveAll', 'Save All', () => this.saveAll(), 'Ctrl+Alt+S');
    c('file.new', 'New File...', () => this.createEntry('file', this.currentDir()));
    c('folder.new', 'New Folder...', () => this.createEntry('directory', this.currentDir()));
    c('folder.open', 'Open Folder...', () => this.pickProject());
    c('tab.close', 'Close Tab', () => this.closeTab(this.active), 'Ctrl+W');
    c('tab.closeAll', 'Close All Tabs', () => this.closeAllTabs());
    c('editor.goToLine', 'Go to Line...', () => this.promptGoToLine(), 'Ctrl+G');
    c('editor.changeLanguage', 'Change Language Mode', () => this.pickLanguage());
    c('editor.find', 'Find / Replace in File', () => this.openFind(), 'Ctrl+F');
    c('editor.toggleWrap', 'Toggle Soft Wrap', () => this.setPrefs({ softWrap: !this.prefs.softWrap }));
    c('editor.addNextOccurrence', 'Add Cursor to Next Occurrence', () => { if (this.activeFile()) { selectNextOccurrence(this.view); this.view.focus(); } }, 'Ctrl+D');
    c('editor.fontBigger', 'Increase Font Size', () => this.setPrefs({ fontSize: Math.min(32, this.prefs.fontSize + 1) }));
    c('editor.fontSmaller', 'Decrease Font Size', () => this.setPrefs({ fontSize: Math.max(8, this.prefs.fontSize - 1) }));
    c('view.toggleSidebar', 'Toggle Sidebar', () => this.toggleSidebar(), 'Ctrl+B');
    c('view.explorer', 'Show Explorer', () => this.showSidebar('explorer'), 'Ctrl+Shift+E');
    c('search.project', 'Search in Project', () => this.showSidebar('search'), 'Ctrl+Shift+F');
    c('settings.open', 'Open Settings', () => this.openPage('settings'), 'Ctrl+,');
    c('tracking.showLog', 'Show Tracking Log', () => this.openPage('log'));
    c('tracking.test', 'Hackatime: Test Tracking', () => this.openPage('settings', true));
  }

  showCommands(): void {
    const items: QuickItem[] = this.commands.list().map((cmd) => ({
      label: cmd.title,
      detail: cmd.keybinding,
      run: () => void Promise.resolve(cmd.run()).catch((e) => alertText('Command failed', String(e))),
    }));
    showQuickPick({ placeholder: 'Type the name of a command', items });
  }

  // ------------------------------------------------------------ projects

  async openProject(ref: ProjectRef, seedWelcome = false): Promise<void> {
    const p = new Project(ref);
    await p.init();
    if (seedWelcome && !(await p.exists('README.md'))) {
      await p.write('README.md', '# Welcome\n\nThis folder lives in the app storage. Open Settings to connect Hackatime.\n');
    }
    this.project = p;
    this.fileIndex = null;
    this.children.clear();
    this.expanded = new Set(['']);
    await Preferences.set({ key: 'project', value: JSON.stringify(ref) });
    this.renderSidebar();
    this.renderStatus();
  }

  private async pickProject(): Promise<void> {
    const roots: { root: RootKind; label: string }[] = [
      { root: 'EXTERNAL', label: 'App storage' },
      { root: 'DOCUMENTS', label: 'Documents' },
    ];
    const items: QuickItem[] = [];
    for (const r of roots) {
      for (const name of await listProjects(r.root)) {
        items.push({ label: name, description: r.label, run: () => void this.switchProject({ root: r.root, path: `projects/${name}` }) });
      }
    }
    for (const r of roots) {
      items.push({ label: `New project folder in ${r.label}...`, run: () => void this.newProject(r.root) });
    }
    showQuickPick({ placeholder: 'Open folder', items, matchOn: 'description' });
  }

  private async newProject(root: RootKind): Promise<void> {
    const name = await promptText('New project folder name', '', validName);
    if (!name) return;
    await this.switchProject({ root, path: `projects/${name.trim()}` });
  }

  private async switchProject(ref: ProjectRef): Promise<void> {
    if (!(await this.confirmDiscard(this.tabs.filter(isDirtyFile)))) return;
    this.tabs = this.tabs.filter((t) => t.kind === 'page');
    this.active = this.tabs[0] ?? null;
    try {
      await this.openProject(ref);
    } catch (e) {
      await alertText('Could not open folder', String(e));
    }
    this.persistTabs();
    this.renderAll();
  }

  private currentDir(): string {
    const t = this.activeFile();
    return t ? parentRel(t.rel) : '';
  }

  // --------------------------------------------------------------- tabs

  private activeFile(): FileTab | null {
    return this.active && this.active.kind === 'file' ? this.active : null;
  }

  /** Opens a file. userInitiated is true only when the user tapped or picked it. */
  async openFile(rel: string, userInitiated: boolean, line?: number, col?: number): Promise<void> {
    if (!this.project) return;
    let tab = this.tabs.find((t): t is FileTab => t.kind === 'file' && t.rel === rel);
    if (!tab) {
      const lang = detectLanguage(rel);
      let text = '';
      let binary = false;
      try {
        text = await this.project.read(rel);
        if (text.length > MAX_OPEN_BYTES || text.includes('\u0000')) {
          binary = true;
          text = '';
        }
      } catch (e) {
        if (userInitiated) await alertText('Could not open file', `${rel}\n${String(e)}`);
        throw e;
      }
      tab = { kind: 'file', rel, name: baseName(rel), lang, dirty: false, binary, state: createState(text, [], this.prefs, this.editorExtra) };
      this.tabs.push(tab);
      void this.loadLanguage(tab, lang);
    }
    this.activate(tab);
    if (line) goToLine(this.view, line, col);
    if (!this.wide.matches) this.setSidebar(false);
    this.persistTabs();
    if (userInitiated) void this.track('open', tab);
  }

  private async loadLanguage(tab: FileTab, lang: LanguageDef): Promise<void> {
    const ext = await lang.load();
    if (tab.lang !== lang) return;
    const effects = languageConf.reconfigure(ext);
    if (this.active === tab) this.view.dispatch({ effects });
    else tab.state = tab.state.update({ effects }).state;
  }

  private activate(tab: Tab | null): void {
    const prev = this.activeFile();
    if (prev) prev.state = this.view.state;
    this.active = tab;
    if (tab && tab.kind === 'file') this.view.setState(tab.state);
    this.renderAll();
    const info = this.activeFileInfo();
    for (const fn of this.activeFileListeners) fn(info);
    if (tab && tab.kind === 'file' && !tab.binary && this.wide.matches) this.view.focus();
  }

  openPage(page: 'settings' | 'log', runTest = false): void {
    let tab = this.tabs.find((t): t is PageTab => t.kind === 'page' && t.page === page);
    if (!tab) {
      tab = { kind: 'page', page, name: page === 'settings' ? 'Settings' : 'Tracking Log' };
      this.tabs.push(tab);
    }
    if (!this.wide.matches) this.setSidebar(false);
    this.activate(tab);
    if (runTest) void this.runTrackingTest();
  }

  private async closeTab(tab: Tab | null): Promise<void> {
    if (!tab) return;
    if (isDirtyFile(tab)) {
      const r = await choose(`Save changes to ${tab.name}?`, 'Your changes will be lost if you do not save them.', [
        { id: 'save', label: 'Save', primary: true },
        { id: 'discard', label: "Don't Save" },
        { id: 'cancel', label: 'Cancel' },
      ]);
      if (r === null || r === 'cancel') return;
      if (r === 'save' && !(await this.save(tab))) return;
    }
    const i = this.tabs.indexOf(tab);
    this.tabs.splice(i, 1);
    if (this.active === tab) {
      if (tab.kind === 'file') this.active = null;
      this.activate(this.tabs[Math.min(i, this.tabs.length - 1)] ?? null);
    } else this.renderTabs();
    this.persistTabs();
  }

  private async closeAllTabs(): Promise<void> {
    if (!(await this.confirmDiscard(this.tabs.filter(isDirtyFile)))) return;
    this.tabs = [];
    this.active = null;
    this.activate(null);
    this.persistTabs();
  }

  /** Asks what to do with unsaved tabs. Returns false when the user cancels. */
  private async confirmDiscard(dirty: FileTab[]): Promise<boolean> {
    if (!dirty.length) return true;
    const r = await choose(`Save changes to ${dirty.length} file${dirty.length > 1 ? 's' : ''}?`, dirty.map((t) => t.rel).join('\n'), [
      { id: 'save', label: 'Save All', primary: true },
      { id: 'discard', label: "Don't Save" },
      { id: 'cancel', label: 'Cancel' },
    ]);
    if (r === 'save') {
      for (const t of dirty) if (!(await this.save(t))) return false;
      return true;
    }
    return r === 'discard';
  }

  private persistTabs(): void {
    const rels = this.tabs.filter((t): t is FileTab => t.kind === 'file').map((t) => t.rel);
    void Preferences.set({ key: 'openTabs', value: JSON.stringify(rels) });
  }

  // --------------------------------------------------------------- saving

  async saveActive(): Promise<void> {
    const t = this.activeFile();
    if (t) await this.save(t);
  }

  async saveAll(): Promise<void> {
    for (const t of this.tabs) if (isDirtyFile(t)) await this.save(t);
  }

  private async save(tab: FileTab): Promise<boolean> {
    if (!this.project || tab.binary) return false;
    if (this.active === tab) tab.state = this.view.state;
    try {
      await this.project.write(tab.rel, tab.state.doc.toString());
    } catch (e) {
      await alertText('Save failed', `${tab.rel}\n${String(e)}`);
      return false;
    }
    tab.dirty = false;
    this.renderTabs();
    void this.track('save', tab);
    return true;
  }

  // ------------------------------------------------------------- tracking

  private activity(tab: FileTab): FileActivity {
    const state = this.active === tab ? this.view.state : tab.state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    return {
      path: this.project!.absPath(tab.rel),
      project: this.project!.name,
      language: tab.lang.name,
      line: line.number,
      column: head - line.from + 1,
      lines: state.doc.lines,
    };
  }

  private async track(kind: ActivityKind, tab: FileTab): Promise<void> {
    if (!this.project || tab.binary) return;
    await this.tracker.record(kind, this.activity(tab));
    if (this.active?.kind === 'page' && this.active.page === 'log') this.renderPage();
  }

  /** Result of the last "Test tracking" run, shown in Settings. */
  lastTest: { running: boolean; result?: Invocation | { error: string } } = { running: false };

  async runTrackingTest(): Promise<void> {
    if (this.lastTest.running) return;
    this.lastTest = { running: true };
    this.renderPage();
    const result = await this.tracker.runTest().catch((e: unknown) => ({ error: String(e) }));
    this.lastTest = { running: false, result };
    this.renderPage();
  }

  rerender(): void {
    this.renderPage();
  }

  /** Called by main on first launch when a key exists but was never tested. */
  async firstLaunchTest(): Promise<void> {
    this.openPage('settings', true);
  }

  // ---------------------------------------------------------- editor events

  private onEditorUpdate(u: ViewUpdate): void {
    const tab = this.activeFile();
    if (!tab || u.view !== this.view) return;
    tab.state = u.state;
    if (u.docChanged) {
      if (!tab.dirty) {
        tab.dirty = true;
        this.renderTabs();
      }
      if (u.transactions.some(isUserEdit)) void this.track('edit', tab);
      const info = this.activeFileInfo();
      if (info) for (const fn of this.docListeners) fn(info);
    }
    if (u.docChanged || u.selectionSet) this.renderStatus();
  }

  // ------------------------------------------------------- quick pickers

  quickOpen(): void {
    if (!this.project) return;
    const project = this.project;
    const show = (files: Entry[]) => showQuickPick({
      placeholder: 'Search files by name',
      items: files.map((f) => ({ label: f.name, description: parentRel(f.rel), run: () => void this.openFile(f.rel, true) })),
      matchOn: 'description',
    });
    if (this.fileIndex) return show(this.fileIndex);
    toast('Indexing files...');
    void project.walk().then((files) => {
      if (this.project !== project) return;
      this.fileIndex = files;
      show(files);
    });
  }

  promptGoToLine(): void {
    const t = this.activeFile();
    if (!t) return;
    const lines = this.view.state.doc.lines;
    showQuickPick({
      placeholder: `Type a line number between 1 and ${lines} (line:column also works)`,
      items: (q) => {
        const m = /^\s*:?(\d+)(?::(\d+))?\s*$/.exec(q);
        if (!m) return [];
        const line = Number(m[1]);
        const col = m[2] ? Number(m[2]) : 1;
        return [{ label: `Go to line ${line}${m[2] ? `, column ${col}` : ''}`, run: () => goToLine(this.view, line, col) }];
      },
    });
  }

  pickLanguage(): void {
    const t = this.activeFile();
    if (!t) return;
    const seen = new Set<string>();
    const items = LANGUAGES.filter((l) => !seen.has(l.id) && seen.add(l.id)).map((l) => ({
      label: l.name === 'TSX' ? 'TypeScript JSX' : l.id === 'jsx' ? 'JavaScript JSX' : l.name,
      description: l.extensions.map((e) => `.${e}`).join(' '),
      run: () => {
        t.lang = l;
        void this.loadLanguage(t, l);
        this.renderStatus();
        for (const fn of this.activeFileListeners) fn(this.activeFileInfo());
      },
    }));
    showQuickPick({ placeholder: 'Select language mode', items });
  }

  private openFind(): void {
    if (!this.activeFile()) return;
    openSearchPanel(this.view);
  }

  // ------------------------------------------------------------- sidebar

  private layout(): void {
    this.root.classList.toggle('wide', this.wide.matches);
    if (this.wide.matches && !this.root.classList.contains('sidebar-hidden')) this.sidebarOpen = true;
    this.root.classList.toggle('drawer-open', !this.wide.matches && this.sidebarOpen);
  }

  private setSidebar(open: boolean): void {
    this.sidebarOpen = open;
    this.root.classList.toggle('sidebar-hidden', !open);
    this.root.classList.toggle('drawer-open', !this.wide.matches && open);
    this.renderActivity();
  }

  toggleSidebar(): void {
    this.setSidebar(!this.sidebarOpen);
  }

  showSidebar(view: 'explorer' | 'search'): void {
    if (this.sidebarOpen && this.sidebarView === view && this.wide.matches) {
      this.setSidebar(false);
      return;
    }
    this.sidebarView = view;
    this.setSidebar(true);
    this.renderSidebar();
    if (view === 'search') setTimeout(() => this.sidebarBody.querySelector<HTMLInputElement>('.search-input')?.focus(), 0);
  }

  private renderSidebar(): void {
    clear(this.sidebarBody);
    if (this.sidebarView === 'explorer') this.renderExplorer();
    else this.renderSearch();
    this.renderActivity();
  }

  private renderActivity(): void {
    for (const [id, b] of this.activityButtons) {
      const on = (id === this.sidebarView && this.sidebarOpen) || (this.active?.kind === 'page' && this.active.page === id);
      b.classList.toggle('active', on);
    }
  }

  private renderExplorer(): void {
    const p = this.project;
    const header = h('div', { class: 'sidebar-title' }, h('span', {}, 'EXPLORER'));
    const projectRow = h('div', { class: 'section-header' },
      icon('chevron-down'),
      h('span', { class: 'section-name' }, p ? p.name.toUpperCase() : 'NO FOLDER OPENED'),
      h('div', { class: 'section-actions' },
        iconButton('new-file', 'New File', () => void this.createEntry('file', '')),
        iconButton('new-folder', 'New Folder', () => void this.createEntry('directory', '')),
        iconButton('refresh', 'Refresh Explorer', () => this.refreshTree()),
        iconButton('collapse-all', 'Collapse Folders', () => { this.expanded = new Set(['']); this.renderSidebar(); }),
        iconButton('folder-opened', 'Open Folder', () => void this.pickProject())));
    const tree = h('div', { class: 'tree', role: 'tree' });
    this.sidebarBody.append(header, projectRow, tree);
    if (p) void this.renderTreeLevel(tree, '', 0);
  }

  private refreshTree(): void {
    this.children.clear();
    this.fileIndex = null;
    this.renderSidebar();
  }

  private async renderTreeLevel(container: HTMLElement, rel: string, depth: number): Promise<void> {
    const p = this.project;
    if (!p) return;
    let entries = this.children.get(rel);
    if (!entries) {
      try {
        entries = await p.list(rel);
      } catch (e) {
        container.append(h('div', { class: 'tree-error' }, String(e)));
        return;
      }
      this.children.set(rel, entries);
    }
    for (const e of entries) {
      const isDir = e.type === 'directory';
      const open = isDir && this.expanded.has(e.rel);
      const activeRel = this.activeFile()?.rel;
      const row = h('div', {
        class: `tree-row${e.rel === activeRel ? ' active' : ''}`,
        style: `padding-left:${8 + depth * 12}px`,
        role: 'treeitem',
      },
      isDir ? icon(open ? 'chevron-down' : 'chevron-right', 'twisty') : h('span', { class: 'twisty' }),
      icon(isDir ? (open ? 'folder-opened' : 'folder') : 'file', 'file-icon'),
      h('span', { class: 'tree-label' }, e.name),
      iconButton('ellipsis', 'More actions', (ev) => { ev.stopPropagation(); this.entryMenu(e); }, 'row-more'));
      row.addEventListener('click', () => {
        if (isDir) {
          if (open) this.expanded.delete(e.rel);
          else this.expanded.add(e.rel);
          this.renderSidebar();
        } else void this.openFile(e.rel, true).catch(() => undefined);
      });
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.entryMenu(e);
      });
      let pressTimer: number | undefined;
      row.addEventListener('touchstart', () => { pressTimer = window.setTimeout(() => this.entryMenu(e), 550); }, { passive: true });
      for (const evName of ['touchend', 'touchmove', 'touchcancel']) row.addEventListener(evName, () => clearTimeout(pressTimer), { passive: true });
      container.append(row);
      if (open) {
        const sub = h('div', { class: 'tree-children' });
        container.append(sub);
        await this.renderTreeLevel(sub, e.rel, depth + 1);
      }
    }
  }

  private entryMenu(e: Entry): void {
    const dir = e.type === 'directory' ? e.rel : parentRel(e.rel);
    showQuickPick({
      placeholder: e.rel,
      items: [
        { label: 'New File...', run: () => void this.createEntry('file', dir) },
        { label: 'New Folder...', run: () => void this.createEntry('directory', dir) },
        { label: 'Rename...', run: () => void this.renameEntry(e) },
        { label: 'Delete', run: () => void this.deleteEntry(e) },
      ],
    });
  }

  private async createEntry(type: 'file' | 'directory', dir: string): Promise<void> {
    const p = this.project;
    if (!p) return;
    const name = await promptText(type === 'file' ? `New file in /${dir}` : `New folder in /${dir}`, '', validName);
    if (!name) return;
    const rel = joinRel(dir, name.trim());
    try {
      if (type === 'file') await p.createFile(rel);
      else await p.mkdirp(rel);
    } catch (e) {
      return alertText('Could not create', String(e));
    }
    this.expanded.add(dir);
    this.refreshTree();
    if (type === 'file') await this.openFile(rel, true);
  }

  private async renameEntry(e: Entry): Promise<void> {
    const p = this.project;
    if (!p) return;
    const affected = this.tabs.filter((t): t is FileTab => t.kind === 'file' && (t.rel === e.rel || t.rel.startsWith(`${e.rel}/`)));
    if (affected.some((t) => t.dirty)) return alertText('Save first', 'Save or close the open files inside it before renaming.');
    const name = await promptText(`Rename ${e.name}`, e.name, validName);
    if (!name || name === e.name) return;
    const to = joinRel(parentRel(e.rel), name.trim());
    try {
      await p.rename(e.rel, to);
    } catch (err) {
      return alertText('Rename failed', String(err));
    }
    for (const t of affected) {
      this.tracker.throttle.forget(p.absPath(t.rel));
      t.rel = to + t.rel.slice(e.rel.length);
      t.name = baseName(t.rel);
    }
    this.refreshTree();
    this.persistTabs();
    this.renderTabs();
  }

  private async deleteEntry(e: Entry): Promise<void> {
    const p = this.project;
    if (!p) return;
    const r = await choose(`Delete ${e.name}?`, e.type === 'directory' ? 'The folder and everything in it will be deleted. This cannot be undone.' : 'This cannot be undone.', [
      { id: 'delete', label: 'Delete', primary: true },
      { id: 'cancel', label: 'Cancel' },
    ]);
    if (r !== 'delete') return;
    try {
      await p.remove(e);
    } catch (err) {
      return alertText('Delete failed', String(err));
    }
    const gone = this.tabs.filter((t): t is FileTab => t.kind === 'file' && (t.rel === e.rel || t.rel.startsWith(`${e.rel}/`)));
    for (const t of gone) {
      t.dirty = false;
      await this.closeTab(t);
    }
    this.refreshTree();
  }

  private renderSearch(): void {
    const s = this.lastSearch;
    const input = h('input', { class: 'text-input search-input', placeholder: 'Search', value: s.query, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
    const toggle = (ic: string, title: string, key: 'caseSensitive' | 'wholeWord' | 'regex') => {
      const b = iconButton(ic, title, () => {
        s[key] = !s[key];
        b.classList.toggle('on', s[key]);
      }, `toggle${s[key] ? ' on' : ''}`);
      return b;
    };
    const results = h('div', { class: 'search-results' });
    const run = () => {
      s.query = input.value;
      void this.searchProject(results);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    this.sidebarBody.append(
      h('div', { class: 'sidebar-title' }, h('span', {}, 'SEARCH')),
      h('div', { class: 'search-box' },
        h('div', { class: 'search-row' }, input,
          toggle('case-sensitive', 'Match Case', 'caseSensitive'),
          toggle('whole-word', 'Match Whole Word', 'wholeWord'),
          toggle('regex', 'Use Regular Expression', 'regex')),
        h('button', { class: 'btn', onclick: run }, 'Search')),
      results);
  }

  private async searchProject(out: HTMLElement): Promise<void> {
    const p = this.project;
    const s = this.lastSearch;
    clear(out);
    if (!p || !s.query) return;
    let re: RegExp;
    try {
      const src = s.regex ? s.query : s.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(s.wholeWord ? `\\b(?:${src})\\b` : src, s.caseSensitive ? 'g' : 'gi');
    } catch (e) {
      out.append(h('div', { class: 'tree-error' }, String(e)));
      return;
    }
    const info = h('div', { class: 'search-info' }, 'Searching...');
    out.append(info);
    const files = this.fileIndex ?? (this.fileIndex = await p.walk());
    let total = 0;
    let fileCount = 0;
    for (const f of files) {
      if (f.size > 1024 * 1024 || total >= 2000) continue;
      let text: string;
      const open = this.tabs.find((t): t is FileTab => t.kind === 'file' && t.rel === f.rel);
      try {
        text = open ? (this.active === open ? this.view.state : open.state).doc.toString() : await p.read(f.rel);
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue;
      const lines = text.split('\n');
      const hits: HTMLElement[] = [];
      lines.forEach((line, i) => {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (!m || total >= 2000) return;
        total++;
        const start = Math.max(0, m.index - 30);
        hits.push(h('div', { class: 'search-hit', onclick: () => void this.openFile(f.rel, true, i + 1, m.index + 1) },
          h('span', { class: 'hit-line' }, String(i + 1)),
          h('span', {}, (start > 0 ? '...' : '') + line.slice(start, m.index)),
          h('mark', {}, m[0] || ' '),
          h('span', {}, line.slice(m.index + m[0].length, m.index + m[0].length + 80))));
      });
      if (hits.length) {
        fileCount++;
        out.append(h('div', { class: 'search-file' }, icon('file'), h('span', {}, f.name), h('span', { class: 'qp-desc' }, parentRel(f.rel)), h('span', { class: 'badge' }, String(hits.length))), ...hits);
      }
    }
    info.textContent = total ? `${total} result${total > 1 ? 's' : ''} in ${fileCount} file${fileCount > 1 ? 's' : ''}${total >= 2000 ? ' (limit reached)' : ''}` : 'No results found.';
  }

  // ------------------------------------------------------------- render

  private renderAll(): void {
    this.renderTabs();
    this.renderPage();
    this.renderStatus();
    this.renderActivity();
    if (this.sidebarView === 'explorer') this.markActiveTreeRow();
  }

  private markActiveTreeRow(): void {
    const rel = this.activeFile()?.rel;
    this.sidebarBody.querySelectorAll('.tree-row').forEach((r) => r.classList.remove('active'));
    if (rel) this.renderSidebar();
  }

  private renderTabs(): void {
    clear(this.tabBar);
    for (const t of this.tabs) {
      const isActive = t === this.active;
      const dirty = isDirtyFile(t);
      const close = h('button', { class: `tab-close${dirty ? ' dirty' : ''}`, title: dirty ? 'Unsaved changes. Close' : 'Close', 'aria-label': 'Close' },
        icon(dirty ? 'circle-filled' : 'close'));
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.closeTab(t);
      });
      const el = h('div', { class: `tab${isActive ? ' active' : ''}${dirty ? ' is-dirty' : ''}`, role: 'tab', title: t.kind === 'file' ? t.rel : t.name },
        icon(t.kind === 'file' ? 'file' : t.page === 'settings' ? 'settings-gear' : 'output', 'tab-icon'),
        h('span', { class: 'tab-label' }, t.name),
        close);
      el.addEventListener('click', () => this.activate(t));
      el.addEventListener('auxclick', (e) => { if (e.button === 1) void this.closeTab(t); });
      this.tabBar.append(el);
      if (isActive) setTimeout(() => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 0);
    }
    this.tabBar.hidden = this.tabs.length === 0;
  }

  private renderPage(): void {
    const t = this.active;
    const file = t?.kind === 'file' ? t : null;
    this.editorHost.hidden = !file || !!file.binary;
    this.pageHost.hidden = !t || t.kind !== 'page';
    this.welcome.hidden = !!t && !(file && file.binary);
    clear(this.welcome);
    if (file?.binary) {
      this.welcome.append(h('div', { class: 'welcome-inner' }, h('p', {}, 'This file is binary or too large to open in the editor.')));
    } else if (!t) {
      this.renderWelcome();
    }
    if (t?.kind === 'page') {
      clear(this.pageHost);
      if (t.page === 'settings') renderSettings(this.pageHost, this);
      else void renderTrackingLog(this.pageHost, this);
    }
    this.updateKeyboardBar();
  }

  private renderWelcome(): void {
    const link = (label: string, run: () => void) => h('button', { class: 'link', onclick: run }, label);
    this.welcome.append(h('div', { class: 'welcome-inner' },
      h('h1', {}, 'Hackatime Editor'),
      h('p', { class: 'muted' }, 'Coding time goes to Hackatime through the official wakatime-cli, and nothing else.'),
      h('h3', {}, 'Start'),
      link('Open File...', () => this.quickOpen()),
      link('New File...', () => void this.createEntry('file', '')),
      link('Open Folder...', () => void this.pickProject()),
      h('h3', {}, 'Hackatime'),
      link('Settings and API key', () => this.openPage('settings')),
      link('Tracking Log', () => this.openPage('log'))));
  }

  renderTrackingStatus(): void {
    const s = this.trackingState;
    const el = this.status.tracking;
    clear(el);
    if (s.on) {
      const when = s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'ready';
      el.append(icon('pulse'), h('span', {}, `Hackatime: ${when}`));
      el.title = s.lastOkAt ? `Last heartbeat accepted by wakatime-cli at ${new Date(s.lastOkAt).toLocaleString()}${s.cliLastSentAt ? `. CLI last synced to the server at ${s.cliLastSentAt}` : ''}` : 'Tracking on. No heartbeat sent yet.';
      el.classList.remove('off');
    } else {
      el.append(icon('warning'), h('span', {}, `Hackatime: tracking off (${s.reason})`));
      el.title = s.detail ?? s.reason;
      el.classList.add('off');
    }
    if (this.active?.kind === 'page' && this.active.page === 'settings') this.renderPage();
  }

  private renderStatus(): void {
    const t = this.activeFile();
    this.statusBar.classList.toggle('no-folder', !this.project);
    this.status.project.textContent = this.project ? this.project.name : 'No folder';
    this.status.project.prepend(icon('folder'));
    const show = !!t && !t.binary;
    for (const k of ['pos', 'indent', 'encoding', 'language'] as const) this.status[k].hidden = !show;
    if (!t || !show) return;
    const state = this.view.state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const sel = state.selection.ranges.length;
    this.status.pos.textContent = `Ln ${line.number}, Col ${head - line.from + 1}${sel > 1 ? ` (${sel} selections)` : ''}`;
    this.status.indent.textContent = `Spaces: ${this.prefs.tabSize}`;
    this.status.encoding.textContent = 'UTF-8';
    this.status.language.textContent = t.lang.id === 'tsx' ? 'TypeScript JSX' : t.lang.name;
  }

  // ------------------------------------------------------------- prefs

  async setPrefs(p: Partial<EditorPrefs>): Promise<void> {
    this.prefs = { ...this.prefs, ...p };
    await Preferences.set({ key: 'prefs', value: JSON.stringify(this.prefs) });
    const effects = [
      wrapConf.reconfigure(this.prefs.softWrap ? EditorView.lineWrapping : []),
      fontConf.reconfigure(fontTheme(this.prefs.fontSize)),
      tabConf.reconfigure(tabExtensions(this.prefs.tabSize)),
    ];
    for (const t of this.tabs) {
      if (t.kind !== 'file') continue;
      if (t === this.active) this.view.dispatch({ effects });
      else t.state = t.state.update({ effects }).state;
    }
    document.documentElement.style.setProperty('--editor-font-size', `${this.prefs.fontSize}px`);
    this.renderStatus();
    if (this.active?.kind === 'page' && this.active.page === 'settings') this.renderPage();
  }

  // ------------------------------------------------------- keyboard bar

  private keyboardBar(): HTMLElement {
    const bar = h('div', { class: 'kbbar', role: 'toolbar', 'aria-label': 'Editing keys' });
    const key = (label: HTMLElement | string, title: string, run: () => void) => {
      const b = h('button', { class: 'kb-key', title, 'aria-label': title }, label);
      // pointerdown + preventDefault keeps focus (and the keyboard) in the editor.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.tracker.throttle.noteUserInput();
        run();
      });
      bar.append(b);
    };
    const ins = (s: string) => () => insertText(this.view, s);
    const cmd = (fn: (v: EditorView) => boolean) => () => { fn(this.view); this.view.focus(); };
    key('Tab', 'Tab', () => insertText(this.view, ' '.repeat(this.prefs.tabSize)));
    for (const ch of ['(', ')', '{', '}', '[', ']', '<', '>', '"', "'", '`', ';', '=', ':', '/']) key(ch, `Insert ${ch}`, ins(ch));
    key(icon('arrow-left'), 'Left', cmd(cursorCharLeft));
    key(icon('arrow-up'), 'Up', cmd(cursorLineUp));
    key(icon('arrow-down'), 'Down', cmd(cursorLineDown));
    key(icon('arrow-right'), 'Right', cmd(cursorCharRight));
    key(icon('discard'), 'Undo', cmd(undo));
    key(icon('redo'), 'Redo', cmd(redo));
    key(icon('save'), 'Save', () => void this.saveActive());
    return bar;
  }

  private updateKeyboardBar(): void {
    const editing = !!this.activeFile() && !this.activeFile()!.binary && this.view.hasFocus;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    this.kbBar.classList.toggle('show', editing && touch);
  }
}

function isDirtyFile(t: Tab | null): t is FileTab {
  return !!t && t.kind === 'file' && t.dirty;
}
