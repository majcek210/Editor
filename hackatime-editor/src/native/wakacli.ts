import { registerPlugin } from '@capacitor/core';

/** Static facts about the bundled CLI, reported by the native plugin. */
export interface CliInfo {
  /** True only when the binary exists in nativeLibraryDir and is executable. */
  available: boolean;
  /** Why the CLI is unavailable, when it is. */
  reason?: string;
  binaryPath?: string;
  abi?: string;
  cliVersion?: string;
  /** Whether the bundled binary was built with cgo (Android DNS resolver). */
  cgo?: boolean;
  appVersion: string;
  hasApiKey: boolean;
  apiUrl: string;
  /** Absolute path of the file used by "Test tracking". */
  testEntity: string;
}

/** One CLI run, exactly as recorded by the native plugin (already redacted). */
export interface Invocation {
  id: number;
  timestamp: string;
  reason: string;
  args: string[];
  /** null when the process did not start or was killed by the timeout. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

export interface CliStatus {
  /** internal.heartbeats_last_sent_at from the CLI's own internal config. */
  lastSentAt?: string;
  backoffAt?: string;
  backoffRetries?: number;
}

export interface WakaCliPlugin {
  getInfo(): Promise<CliInfo>;
  setApiKey(options: { apiKey: string }): Promise<void>;
  clearApiKey(): Promise<void>;
  /** Runs wakatime-cli once with these heartbeat arguments. */
  heartbeat(options: { args: string[]; reason: string }): Promise<Invocation>;
  /** Read-only view of the invocation log, newest first. */
  getLog(options?: { limit?: number }): Promise<{ entries: Invocation[] }>;
  getStatus(): Promise<CliStatus>;
}

export const WakaCli = registerPlugin<WakaCliPlugin>('WakaCli');
