/**
 * Builds the wakatime-cli arguments for one heartbeat.
 * Flag names come from wakatime-cli v2.28.0 cmd/root.go (see NOTES.md).
 *
 * The API key and API URL are never passed as arguments. They live in the
 * config file that the native plugin writes and passes with --config, so the
 * key does not appear in the process list.
 */
export const APP_NAME = 'hackatime-editor';

export interface HeartbeatInput {
  /** Absolute path of the file. */
  entity: string;
  write: boolean;
  /** For example "hackatime-editor/0.1.0". */
  plugin: string;
  project?: string;
  language?: string;
  category?: string;
  /** 1-based line number of the cursor. */
  lineno?: number;
  /** 1-based column of the cursor. */
  cursorpos?: number;
  linesInFile?: number;
}

const PLUGIN_RE = /^hackatime-editor\/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function pluginString(version: string): string {
  return `${APP_NAME}/${version}`;
}

export function buildHeartbeatArgs(h: HeartbeatInput): string[] {
  if (!h.entity.startsWith('/')) throw new Error(`entity must be an absolute path: ${h.entity}`);
  if (!PLUGIN_RE.test(h.plugin)) throw new Error(`plugin must identify this app: ${h.plugin}`);

  const args = [
    '--entity', h.entity,
    '--entity-type', 'file',
    '--plugin', h.plugin,
    '--category', h.category ?? 'coding',
  ];
  if (h.write) args.push('--write');
  if (h.project) args.push('--project', h.project);
  if (h.language) args.push('--language', h.language);
  if (isPositiveInt(h.lineno)) args.push('--lineno', String(h.lineno));
  if (isPositiveInt(h.cursorpos)) args.push('--cursorpos', String(h.cursorpos));
  if (isPositiveInt(h.linesInFile)) args.push('--lines-in-file', String(h.linesInFile));
  // wakatime-cli parses AI tool transcripts by default (cmd/root.go). This
  // editor has nothing to report there, so it is turned off.
  args.push('--sync-ai-disabled');
  return args;
}

function isPositiveInt(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}
