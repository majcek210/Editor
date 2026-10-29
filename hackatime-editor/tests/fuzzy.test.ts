import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from '../src/core/fuzzy';

describe('fuzzyMatch', () => {
  it('matches characters in order', () => {
    expect(fuzzyMatch('mts', 'src/main.ts')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'src/main.ts')).toBeNull();
  });
  it('ranks file name matches above path matches', () => {
    const r = fuzzyFilter('app', ['src/app/x.ts', 'src/ui/app.ts', 'apple/zzz/q.md'], (s) => s);
    expect(r[0].item).toBe('src/ui/app.ts');
  });
});
