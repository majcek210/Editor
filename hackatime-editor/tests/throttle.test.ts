import { describe, expect, it } from 'vitest';
import { ActivityThrottle, EDIT_THROTTLE_MS, IDLE_LIMIT_MS } from '../src/core/tracker/throttle';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('ActivityThrottle', () => {
  it('allows the first edit of a file and throttles the next 30 s', () => {
    const c = clock();
    const th = new ActivityThrottle(c.now);
    th.noteUserInput();
    expect(th.decide('edit', '/a.ts').send).toBe(true);
    c.advance(1_000); th.noteUserInput();
    expect(th.decide('edit', '/a.ts').send).toBe(false);
    c.advance(EDIT_THROTTLE_MS - 1_001); th.noteUserInput();
    expect(th.decide('edit', '/a.ts').send).toBe(false);
    c.advance(1); th.noteUserInput();
    expect(th.decide('edit', '/a.ts').send).toBe(true);
  });

  it('sends at most one edit heartbeat per 30 s per file under constant typing', () => {
    const c = clock();
    const th = new ActivityThrottle(c.now);
    let sent = 0;
    for (let i = 0; i < 600; i++) { // 10 minutes, one keystroke per second
      th.noteUserInput();
      if (th.decide('edit', '/a.ts').send) sent++;
      c.advance(1_000);
    }
    expect(sent).toBe(20);
  });

  it('throttles each file independently', () => {
    const c = clock();
    const th = new ActivityThrottle(c.now);
    th.noteUserInput();
    expect(th.decide('edit', '/a.ts').send).toBe(true);
    expect(th.decide('edit', '/b.ts').send).toBe(true);
    expect(th.decide('edit', '/a.ts').send).toBe(false);
    expect(th.decide('open', '/b.ts').send).toBe(false);
  });

  it('always sends one heartbeat with write set on save', () => {
    const c = clock();
    const th = new ActivityThrottle(c.now);
    th.noteUserInput();
    expect(th.decide('edit', '/a.ts')).toMatchObject({ send: true, write: false });
    const s = th.decide('save', '/a.ts');
    expect(s).toMatchObject({ send: true, write: true });
    expect(th.decide('edit', '/a.ts').send).toBe(false);
  });

  it('sends nothing while backgrounded, including saves', () => {
    const c = clock();
    const th = new ActivityThrottle(c.now);
    th.noteUserInput();
    th.setForeground(false);
    expect(th.decide('open', '/a.ts').send).toBe(false);
    expect(th.decide('edit', '/a.ts').send).toBe(false);
    expect(th.decide('save', '/a.ts').send).toBe(false);
    th.setForeground(true);
    expect(th.decide('edit', '/a.ts').send).toBe(true);
  });

  it('sends nothing after 2 minutes without user input', () => {
    const c = clock();
    const th = new ActivityThrottle(c.now);
    th.noteUserInput();
    c.advance(IDLE_LIMIT_MS + 1);
    expect(th.isIdle()).toBe(true);
    expect(th.decide('edit', '/a.ts').send).toBe(false);
    expect(th.decide('save', '/a.ts').send).toBe(false);
    th.noteUserInput();
    expect(th.decide('edit', '/a.ts').send).toBe(true);
  });

  it('sends nothing before any user input at all', () => {
    const th = new ActivityThrottle(clock().now);
    expect(th.decide('open', '/a.ts').send).toBe(false);
  });
});
