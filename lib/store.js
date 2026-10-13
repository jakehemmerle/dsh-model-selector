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
//
// model-stars.json is written by several dsh-TUI processes sharing one HOME,
// so the read-modify-write in toggleStar runs under an exclusive lock file
// (reopened bug dms-0ll.11): copy-on-write via a pid-unique tmp + rename alone
// still loses one writer's stars when two of them read before either writes.
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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

// --- cross-process file locking (reopened dms-0ll.11) ---
const LOCK_RETRY_MS = 15;
const LOCK_TIMEOUT_MS = 1500; // a live holder never holds more than its few write syscalls
const STALE_LOCK_MS = 10000; // older than this means the holder was killed

/** A synchronous sleep for the scene's thread; only taken under live contention. */
const sleepNow = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Acquire an exclusive lock for `file`, or undefined after LOCK_TIMEOUT_MS.
 * A lock older than STALE_LOCK_MS is stolen: its holder was killed and can
 * never complete its read-modify-write, so it must not block stars forever. */
function acquireLock(file) {
  const lockPath = `${file}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') return undefined;
      try {
        const { mtimeMs } = statSync(lockPath);
        if (Date.now() - mtimeMs > STALE_LOCK_MS) {
          try { unlinkSync(lockPath); } catch { /* a sibling stole it first */ }
          continue;
        }
      } catch { continue; }
    }
    if (fd !== undefined) return { lockPath, fd };
    if (Date.now() >= deadline) return undefined;
    sleepNow(LOCK_RETRY_MS);
  }
}

function releaseLock(lock) {
  try { closeSync(lock.fd); } catch { /* already closed */ }
  try { unlinkSync(lock.lockPath); } catch { /* a sibling already removed it */ }
}

/** Run `fn()` while no other process can be mid-toggle on `file`. Returns
 * undefined when the lock could not be acquired in time; callers treat that
 * like a failed write (show the persisted state and say the star not saved). */
function withFileLock(file, fn) {
  const lock = acquireLock(file);
  if (lock === undefined) return undefined;
  try {
    return fn();
  } finally {
    releaseLock(lock);
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
 * Toggle one star with a locked read-modify-write, so another TUI's stars (and
 * stars for providers that are offline right now) are preserved — including
 * another TUI toggling in the same instant (reopened dms-0ll.11).
 * @returns `{ stars, saved }`: the starred keys after the toggle. When the
 * write or the lock cannot be completed, `stars` is the persisted state re-read
 * from disk and `saved` is false, so the scene can show reality instead of a
 * phantom star (dms-0ll.10).
 */
export function toggleStar(config, ref) {
  const file = starsFile(config);
  const toggled = withFileLock(file, () => {
    const refs = readRefs(file);
    const key = refKey(ref);
    const next = refs.some((r) => refKey(r) === key)
      ? refs.filter((r) => refKey(r) !== key)
      : [...refs, { provider: ref.provider, id: ref.id }];
    return writeRefs(file, next) ? { stars: new Set(next.map(refKey)), saved: true } : undefined;
  });
  // Either a failed write or a lock that could not be acquired in time:
  // both mean this toggle was not persisted, so surface the persisted state.
  return toggled ?? { stars: new Set(readRefs(file).map(refKey)), saved: false };
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
