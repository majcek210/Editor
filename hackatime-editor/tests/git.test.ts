import { describe, expect, it } from 'vitest';
import { repoNameFromUrl, validCloneUrl } from '../src/native/git';

describe('git helpers', () => {
  it('derives a folder name from the clone URL', () => {
    expect(repoNameFromUrl('https://github.com/majcek210/Editor.git')).toBe('Editor');
    expect(repoNameFromUrl('https://github.com/o/my repo/')).toBe('my-repo');
  });
  it('accepts only plain https URLs', () => {
    expect(validCloneUrl('https://github.com/o/r.git')).toBeNull();
    expect(validCloneUrl('git@github.com:o/r.git')).not.toBeNull();
    expect(validCloneUrl('http://github.com/o/r.git')).not.toBeNull();
    expect(validCloneUrl('https://user:tok@github.com/o/r.git')).not.toBeNull();
  });
});
