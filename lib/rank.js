// Ordering and search ranking, after omp's model-browser.ts
// (modelItemComparator / ModelItemRanker), minus roles and catalog priority.
import { buildSearchIndex, fuzzyMatch, prepareQuery } from './fuzzy.js';

export const keyOf = (model) => `${model.provider}/${model.id}`;

/** "gemini-2.5-pro" → 2.5, "claude-sonnet-4-6" → 4.6, "gpt-4o" → 4. */
export function versionOf(id) {
  const dot = id.match(/(?:^|[-_])(\d+\.\d+)/);
  if (dot) return Number.parseFloat(dot[1]);
  const dash = id.match(/(?:^|[-_])(\d{1,2})-(\d{1,2})(?=-|$)/);
  if (dash) return Number.parseFloat(`${dash[1]}.${dash[2]}`);
  const single = id.match(/(?:^|[-_])(\d+)/);
  if (single) return Number.parseFloat(single[1]);
  return 0;
}

/** Display order: recently used first, then provider, newest version, recency, id. */
export function comparator(recentKeys = []) {
  const mru = new Map(recentKeys.map((key, i) => [key, i]));
  const dateRe = /-(\d{8})$/;
  const latestRe = /-latest$/;
  return (a, b) => {
    const am = mru.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER;
    const bm = mru.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER;
    if (am !== bm) return am - bm;
    const p = a.provider.localeCompare(b.provider);
    if (p !== 0) return p;
    const av = versionOf(a.id);
    const bv = versionOf(b.id);
    if (av !== bv) return bv - av;
    const aLatest = latestRe.test(a.id);
    const bLatest = latestRe.test(b.id);
    const aDate = a.id.match(dateRe)?.[1] ?? '';
    const bDate = b.id.match(dateRe)?.[1] ?? '';
    const aRecency = aLatest || aDate !== '';
    const bRecency = bLatest || bDate !== '';
    if (aRecency !== bRecency) return aRecency ? -1 : 1;
    if (!aRecency) return a.id.localeCompare(b.id);
    if (aLatest !== bLatest) return aLatest ? -1 : 1;
    if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
    return a.id.localeCompare(b.id);
  };
}

const compact = (value) => value.toLowerCase().replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, '');

/** Exact id/selector → contiguous literal → fuzzy-only. */
function tierOf(query, id, selector) {
  if (!query) return 2;
  if (query === id || query === selector) return 0;
  if (id.includes(query) || selector.includes(query)) return 1;
  return 2;
}

/**
 * A ranker over one catalog snapshot. `rank(query, candidates)` filters and
 * orders `candidates` (a subset of the catalog): match tier, then affinity
 * (starred, then recently used), fuzzy quality, display order.
 */
export function createRanker(models, { recentKeys = [], starredKeys = new Set() } = {}) {
  const order = [...models].sort(comparator(recentKeys));
  const position = new Map(order.map((m, i) => [keyOf(m), i]));
  const mru = new Map(recentKeys.map((key, i) => [key, i]));
  const index = new Map(models.map((m) => {
    const key = keyOf(m);
    return [key, { search: buildSearchIndex(key), id: compact(m.id), selector: compact(key) }];
  }));
  return {
    /** Catalog display order for a subset. */
    sort(candidates) {
      return [...candidates].sort((a, b) => position.get(keyOf(a)) - position.get(keyOf(b)));
    },
    rank(query, candidates) {
      const pq = prepareQuery(query);
      if (pq === null) return this.sort(candidates);
      const q = compact(query);
      const rows = [];
      for (const model of candidates) {
        const key = keyOf(model);
        const keys = index.get(key);
        const match = fuzzyMatch(pq, keys.search);
        if (!match.matches) continue;
        rows.push({
          model,
          tier: tierOf(q, keys.id, keys.selector),
          star: starredKeys.has(key) ? 0 : 1,
          mru: mru.get(key) ?? Number.MAX_SAFE_INTEGER,
          bucket: Math.round(match.score / 10),
          score: match.score,
          position: position.get(key),
        });
      }
      rows.sort((a, b) => a.tier - b.tier || a.star - b.star || a.mru - b.mru
        || a.bucket - b.bucket || a.position - b.position || a.score - b.score);
      return rows.map((row) => row.model);
    },
  };
}
