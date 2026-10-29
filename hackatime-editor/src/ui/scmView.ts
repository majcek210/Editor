import { h, icon, iconButton, clear } from './dom';
import { alertText, choose, promptText, toast } from './dialogs';
import { showQuickPick, type QuickItem } from './palette';
import { Git, errText, type GitFileChange, type GitStatus } from '../native/git';

/** What the Source Control view needs from the app. */
export interface ScmHost {
  projectDir(): string | null;
  openFile(rel: string): void;
  /** Re-reads open, unmodified tabs and the file tree after Git changed files. */
  filesChangedOnDisk(): Promise<void>;
  renderScm(): void;
  isScmVisible(): boolean;
  openSettings(): void;
}

const KIND_LETTER: Record<GitFileChange['kind'], string> = { added: 'A', modified: 'M', deleted: 'D', untracked: 'U' };

/** VS Code-like Source Control: changes, staging, commit, push, pull, branches. */
export class ScmController {
  status: GitStatus | null = null;
  busy: string | null = null;
  private message = '';
  private refreshing: Promise<void> | null = null;

  constructor(private readonly host: ScmHost, private readonly statusItem: HTMLElement, private readonly syncItem: HTMLElement) {
    statusItem.addEventListener('click', () => void this.pickBranch());
    syncItem.addEventListener('click', () => void this.sync());
    this.renderStatusItems();
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const dir = this.host.projectDir();
    this.refreshing = (async () => {
      try {
        this.status = dir ? await Git.status({ dir }) : null;
      } catch {
        this.status = null;
      } finally {
        this.refreshing = null;
      }
      this.renderStatusItems();
      if (this.host.isScmVisible()) this.host.renderScm();
    })();
    return this.refreshing;
  }

  private renderStatusItems(): void {
    const s = this.status;
    const repo = !!s?.repo;
    this.statusItem.hidden = !repo;
    this.syncItem.hidden = !repo || !s?.remote;
    if (!repo || !s) return;
    clear(this.statusItem);
    this.statusItem.append(icon('git-branch'), h('span', {}, `${s.branch ?? '?'}${dirtyCount(s) ? '*' : ''}`));
    clear(this.syncItem);
    this.syncItem.append(icon(this.busy ? 'sync codicon-modifier-spin' : 'sync'), h('span', {}, `${s.behind ?? 0}↓ ${s.ahead ?? 0}↑`));
    this.syncItem.title = s.upstream ? `Synchronize with ${s.upstream} (pull, then push)` : 'Publish branch to origin';
  }

  /** Runs one Git operation with a busy indicator and real error text on failure. */
  private async op<T>(label: string, fn: (dir: string) => Promise<T>, changesFiles = false): Promise<T | undefined> {
    const dir = this.host.projectDir();
    if (!dir) return undefined;
    if (this.busy) {
      toast(`Git is busy: ${this.busy}`);
      return undefined;
    }
    this.busy = label;
    this.renderStatusItems();
    if (this.host.isScmVisible()) this.host.renderScm();
    try {
      return await fn(dir);
    } catch (e) {
      await alertText(`Git: ${label} failed`, errText(e));
      return undefined;
    } finally {
      this.busy = null;
      if (changesFiles) await this.host.filesChangedOnDisk();
      await this.refresh();
    }
  }

  // ------------------------------------------------------------- actions

  init = () => this.op('init', (dir) => Git.init({ dir }));
  stage = (paths: string[]) => this.op('stage', (dir) => Git.stage({ dir, paths }));
  stageAll = () => this.op('stage all', (dir) => Git.stageAll({ dir }));
  unstage = (paths: string[]) => this.op('unstage', (dir) => Git.unstage({ dir, paths }));

