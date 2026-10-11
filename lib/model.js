// Selector state: scopes, the filtered list, and keyboard transitions.
// Pure functions of (state, catalog); the scene owns effects (files, switch).
import { createRanker, keyOf } from './rank.js';

export const STARRED = 'starred';
export const RECENT = 'recent';
export const ALL = 'all';
const providerScope = (id) => `p:${id}`;

/**
 * Catalog snapshot the scopes are computed over.
 * @param {{ models, providers, recents, stars, currentKey }} input
 */
export function createCatalog({ models, providers, recents, stars, currentKey }) {
  const catalogKeys = new Set(models.map(keyOf));
  const recentKeys = recents.map(keyOf).filter((key) => catalogKeys.has(key));
  const byKey = new Map(models.map((m) => [keyOf(m), m]));
  const ranker = createRanker(models, { recentKeys, starredKeys: stars });
  const providerOrder = [];
  const labels = new Map();
  for (const p of providers) {
    if (!labels.has(p.id)) { providerOrder.push(p.id); labels.set(p.id, p.name || p.id); }
  }
  for (const m of models) {
    if (!labels.has(m.provider)) { providerOrder.push(m.provider); labels.set(m.provider, m.provider); }
  }
  const scopes = [
    { id: STARRED, label: 'Starred', icon: '★', candidates: ranker.sort(models.filter((m) => stars.has(keyOf(m)))) },
    { id: RECENT, label: 'Recent', icon: '◷', candidates: recentKeys.map((key) => byKey.get(key)), ordered: true },
    { id: ALL, label: 'All models', icon: '⬢', candidates: ranker.sort(models) },
    ...providerOrder.map((id) => ({
      id: providerScope(id), label: labels.get(id), icon: '●', provider: id,
      candidates: ranker.sort(models.filter((m) => m.provider === id)),
    })),
  ];
  return { models, stars, currentKey, ranker, scopes, recentKeys };
}

/** Each scope's matches for the query (in display order). */
export function scopeMatches(catalog, query) {
  return catalog.scopes.map((scope) => {
    const list = query === '' ? scope.candidates : catalog.ranker.rank(query, scope.candidates);
    return { ...scope, list, count: list.length };
  });
}

export function initialState(catalog) {
  const scopeId = catalog.scopes[0].candidates.length > 0 ? STARRED : ALL;
  const scope = catalog.scopes.find((s) => s.id === scopeId);
  const at = scope.candidates.findIndex((m) => keyOf(m) === catalog.currentKey);
  return { query: '', scopeId, focus: Math.max(0, at), scroll: 0, warning: undefined };
}

/** Derived view of a state: the active scope's list, clamped focus. */
export function derive(catalog, state) {
  const scopes = scopeMatches(catalog, state.query);
  const active = scopes.find((s) => s.id === state.scopeId) ?? scopes.find((s) => s.id === ALL);
  const focus = active.count === 0 ? -1 : Math.min(Math.max(state.focus, 0), active.count - 1);
  return { scopes, active, list: active.list, focus, focused: focus >= 0 ? active.list[focus] : undefined };
}

function withQuery(catalog, state, query) {
  let scopeId = state.scopeId;
  if (state.query === '' && query !== '' && (scopeId === STARRED || scopeId === RECENT)) scopeId = ALL;
  if (query !== '' && scopeId !== ALL) {
    const scope = scopeMatches(catalog, query).find((s) => s.id === scopeId);
    if (!scope || scope.count === 0) scopeId = ALL;
  }
  return { ...state, query, scopeId, focus: 0, scroll: 0, warning: undefined };
}

function deleteWord(query) {
  return query.replace(/[^\p{Letter}\p{Number}]*$/u, '').replace(/[\p{Letter}\p{Number}]*$/u, '');
}

function hop(catalog, state, direction) {
  const scopes = scopeMatches(catalog, state.query);
  const from = Math.max(0, scopes.findIndex((s) => s.id === state.scopeId));
  for (let k = 1; k <= scopes.length; k += 1) {
    const next = scopes[(from + direction * k + scopes.length * k) % scopes.length];
    if (next.count > 0) {
      if (next.id === state.scopeId) return state;
      const at = state.query === '' ? next.list.findIndex((m) => keyOf(m) === catalog.currentKey) : -1;
      return { ...state, scopeId: next.id, focus: Math.max(0, at), scroll: 0, warning: undefined };
    }
  }
  return state;
}

/**
 * Keyboard transition. `page` is the visible list height.
 * Returns the next state; effects (star, pick, close) are the caller's.
 */
export function reduce(catalog, state, action, page = 10) {
  const view = derive(catalog, state);
  const last = view.list.length - 1;
  const move = (focus) => ({ ...state, focus: Math.max(0, Math.min(focus, Math.max(0, last))), warning: undefined });
  switch (action.type) {
    case 'type': return withQuery(catalog, state, state.query + action.text);
    case 'backspace': return withQuery(catalog, state, [...state.query].slice(0, -1).join(''));
    case 'deleteWord': return withQuery(catalog, state, deleteWord(state.query));
    case 'clear': return withQuery(catalog, state, '');
    case 'up': return move(view.focus - 1);
    case 'down': return move(view.focus + 1);
    case 'pageUp': return move(view.focus - page);
    case 'pageDown': return move(view.focus + page);
    case 'home': return move(0);
    case 'end': return move(last);
    case 'nextScope': return hop(catalog, state, +1);
    case 'prevScope': return hop(catalog, state, -1);
    case 'warn': return { ...state, warning: action.text };
    default: return state;
  }
}

/**
 * After the starred set changed (catalog rebuilt): keep focus on `key` when
 * it is still listed, otherwise hold the row index.
 */
export function refocus(catalog, state, key) {
  const view = derive(catalog, state);
  const at = view.list.findIndex((m) => keyOf(m) === key);
  return { ...state, focus: at >= 0 ? at : Math.min(state.focus, Math.max(0, view.list.length - 1)) };
}

/** Keep the focused row inside a `height`-row window. */
export function scrollFor(state, focus, count, height) {
  let scroll = Math.min(state.scroll, Math.max(0, count - height));
  if (focus >= 0) {
    if (focus < scroll) scroll = focus;
    else if (focus >= scroll + height) scroll = focus - height + 1;
  }
  return Math.max(0, scroll);
}
