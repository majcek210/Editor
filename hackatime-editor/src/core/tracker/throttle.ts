/**
 * Decides whether a user activity event may produce a heartbeat.
 *
 * Rules (see README, "How tracking works"):
 * - Heartbeats only come from real user activity: opening a file the user
 *   tapped, typing, or saving. This module never schedules timers.
 * - Edits and opens: at most one heartbeat per 30 seconds per file.
 * - Saves: always one heartbeat with the write flag.
 * - Nothing while the app is in the background.
 * - Nothing when there has been no user input for 2 minutes.
 */
export const EDIT_THROTTLE_MS = 30_000;
export const IDLE_LIMIT_MS = 120_000;

export type ActivityKind = 'open' | 'edit' | 'save';

export interface Decision {
  send: boolean;
  write: boolean;
  reason: string;
}

export class ActivityThrottle {
  private readonly lastSent = new Map<string, number>();
  private lastInputAt = Number.NEGATIVE_INFINITY;
  private foreground = true;

  constructor(private readonly now: () => number = Date.now) {}

  /** Call from real DOM input events only (key, pointer, text input). */
  noteUserInput(): void {
    this.lastInputAt = this.now();
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground;
  }

  isForeground(): boolean {
    return this.foreground;
  }

  isIdle(): boolean {
    return this.now() - this.lastInputAt > IDLE_LIMIT_MS;
  }

  decide(kind: ActivityKind, entity: string): Decision {
    if (!this.foreground) return { send: false, write: false, reason: 'app is in the background' };
    if (this.isIdle()) return { send: false, write: false, reason: 'no user input in the last 2 minutes' };

    const t = this.now();
    if (kind === 'save') {
      this.lastSent.set(entity, t);
      return { send: true, write: true, reason: 'file saved' };
    }

    const last = this.lastSent.get(entity);
    if (last !== undefined && t - last < EDIT_THROTTLE_MS) {
      return { send: false, write: false, reason: 'throttled (30 s per file)' };
    }
    this.lastSent.set(entity, t);
    return { send: true, write: false, reason: kind === 'open' ? 'file opened' : 'file edited' };
  }

  /** Forget a file, for example after it was renamed or deleted. */
  forget(entity: string): void {
    this.lastSent.delete(entity);
  }
}
