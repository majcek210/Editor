/**
 * Fuzzy match used by quick open and the command palette. Returns null when
 * the query characters do not all appear in order. Higher scores are better.
 */
export interface FuzzyResult {
  score: number;
  /** Indexes of matched characters in the target. */
  matches: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, matches: [] };
  const t = target.toLowerCase();
  const matches: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  const nameStart = target.lastIndexOf('/') + 1;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return null;
    matches.push(idx);
    if (idx === prev + 1) score += 5;
    const before = target[idx - 1];
    if (idx === 0 || before === '/' || before === '_' || before === '-' || before === '.' || before === ' ') score += 8;
    else if (target[idx] !== t[idx] && before && before === before.toLowerCase()) score += 6;
    if (idx >= nameStart) score += 3;
    score -= Math.min(idx - ti, 10) * 0.5;
    prev = idx;
    ti = idx + 1;
  }
  score -= target.length * 0.05;
  return { score, matches };
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string, limit = 200): { item: T; result: FuzzyResult }[] {
  const out: { item: T; result: FuzzyResult }[] = [];
  for (const item of items) {
    const result = fuzzyMatch(query, key(item));
    if (result) out.push({ item, result });
  }
  if (query.trim()) out.sort((a, b) => b.result.score - a.result.score);
  return out.slice(0, limit);
}