  async discard(paths: string[]): Promise<void> {
    const r = await choose(`Discard changes in ${paths.length === 1 ? paths[0] : `${paths.length} files`}?`,
      'This cannot be undone. Untracked files are deleted.', [
        { id: 'discard', label: 'Discard', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ]);
    if (r === 'discard') await this.op('discard', (dir) => Git.discard({ dir, paths }), true);
  }

  async commit(): Promise<void> {
    const s = this.status;
    if (!s?.repo) return;
    const message = this.message.trim() || (await promptText('Commit message', '')) || '';
    if (!message.trim()) return;
    const cfg = await Git.getConfig().catch(() => null);
    if (!cfg?.name || !cfg.email) {
      await alertText('Set your Git identity', 'Add your name and email under Settings, Git, before committing.');
      this.host.openSettings();
      return;
    }
    if (!s.staged?.length) {
      if (!s.unstaged?.length) return toast('Nothing to commit');
      const r = await choose('There are no staged changes', 'Stage all changes and commit them?', [
        { id: 'yes', label: 'Stage All and Commit', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ]);
      if (r !== 'yes') return;
      await this.stageAll();
    }
    const res = await this.op('commit', (dir) => Git.commit({ dir, message }));
    if (res) {
      this.message = '';
      toast(`Committed ${res.id.slice(0, 7)}`);
    }
  }

  async push(): Promise<void> {
    if (!this.status?.remote && !(await this.addRemote())) return;
    const r = await this.op('push', (dir) => Git.push({ dir }));
    if (r) toast(r.message);
  }

  async pull(): Promise<void> {
    const r = await this.op('pull', (dir) => Git.pull({ dir }), true);
    if (r) toast(r.message);
  }

  async sync(): Promise<void> {
    if (!this.status?.remote) return void this.push();
    if (this.status.upstream) {
      const r = await this.op('pull', (dir) => Git.pull({ dir }), true);
      if (!r) return;
      if (this.status?.conflicts?.length) return void alertText('Merge conflicts', r.message);
    }
    if ((this.status?.ahead ?? 0) > 0 || !this.status?.upstream) await this.push();
    else toast('Up to date');
  }

  async addRemote(): Promise<boolean> {
    const url = await promptText('Remote URL (origin)', 'https://github.com/', (v) =>
      /^https:\/\/[^/\s@]+\/\S+$/.test(v.trim()) ? null : 'Use an https:// URL without credentials');
    if (!url) return false;
    await this.op('add remote', (dir) => Git.setRemote({ dir, url: url.trim() }));
    return true;
  }

  async pickBranch(): Promise<void> {
    const dir = this.host.projectDir();
    if (!dir || !this.status?.repo) return;
    let b: { local: string[]; remote: string[] };
    try {
      b = await Git.branches({ dir });
    } catch (e) {
      return alertText('Git: branches failed', errText(e));
    }
    const current = this.status.branch;
    const items: QuickItem[] = [
      { label: '+ Create new branch...', run: () => void this.createBranch() },
      ...b.local.map((name) => ({ label: name, description: name === current ? 'current' : 'local', run: () => void this.checkout(name) })),
      ...b.remote
        .filter((r) => !b.local.includes(r.slice(r.indexOf('/') + 1)))
        .map((name) => ({ label: name, description: 'remote', run: () => void this.checkout(name) })),
    ];
    showQuickPick({ placeholder: 'Select a branch to check out', items, matchOn: 'description' });
  }

  private async createBranch(): Promise<void> {
    const name = await promptText('New branch name', '', (v) => (/^[A-Za-z0-9._/-]+$/.test(v.trim()) && !v.includes('..') ? null : 'Invalid branch name'));
    if (name) await this.op('create branch', (dir) => Git.checkout({ dir, name: name.trim(), create: true }), true);
  }

  private async checkout(name: string): Promise<void> {
    if (name === this.status?.branch) return;
    await this.op(`checkout ${name}`, (dir) => Git.checkout({ dir, name }), true);
  }

  async showLog(): Promise<void> {
    const dir = this.host.projectDir();
    if (!dir) return;
    try {
      const { commits } = await Git.log({ dir, max: 100 });
      showQuickPick({
        placeholder: commits.length ? 'Recent commits' : 'No commits yet',
        items: commits.map((c) => ({
          label: c.message.split('\n')[0],
          description: `${c.id.slice(0, 7)} ${c.author}`,
          detail: new Date(c.time).toLocaleDateString(),
          run: () => undefined,
        })),
        matchOn: 'description',
      });
    } catch (e) {
      await alertText('Git: log failed', errText(e));
    }
  }

  // -------------------------------------------------------------- view

  render(container: HTMLElement): void {
    const s = this.status;
    const header = h('div', { class: 'sidebar-title' }, h('span', { class: 'grow' }, 'SOURCE CONTROL'),
      s?.repo ? h('div', { class: 'section-actions' },
        iconButton('check', 'Commit', () => void this.commit()),
        iconButton('refresh', 'Refresh', () => void this.refresh()),
        iconButton('arrow-down', 'Pull', () => void this.pull()),
        iconButton('arrow-up', 'Push', () => void this.push()),
        iconButton('history', 'Commit Log', () => void this.showLog())) : null);
    container.append(header);
    if (!this.host.projectDir()) {
      container.append(h('div', { class: 'scm-empty' }, 'Open a folder first.'));
      return;
    }
    if (!s?.repo) {
      container.append(h('div', { class: 'scm-empty' },
        h('p', {}, 'The open folder is not a Git repository.'),
        h('button', { class: 'btn wide-btn', onclick: () => void this.init() }, 'Initialize Repository'),
        h('p', {}, 'Or clone a repository into a new project folder:'),
        h('button', { class: 'btn wide-btn', onclick: () => document.dispatchEvent(new CustomEvent('git-clone')) }, 'Clone Repository')));
      return;
    }
    if (this.busy) container.append(h('div', { class: 'scm-busy' }, icon('loading', 'codicon-modifier-spin'), ` ${this.busy}...`));

    const msg = h('textarea', { class: 'text-input commit-msg', rows: 2, placeholder: `Message (commit on "${s.branch ?? ''}")`, spellcheck: 'true' });
    msg.value = this.message;
    msg.addEventListener('input', () => { this.message = msg.value; });
    container.append(h('div', { class: 'commit-box' }, msg,
      h('button', { class: 'btn wide-btn', disabled: !!this.busy, onclick: () => void this.commit() }, icon('check'), ' Commit'),
      s.remote
        ? h('button', { class: 'btn secondary wide-btn', disabled: !!this.busy, onclick: () => void this.sync() }, icon('sync'), ` Sync Changes ${s.behind ?? 0}↓ ${s.ahead ?? 0}↑`)
        : h('button', { class: 'btn secondary wide-btn', onclick: () => void this.push() }, icon('cloud-upload'), ' Publish (add remote)')));

    if (s.conflicts?.length) {
      container.append(this.section('Merge Conflicts', s.conflicts.map((p) => ({ path: p, kind: 'modified' as const })), 'conflict'));
    }
    container.append(this.section('Staged Changes', s.staged ?? [], 'staged'));
    container.append(this.section('Changes', s.unstaged ?? [], 'unstaged'));
    if (!s.staged?.length && !s.unstaged?.length && !s.conflicts?.length) {
      container.append(h('div', { class: 'scm-empty' }, 'No changes.'));
    }
  }

  private section(title: string, files: GitFileChange[], mode: 'staged' | 'unstaged' | 'conflict'): HTMLElement {
    const sec = h('div', { class: 'scm-section' });
    if (!files.length) return sec;
    const actions = h('div', { class: 'section-actions' });
    if (mode === 'staged') actions.append(iconButton('remove', 'Unstage All', () => void this.unstage(files.map((f) => f.path))));
    if (mode === 'unstaged') {
      actions.append(iconButton('discard', 'Discard All Changes', () => void this.discard(files.map((f) => f.path))));
      actions.append(iconButton('add', 'Stage All Changes', () => void this.stageAll()));
    }
    sec.append(h('div', { class: 'section-header' }, icon('chevron-down'), h('span', { class: 'section-name' }, title.toUpperCase()), h('span', { class: 'badge' }, String(files.length)), actions));
    for (const f of files) {
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      const row = h('div', { class: 'tree-row scm-row', title: f.path },
        icon('file', 'file-icon'),
        h('span', { class: `tree-label${f.kind === 'deleted' ? ' strike' : ''}` }, name, dir ? h('span', { class: 'qp-desc' }, ` ${dir}`) : null),
        mode === 'unstaged' ? iconButton('discard', 'Discard Changes', (e) => { e.stopPropagation(); void this.discard([f.path]); }, 'row-act') : null,
        mode === 'staged'
          ? iconButton('remove', 'Unstage', (e) => { e.stopPropagation(); void this.unstage([f.path]); }, 'row-act')
          : iconButton('add', 'Stage', (e) => { e.stopPropagation(); void this.stage([f.path]); }, 'row-act'),
        h('span', { class: `scm-kind kind-${f.kind}` }, mode === 'conflict' ? '!' : KIND_LETTER[f.kind]));
      row.addEventListener('click', () => { if (f.kind !== 'deleted') this.host.openFile(f.path); });
      sec.append(row);
    }
    return sec;
  }
}

function dirtyCount(s: GitStatus): number {
  return (s.staged?.length ?? 0) + (s.unstaged?.length ?? 0);
}
