import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';

export interface LanguageDef {
  id: string;
  /** Display name. */
  name: string;
  /**
   * Language name passed to wakatime-cli with --language. Defaults to name;
   * null means "let the CLI detect it" (for types without a clear WakaTime name).
   */
  cliLanguage?: string | null;
  extensions: string[];
  filenames?: string[];
  load: () => Promise<Extension>;
}

const legacy = async (mod: Promise<Record<string, unknown>>, key: string): Promise<Extension> =>
  StreamLanguage.define((await mod)[key] as Parameters<typeof StreamLanguage.define>[0]);

export const LANGUAGES: LanguageDef[] = [
  { id: 'javascript', name: 'JavaScript', extensions: ['js', 'mjs', 'cjs'], load: async () => (await import('@codemirror/lang-javascript')).javascript() },
  { id: 'jsx', name: 'JavaScript', extensions: ['jsx'], load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }) },
  { id: 'typescript', name: 'TypeScript', extensions: ['ts', 'mts', 'cts'], load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }) },
  { id: 'tsx', name: 'TSX', extensions: ['tsx'], load: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }) },
  { id: 'python', name: 'Python', extensions: ['py', 'pyw', 'pyi'], load: async () => (await import('@codemirror/lang-python')).python() },
  { id: 'lua', name: 'Lua', extensions: ['lua'], load: () => legacy(import('@codemirror/legacy-modes/mode/lua'), 'lua') },
  { id: 'html', name: 'HTML', extensions: ['html', 'htm', 'xhtml'], load: async () => (await import('@codemirror/lang-html')).html() },
  { id: 'css', name: 'CSS', extensions: ['css', 'scss', 'less'], load: async () => (await import('@codemirror/lang-css')).css() },
  { id: 'json', name: 'JSON', extensions: ['json', 'jsonc', 'webmanifest', 'mcmeta', 'json5'], load: async () => (await import('@codemirror/lang-json')).json() },
  { id: 'markdown', name: 'Markdown', extensions: ['md', 'markdown', 'mdx'], load: async () => (await import('@codemirror/lang-markdown')).markdown() },
  { id: 'c', name: 'C', extensions: ['c', 'h'], load: async () => (await import('@codemirror/lang-cpp')).cpp() },
  { id: 'cpp', name: 'C++', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'ino'], load: async () => (await import('@codemirror/lang-cpp')).cpp() },
  { id: 'rust', name: 'Rust', extensions: ['rs'], load: async () => (await import('@codemirror/lang-rust')).rust() },
  { id: 'go', name: 'Go', extensions: ['go'], load: async () => (await import('@codemirror/lang-go')).go() },
  { id: 'java', name: 'Java', extensions: ['java'], load: async () => (await import('./java')).javaSupport() },
  { id: 'kotlin', name: 'Kotlin', extensions: ['kt', 'kts'], load: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'kotlin') },
  { id: 'gradle', name: 'Gradle (Groovy)', cliLanguage: null, extensions: ['gradle'], load: () => legacy(import('@codemirror/legacy-modes/mode/groovy'), 'groovy') },
  { id: 'groovy', name: 'Groovy', extensions: ['groovy'], load: () => legacy(import('@codemirror/legacy-modes/mode/groovy'), 'groovy') },
  { id: 'toml', name: 'TOML', extensions: ['toml'], load: () => legacy(import('@codemirror/legacy-modes/mode/toml'), 'toml') },
  { id: 'properties', name: 'Properties', cliLanguage: null, extensions: ['properties', 'cfg', 'ini', 'accesswidener', 'lang'], load: () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties') },
  { id: 'yaml', name: 'YAML', extensions: ['yml', 'yaml'], load: () => legacy(import('@codemirror/legacy-modes/mode/yaml'), 'yaml') },
  { id: 'xml', name: 'XML', extensions: ['xml', 'svg', 'pom'], load: () => legacy(import('@codemirror/legacy-modes/mode/xml'), 'xml') },
  { id: 'shell', name: 'Shell', cliLanguage: 'Bash', extensions: ['sh', 'bash'], filenames: ['gradlew'], load: () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell') },
  { id: 'plaintext', name: 'Text', extensions: ['txt', 'text', 'log'], load: async () => [] },
];

export const PLAIN = LANGUAGES[LANGUAGES.length - 1];

export function detectLanguage(fileName: string): LanguageDef {
  const lower = fileName.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  return LANGUAGES.find((l) => l.filenames?.includes(lower) || l.extensions.includes(ext)) ?? PLAIN;
}

export function languageById(id: string): LanguageDef {
  return LANGUAGES.find((l) => l.id === id) ?? PLAIN;
}

/** The --language value for wakatime-cli, or undefined to let the CLI detect it. */
export function cliLanguageOf(l: LanguageDef): string | undefined {
  if (l.cliLanguage === null) return undefined;
  return l.cliLanguage ?? (l.id === 'plaintext' ? undefined : l.name);
}
