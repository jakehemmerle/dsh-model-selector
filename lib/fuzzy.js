// Fuzzy matching, ported from oh-my-pi packages/tui/src/fuzzy.ts
// (MIT, © 2025 Mario Zechner, © 2025-2026 Can Bölük, © 2026 Stencil Labs).
// Word-local matching; lower score = better. Space-separated tokens must all
// match. Kept behaviour-identical so search feels like omp's.

const ALPHANUMERIC_SWAP_PENALTY = 5;
const COMPACT_PHRASE_BONUS = 1200;
const PHRASE_BONUS = 1000;
const MIN_SHADOW_RESCAN_LENGTH = 3;

export function normalizeForSearch(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildSearchIndex(text) {
  const normalized = normalizeForSearch(text);
  if (normalized.length === 0) return { normalized, compact: '', compactWordStarts: new Set(), words: [] };
  const words = [];
  const compactWordStarts = new Set();
  let index = 0;
  let compactIndex = 0;
  let ordinal = 0;
  for (const word of normalized.split(' ')) {
    words.push({ text: word, index, ordinal });
    compactWordStarts.add(compactIndex);
    index += word.length + 1;
    compactIndex += word.length;
    ordinal += 1;
  }
  return { normalized, compact: normalized.replaceAll(' ', ''), compactWordStarts, words };
}

function scoreCharacters(query, text) {
  if (query.length === 0) return { matches: true, score: 0, span: 0 };
  if (query.length > text.length) return { matches: false, score: 0, span: 0 };
  let q = 0;
  let score = 0;
  let first = -1;
  let last = -1;
  let consecutive = 0;
  for (let i = 0; i < text.length && q < query.length; i += 1) {
    if (text[i] !== query[q]) continue;
    if (first < 0) first = i;
    if (last === i - 1) {
      consecutive += 1;
      score -= consecutive * 5;
    } else {
      consecutive = 0;
      if (last >= 0) score += (i - last - 1) * 2;
    }
    score += i * 0.1;
    last = i;
    q += 1;
  }
  if (q < query.length) return { matches: false, score: 0, span: 0 };
  return { matches: true, score, span: last - first + 1 };
}

function swapVariants(token) {
  const variants = new Set();
  for (let i = 0; i < token.length - 1; i += 1) {
    const a = token[i];
    const b = token[i + 1];
    if ((/[a-z]/.test(a) && /\d/.test(b)) || (/\d/.test(a) && /[a-z]/.test(b))) {
      variants.add(token.slice(0, i) + b + a + token.slice(i + 2));
    }
  }
  return [...variants];
}

const withPosition = (score, index) => score + index * 0.01;

function isWordBoundaryPhrase(normalized, index, length) {
  const before = index === 0 || normalized[index - 1] === ' ';
  const afterIndex = index + length;
  return before && (afterIndex === normalized.length || normalized[afterIndex] === ' ');
}

function findWordBoundaryPhrase(normalized, phrase) {
  if (phrase.length === 0) return -1;
  const first = normalized.indexOf(phrase);
  if (first < 0) return -1;
  if (isWordBoundaryPhrase(normalized, first, phrase.length)) return first;
  if (first === 0 || normalized[first - 1] === ' ') return -1;
  if (phrase.length < MIN_SHADOW_RESCAN_LENGTH) return -1;
  for (let at = normalized.indexOf(phrase, first + 1); at >= 0; at = normalized.indexOf(phrase, at + 1)) {
    if (isWordBoundaryPhrase(normalized, at, phrase.length)) return at;
  }
  return -1;
}

function findCompactWordStart(index, needle) {
  if (needle.length === 0) return -1;
  const { compact, compactWordStarts } = index;
  const first = compact.indexOf(needle);
  if (first < 0) return -1;
  if (compactWordStarts.has(first)) return first;
  if (needle.length < MIN_SHADOW_RESCAN_LENGTH) return -1;
  for (let at = compact.indexOf(needle, first + 1); at >= 0; at = compact.indexOf(needle, at + 1)) {
    if (compactWordStarts.has(at)) return at;
  }
  return -1;
}

function scoreTokenAgainstWord(token, word) {
  if (word.text === token) return { matches: true, score: withPosition(-200, word.index) };
  if (word.text.startsWith(token)) {
    return { matches: true, score: withPosition(-170 + (word.text.length - token.length) * 0.5, word.index) };
  }
  if (token.startsWith(word.text) && token.length - word.text.length <= 2) {
    return { matches: true, score: withPosition(-150 + token.length - word.text.length, word.index) };
  }
  const at = word.text.indexOf(token);
  if (at >= 0) return { matches: true, score: withPosition(-20 + at, word.index) };
  const chars = scoreCharacters(token, word.text);
  if (!chars.matches) return null;
  const maxSpan = Math.max(token.length + 2, Math.ceil(token.length * 1.8));
  if (chars.span > maxSpan) return null;
  return { matches: true, score: withPosition(-40 + chars.score, word.index) };
}

function scoreAcronym(token, index) {
  if (token.length < 2 || token.length > 4 || index.words.length === 0) return null;
  let q = 0;
  let firstOrdinal = -1;
  let lastOrdinal = -1;
  let firstTextIndex = 0;
  for (const word of index.words) {
    if (word.text[0] !== token[q]) continue;
    if (firstOrdinal < 0) {
      firstOrdinal = word.ordinal;
      firstTextIndex = word.index;
    }
    lastOrdinal = word.ordinal;
    q += 1;
    if (q === token.length) break;
  }
  if (q < token.length || firstOrdinal < 0) return null;
  const span = lastOrdinal - firstOrdinal + 1;
  if (span > token.length + 2) return null;
  return { matches: true, score: withPosition(-30 + span * 4 - token.length * 2, firstTextIndex) };
}

function scoreTokenDirect(token, index) {
  if (token.length === 0) return { matches: true, score: 0 };
  let best = null;
  const compactIndex = findCompactWordStart(index, token);
  if (compactIndex >= 0) best = { matches: true, score: withPosition(-140, compactIndex) };
  for (const word of index.words) {
    const match = scoreTokenAgainstWord(token, word);
    if (match && (!best || match.score < best.score)) best = match;
  }
  const acronym = scoreAcronym(token, index);
  if (acronym && (!best || acronym.score < best.score)) best = acronym;
  return best ?? { matches: false, score: 0 };
}

function scoreToken(token, swaps, index) {
  let best = scoreTokenDirect(token, index);
  if (best.matches) return best;
  for (const variant of swaps) {
    const match = scoreTokenDirect(variant, index);
    if (!match.matches) continue;
    const score = match.score + ALPHANUMERIC_SWAP_PENALTY;
    if (!best.matches || score < best.score) best = { matches: true, score };
  }
  return best;
}

/** Prepare a query once per keystroke; null for an empty query. */
export function prepareQuery(query) {
  const normalized = normalizeForSearch(query);
  if (normalized.length === 0) return null;
  const tokens = normalized.split(' ');
  return { normalized, tokens, swaps: tokens.map(swapVariants), compact: normalized.replaceAll(' ', '') };
}

/** Match a prepared query against a prepared index. */
export function fuzzyMatch(pq, index) {
  if (pq === null) return { matches: true, score: 0 };
  if (index.words.length === 0) return { matches: false, score: 0 };
  let total = 0;
  const phrase = findWordBoundaryPhrase(index.normalized, pq.normalized);
  if (phrase >= 0) total += -PHRASE_BONUS + phrase * 0.01;
  const compactPhrase = findCompactWordStart(index, pq.compact);
  if (compactPhrase >= 0) total += -COMPACT_PHRASE_BONUS + compactPhrase * 0.01;
  for (let i = 0; i < pq.tokens.length; i += 1) {
    const match = scoreToken(pq.tokens[i], pq.swaps[i], index);
    if (!match.matches) return { matches: false, score: 0 };
    total += match.score;
  }
  return { matches: true, score: total };
}
