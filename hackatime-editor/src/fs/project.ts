import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

/**
 * Projects live in a folder the app can read and write with plain file paths,
 * so wakatime-cli can see the same files the editor edits.
 *  - External: the app's own external files dir
 *    (/storage/emulated/0/Android/data/<app id>/files), visible over USB.
 *  - Documents: the shared Documents folder. On Android 11+ the app can only
 *    read files it created there.
 */
export type RootKind = 'EXTERNAL' | 'DOCUMENTS';

export interface ProjectRef {
  root: RootKind;
  /** Path relative to the root, for example "projects/hello". */
  path: string;
}

export interface Entry {
  name: string;
  /** Path relative to the project folder, "/" separated, no leading slash. */
  rel: string;
  type: 'file' | 'directory';
  size: number;
}

export const PROJECTS_DIR = 'projects';
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', '.gradle', '__pycache__', 'target', '.idea']);
const MAX_WALK = 5000;

function dir(root: RootKind): Directory {
  return root === 'EXTERNAL' ? Directory.External : Directory.Documents;
}

export function joinRel(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function baseName(p: string): string {
  const s = p.replace(/\/$/, '');
  return s.slice(s.lastIndexOf('/') + 1);
}

export function parentRel(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

export class Project {
  readonly name: string;
  private absBase = '';

  constructor(readonly ref: ProjectRef) {
    this.name = baseName(ref.path);
  }

  async init(): Promise<void> {
    await this.mkdirp('');
    const { uri } = await Filesystem.getUri({ directory: dir(this.ref.root), path: this.ref.path });
    this.absBase = decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/$/, '');
  }

  /** Absolute file system path, as passed to wakatime-cli --entity. */
  absPath(rel: string): string {
    return `${this.absBase}/${rel}`;
  }

  private p(rel: string) {
    return { directory: dir(this.ref.root), path: joinRel(this.ref.path, rel) };
  }

  async list(rel: string): Promise<Entry[]> {
    const { files } = await Filesystem.readdir(this.p(rel));
    return files
      .map((f) => ({ name: f.name, rel: joinRel(rel, f.name), type: f.type, size: f.size }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  }

  /** All files in the project, breadth first, skipping build and VCS folders. */
  async walk(): Promise<Entry[]> {
    const out: Entry[] = [];
    const queue = [''];
    while (queue.length && out.length < MAX_WALK) {
      const d = queue.shift()!;
      let items: Entry[] = [];
      try {
        items = await this.list(d);
      } catch {
        continue;
      }
      for (const e of items) {
        if (e.type === 'directory') {
          if (!IGNORED_DIRS.has(e.name)) queue.push(e.rel);
        } else out.push(e);
      }
    }
    return out;
  }

  async read(rel: string): Promise<string> {
    const r = await Filesystem.readFile({ ...this.p(rel), encoding: Encoding.UTF8 });
    return typeof r.data === 'string' ? r.data : await r.data.text();
  }

  async write(rel: string, data: string): Promise<void> {
    await Filesystem.writeFile({ ...this.p(rel), data, encoding: Encoding.UTF8, recursive: true });
  }

  async createFile(rel: string): Promise<void> {
    if (await this.exists(rel)) throw new Error(`${rel} already exists`);
    await this.write(rel, '');
  }

  async mkdirp(rel: string): Promise<void> {
    try {
      await Filesystem.mkdir({ ...this.p(rel), recursive: true });
    } catch (e) {
      if (!(await this.exists(rel))) throw e;
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await Filesystem.stat(this.p(rel));
      return true;
    } catch {
      return false;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    if (await this.exists(to)) throw new Error(`${to} already exists`);
    await Filesystem.rename({ directory: dir(this.ref.root), toDirectory: dir(this.ref.root), from: joinRel(this.ref.path, from), to: joinRel(this.ref.path, to) });
  }

  async remove(entry: Entry): Promise<void> {
    if (entry.type === 'directory') await Filesystem.rmdir({ ...this.p(entry.rel), recursive: true });
    else await Filesystem.deleteFile(this.p(entry.rel));
  }
}

export async function listProjects(root: RootKind): Promise<string[]> {
  try {
    await Filesystem.mkdir({ directory: dir(root), path: PROJECTS_DIR, recursive: true });
  } catch {
    /* exists */
  }
  try {
    const { files } = await Filesystem.readdir({ directory: dir(root), path: PROJECTS_DIR });
    return files.filter((f) => f.type === 'directory').map((f) => f.name).sort();
  } catch {
    return [];
  }
}

export function validName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Name cannot be empty';
  if (n === '.' || n === '..' || /[\\:*?"<>|\u0000]/.test(n)) return 'Name contains invalid characters';
  return null;
}
