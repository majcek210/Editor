import { registerPlugin } from '@capacitor/core';

export interface GitFileChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted' | 'untracked';
}

export interface GitStatus {
  repo: boolean;
  branch?: string | null;
  detached?: boolean;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  staged?: GitFileChange[];
  unstaged?: GitFileChange[];
  conflicts?: string[];
  remote?: string | null;
}

export interface GitConfig {
  name: string;
  email: string;
  username: string;
  host: string;
  /** The token itself is never returned to the web layer. */
  hasToken: boolean;
}

export interface GitCommit {
  id: string;
  message: string;
  author: string;
  time: number;
}

type Dir = { dir: string };

export interface GitPlugin {
  getConfig(): Promise<GitConfig>;
  /** token: omit to keep the saved one, "" to remove it. */
  setConfig(o: Partial<Omit<GitConfig, 'hasToken'>> & { token?: string }): Promise<void>;
  isRepo(o: Dir): Promise<{ repo: boolean }>;
  init(o: Dir): Promise<void>;
  clone(o: Dir & { url: string; branch?: string }): Promise<void>;
  status(o: Dir): Promise<GitStatus>;
  stage(o: Dir & { paths: string[] }): Promise<void>;
  stageAll(o: Dir): Promise<void>;
  unstage(o: Dir & { paths: string[] }): Promise<void>;
  discard(o: Dir & { paths: string[] }): Promise<void>;
  commit(o: Dir & { message: string }): Promise<{ id: string }>;
  push(o: Dir): Promise<{ message: string }>;
  pull(o: Dir): Promise<{ message: string }>;
  fetch(o: Dir): Promise<void>;
  branches(o: Dir): Promise<{ local: string[]; remote: string[] }>;
  checkout(o: Dir & { name: string; create?: boolean }): Promise<void>;
  setRemote(o: Dir & { url: string }): Promise<void>;
  log(o: Dir & { max?: number }): Promise<{ commits: GitCommit[] }>;
}

export const Git = registerPlugin<GitPlugin>('Git');

/** "https://github.com/o/my-repo.git" -> "my-repo". */
export function repoNameFromUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  return name.replace(/[^A-Za-z0-9._-]/g, '-') || 'repo';
}

export function validCloneUrl(url: string): string | null {
  const u = url.trim();
  if (!/^https:\/\/[^/\s]+\/\S+$/.test(u)) return 'Use an https:// URL, for example https://github.com/user/repo.git';
  if (/^https:\/\/[^/]*@/.test(u)) return 'Do not put a username or token in the URL; set a token in Settings';
  return null;
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
