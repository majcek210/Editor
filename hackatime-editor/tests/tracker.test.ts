import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tracker } from '../src/core/tracker/tracker';
import type { CliInfo, Invocation, WakaCliPlugin } from '../src/native/wakacli';

function fakeCli(exitCode = 0) {
  const calls: { args: string[]; reason: string }[] = [];
  const info: CliInfo = {
    available: true, appVersion: '0.1.0', hasApiKey: true, cgo: true,
    apiUrl: 'https://hackatime.hackclub.com/api/hackatime/v1', testEntity: '/data/files/test.txt',
  };
  const cli: WakaCliPlugin = {
    getInfo: async () => info,
    setApiKey: async () => {},
    clearApiKey: async () => {},
    heartbeat: async (o) => {
      calls.push(o);
      const inv: Invocation = { id: calls.length, timestamp: '', reason: o.reason, args: o.args, exitCode, stdout: '', stderr: '', durationMs: 1 };
      return inv;
    },
    getLog: async () => ({ entries: [] }),
    getStatus: async () => ({}),
  };
  return { cli, calls, info };
}

function memStore(verified = true) {
  const m = new Map<string, string>(verified ? [['tracking.verified', 'yes']] : []);
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
}

describe('Tracker', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('never sends anything on its own, with no activity for 10 minutes', async () => {
    const f = fakeCli();
    const t = new Tracker(f.cli, memStore());
    await t.init();
    t.throttle.noteUserInput();
    await t.record('open', { path: '/p/a.ts' });
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(f.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends at most one edit heartbeat per 30 s per file', async () => {
    const f = fakeCli();
    const t = new Tracker(f.cli, memStore());
    await t.init();
    for (let i = 0; i < 90; i++) {
      t.throttle.noteUserInput();
      await t.record('edit', { path: '/p/a.ts' });
      vi.setSystemTime(Date.now() + 1_000);
    }
    expect(f.calls).toHaveLength(3);
  });

  it('sends a write heartbeat on save', async () => {
    const f = fakeCli();
    const t = new Tracker(f.cli, memStore());
    await t.init();
    t.throttle.noteUserInput();
    await t.record('edit', { path: '/p/a.ts' });
    await t.record('save', { path: '/p/a.ts' });
    expect(f.calls[1].args).toContain('--write');
    expect(f.calls[0].args).not.toContain('--write');
  });

  it('sends nothing while backgrounded or idle', async () => {
    const f = fakeCli();
    const t = new Tracker(f.cli, memStore());
    await t.init();
    t.throttle.noteUserInput();
    t.throttle.setForeground(false);
    await t.record('save', { path: '/p/a.ts' });
    t.throttle.setForeground(true);
    vi.setSystemTime(Date.now() + 121_000);
    await t.record('save', { path: '/p/a.ts' });
    expect(f.calls).toHaveLength(0);
  });

  it('stays off until Test tracking succeeds', async () => {
    const f = fakeCli();
    const t = new Tracker(f.cli, memStore(false));
    await t.init();
    expect(t.getState().on).toBe(false);
    t.throttle.noteUserInput();
    await t.record('edit', { path: '/p/a.ts' });
    expect(f.calls).toHaveLength(0);
    await t.runTest();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].reason).toBe('test');
    expect(t.getState().on).toBe(true);
  });

  it('turns tracking off with the error when the CLI fails, and does not retry', async () => {
    const f = fakeCli(102);
    const t = new Tracker(f.cli, memStore());
    await t.init();
    t.throttle.noteUserInput();
    await t.record('edit', { path: '/p/a.ts' });
    const s = t.getState();
    expect(s.on).toBe(false);
    if (!s.on) expect(s.reason).toContain('exit 102');
    vi.setSystemTime(Date.now() + 60_000);
    t.throttle.noteUserInput();
    await t.record('edit', { path: '/p/a.ts' });
    expect(f.calls).toHaveLength(1);
  });

  it('is off when the CLI is not available', async () => {
    const f = fakeCli();
    f.info.available = false;
    f.info.reason = 'libwakatime.so missing';
    const t = new Tracker(f.cli, memStore());
    const s = await t.init();
    expect(s).toMatchObject({ on: false, reason: 'wakatime-cli not available' });
  });

  it('is off when the native plugin itself is missing (web build)', async () => {
    const f = fakeCli();
    f.cli.getInfo = async () => { throw new Error('not implemented on web'); };
    const t = new Tracker(f.cli, memStore());
    expect((await t.init()).on).toBe(false);
  });
});
