/**
 * The Hackatime tracker. This is a core module, not a plugin.
 *
 * Every heartbeat goes through the native WakaCli plugin, which runs the
 * bundled wakatime-cli. There is no other network path. When the CLI is
 * missing, has no key, has not passed "Test tracking", or a run fails,
 * tracking is off and the state says why.
 */
import { ActivityThrottle, type ActivityKind } from './throttle';
import { buildHeartbeatArgs, pluginString } from './cliArgs';
import type { CliInfo, CliStatus, Invocation, WakaCliPlugin } from '../../native/wakacli';

export type TrackingState =
  | { on: false; reason: string; detail?: string }
  | { on: true; lastOkAt?: number; cliLastSentAt?: string };

export interface FileActivity {
  path: string;
  project?: string;
  language?: string;
  line?: number;
  column?: number;
  lines?: number;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const VERIFIED_KEY = 'tracking.verified';

export class Tracker {
  readonly throttle: ActivityThrottle;
  private info: CliInfo | null = null;
  private state: TrackingState = { on: false, reason: 'starting' };
  private listeners = new Set<(s: TrackingState) => void>();
  private inFlight = false;

  constructor(
    private readonly cli: WakaCliPlugin,
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {
    this.throttle = new ActivityThrottle(now);
  }

  getState(): TrackingState {
    return this.state;
  }

  getInfo(): CliInfo | null {
    return this.info;
  }

  onChange(fn: (s: TrackingState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(s: TrackingState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Reads CLI info and decides the initial state. Never sends a heartbeat. */
  async init(): Promise<TrackingState> {
    try {
      this.info = await this.cli.getInfo();
    } catch (e) {
      this.info = null;
      this.set({ on: false, reason: 'native CLI plugin not available', detail: errText(e) });
      return this.state;
    }
    const pre = this.precondition();
    if (pre) {
      this.set(pre);
      return this.state;
    }
    if ((await this.store.get(VERIFIED_KEY)) !== 'yes') {
      this.set({ on: false, reason: 'run "Test tracking" in Settings' });
      return this.state;
    }
    this.set({ on: true });
    return this.state;
  }

  needsFirstTest(): boolean {
    return !!this.info?.available && !!this.info.hasApiKey && !this.state.on && this.state.reason.startsWith('run "Test tracking"');
  }

  private precondition(): TrackingState | null {
    if (!this.info) return { on: false, reason: 'native CLI plugin not available' };
    if (!this.info.available) return { on: false, reason: 'wakatime-cli not available', detail: this.info.reason };
    if (!this.info.hasApiKey) return { on: false, reason: 'no API key set' };
    return null;
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.cli.setApiKey({ apiKey: apiKey.trim() });
    await this.store.set(VERIFIED_KEY, 'no');
    await this.init();
  }

  async clearApiKey(): Promise<void> {
    await this.cli.clearApiKey();
    await this.store.set(VERIFIED_KEY, 'no');
    await this.init();
  }

  /**
   * Sends one heartbeat for the test file through the CLI. Tracking turns on
   * only when the CLI exits 0. On failure the real output is returned and
   * tracking stays off.
   */
  async runTest(): Promise<Invocation | { error: string }> {
    this.info = await this.cli.getInfo().catch(() => this.info);
    const pre = this.precondition();
    if (pre) {
      this.set(pre);
      return { error: pre.on ? '' : `${pre.reason}${pre.detail ? `: ${pre.detail}` : ''}` };
    }
    const args = buildHeartbeatArgs({
      entity: this.info!.testEntity,
      write: true,
      plugin: pluginString(this.info!.appVersion),
      project: 'hackatime-editor-test',
      language: 'Text',
    });
    const inv = await this.invoke(args, 'test');
    if (inv.exitCode === 0) {
      await this.store.set(VERIFIED_KEY, 'yes');
      this.set({ on: true, lastOkAt: this.now(), cliLastSentAt: await this.lastSentAt() });
    } else {
      await this.store.set(VERIFIED_KEY, 'no');
      this.set({ on: false, reason: 'test failed', detail: describeFailure(inv) });
    }
    return inv;
  }

  /**
   * Records a user activity. Returns the invocation if one was made.
   * Callers pass only real user actions: a file the user tapped, a user edit,
   * or a user save.
   */
  async record(kind: ActivityKind, file: FileActivity): Promise<Invocation | null> {
    if (!this.state.on || !this.info) return null;
    const d = this.throttle.decide(kind, file.path);
    if (!d.send) return null;
    if (this.inFlight && !d.write) return null;

    const args = buildHeartbeatArgs({
      entity: file.path,
      write: d.write,
      plugin: pluginString(this.info.appVersion),
      project: file.project,
      language: file.language,
      lineno: file.line,
      cursorpos: file.column,
      linesInFile: file.lines,
    });
    const inv = await this.invoke(args, kind);
    if (inv.exitCode === 0) {
      this.set({ on: true, lastOkAt: this.now(), cliLastSentAt: await this.lastSentAt() });
    } else {
      // Never degrade silently: a failed run turns tracking off with the
      // CLI's own error. The CLI keeps whatever it queued offline.
      await this.store.set(VERIFIED_KEY, 'no');
      this.set({ on: false, reason: `CLI failed (${exitLabel(inv)})`, detail: describeFailure(inv) });
    }
    return inv;
  }

  private async invoke(args: string[], reason: string): Promise<Invocation> {
    this.inFlight = true;
    try {
      return await this.cli.heartbeat({ args, reason });
    } catch (e) {
      return {
        id: -1,
        timestamp: new Date(this.now()).toISOString(),
        reason,
        args,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: errText(e),
      };
    } finally {
      this.inFlight = false;
    }
  }

  private async lastSentAt(): Promise<string | undefined> {
    try {
      const s: CliStatus = await this.cli.getStatus();
      return s.lastSentAt;
    } catch {
      return undefined;
    }
  }
}

export function exitLabel(inv: Invocation): string {
  if (inv.exitCode === null) return inv.error ? 'did not run' : 'timed out';
  return `exit ${inv.exitCode}`;
}

/** Known wakatime-cli exit codes, from pkg/exitcode/exitcode.go. */
export function exitMeaning(code: number | null): string {
  switch (code) {
    case 0: return 'success';
    case 1: return 'generic error';
    case 102: return 'API or network error; the CLI queued the heartbeat offline';
    case 103: return 'config file parse error';
    case 104: return 'invalid API key';
    case 112: return 'CLI is backing off after an earlier failure; heartbeat queued offline';
    case null: return 'process did not finish';
    default: return 'unknown exit code';
  }
}

export function describeFailure(inv: Invocation): string {
  const parts = [`${exitLabel(inv)}: ${exitMeaning(inv.exitCode)}`];
  if (inv.error) parts.push(inv.error);
  const out = (inv.stderr || inv.stdout).trim();
  if (out) parts.push(extractMessage(out));
  return parts.join('\n');
}

/** wakatime-cli logs JSON lines when --log-to-stdout is set; show the message. */
function extractMessage(out: string): string {
  const msgs: string[] = [];
  for (const line of out.split('\n')) {
    try {
      const j = JSON.parse(line) as { level?: string; message?: string };
      if (j.message) msgs.push(`${j.level ?? 'log'}: ${j.message}`);
    } catch {
      if (line.trim()) msgs.push(line.trim());
    }
  }
  return msgs.join('\n');
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
