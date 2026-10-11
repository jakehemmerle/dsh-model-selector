// Small JSON stores under dsh-TUI's data dir (~/.dsh-tui, resolved per call so
// $HOME changes are honoured).
//
//   model-stars.json    this plugin's own: { models: [{ provider, id }] }
//   model-recents.json  dsh-TUI's own recents (modelRecents.ts): same shape,
//                       most-recent-first, deduped, capped at 10. Written in
//                       that exact format so the TUI and this scene share it.
//
// Every read tolerates a missing or malformed file (reads as empty) and every
// write is best-effort: a failed write must never block a switch or a star.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const RECENTS_LIMIT = 10;

export function dataDir() {
  return join(homedir() || process.env.HOME || '', '.dsh-tui');
}

function asRef(value) {
  if (typeof value !== 'object' || value === null) return undefined;
  const { provider, id } = value;
  return typeof provider === 'string' && provider !== '' && typeof id === 'string' && id !== ''
    ? { provider, id }
    : undefined;
}

const refKey = (ref) => `${ref.provider}/${ref.id}`;

/** Valid, deduped refs from a `{ models: [...] }` file; [] on anything else. */
export function readRefs(file, limit = Infinity) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.models)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of parsed.models) {
    const ref = asRef(entry);
    if (ref === undefined || seen.has(refKey(ref))) continue;
    seen.add(refKey(ref));
    out.push(ref);
    if (out.length >= limit) break;
  }
  return out;
}

function writeRefs(file, refs) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ models: refs }, null, 2)}\n`);
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export function starsFile(config = {}) {
  return config.starsFile ?? join(dataDir(), 'model-stars.json');
}

export function recentsFile() {
  return join(dataDir(), 'model-recents.json');
}

export function readStars(config) {
  return readRefs(starsFile(config));
}

/**
 * Toggle one star with a read-modify-write, so another TUI's stars (and stars
 * for providers that are offline right now) are preserved.
 * @returns the starred keys after the toggle.
 */
export function toggleStar(config, ref) {
  const file = starsFile(config);
  const refs = readRefs(file);
  const key = refKey(ref);
  const next = refs.some((r) => refKey(r) === key)
    ? refs.filter((r) => refKey(r) !== key)
    : [...refs, { provider: ref.provider, id: ref.id }];
  writeRefs(file, next);
  return new Set(next.map(refKey));
}

export function readRecents() {
  return readRefs(recentsFile(), RECENTS_LIMIT);
}

/** dsh-TUI's recordModelUse: move to front, dedupe, cap. */
export function recordRecent(ref) {
  const key = refKey(ref);
  const next = [{ provider: ref.provider, id: ref.id }, ...readRecents().filter((r) => refKey(r) !== key)].slice(0, RECENTS_LIMIT);
  writeRefs(recentsFile(), next);
  return next;
}
