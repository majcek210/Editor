import { icon } from './dom';

/** Codicon and color for a file name, roughly like VS Code's default icon theme. */
const BY_EXT: Record<string, [string, string]> = {
  java: ['coffee', '#e76f00'],
  kt: ['symbol-class', '#a97bff'], kts: ['tools', '#a97bff'],
  gradle: ['tools', '#02303a'],
  json: ['json', '#cbcb41'], mcmeta: ['json', '#cbcb41'], json5: ['json', '#cbcb41'],
  md: ['markdown', '#519aba'], markdown: ['markdown', '#519aba'],
  toml: ['settings', '#9c4221'], properties: ['settings', '#99b8c4'], cfg: ['settings', '#99b8c4'], ini: ['settings', '#99b8c4'],
  yml: ['settings', '#cb171e'], yaml: ['settings', '#cb171e'], xml: ['code', '#e37933'],
  js: ['file-code', '#cbcb41'], mjs: ['file-code', '#cbcb41'], jsx: ['file-code', '#519aba'],
  ts: ['file-code', '#519aba'], tsx: ['file-code', '#519aba'],
  py: ['file-code', '#519aba'], lua: ['file-code', '#519aba'], rs: ['file-code', '#dea584'], go: ['file-code', '#519aba'],
  c: ['file-code', '#519aba'], h: ['file-code', '#a074c4'], cpp: ['file-code', '#519aba'], hpp: ['file-code', '#a074c4'],
  html: ['file-code', '#e37933'], css: ['file-code', '#519aba'],
  png: ['file-media', '#a074c4'], jpg: ['file-media', '#a074c4'], jpeg: ['file-media', '#a074c4'], gif: ['file-media', '#a074c4'],
  ogg: ['file-media', '#a074c4'], nbt: ['file-binary', '#8b8b8b'], jar: ['package', '#e76f00'], zip: ['file-zip', '#8b8b8b'],
  sh: ['terminal', '#4d5a5e'], bat: ['terminal', '#c1f12e'], txt: ['file', '#cccccc'], log: ['output', '#8b8b8b'],
  accesswidener: ['key', '#e76f00'],
};
const BY_NAME: Record<string, [string, string]> = {
  gradlew: ['terminal', '#4d5a5e'], '.gitignore': ['git-commit', '#41535b'], license: ['law', '#cbcb41'],
  'license.txt': ['law', '#cbcb41'], 'license.md': ['law', '#cbcb41'],
};

export function fileIcon(name: string, extra = ''): HTMLElement {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const [glyph, color] = BY_NAME[lower] ?? BY_EXT[ext] ?? ['file', '#c5c5c5'];
  const el = icon(glyph, `file-icon ${extra}`.trim());
  el.style.color = color === '#02303a' ? '#4fb3c9' : color;
  return el;
}
