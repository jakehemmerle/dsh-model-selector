// Red test for the reopened bug bead dms-0ll.11: two separate dsh-TUI
// processes calling production toggleStar on the same stars file within the
// same instant can drop each other's star (lost update). In-process scene
// tests cannot lose updates because toggleStar is synchronous under a single
// JS runtime, so this suite spawns real child processes that race. The
// oracle is independent of lib/: the parent only reads the final stars file
// and the children's exit-status files; no expected value is imported from
// production code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WORKER = join(HERE, 'concurrent-worker.mjs');
const ROUNDS = Number(process.env.CONCURRENT_ROUNDS ?? 60);

/** Spawn one worker that performs ONE production toggleStar the instant
 * startFile appears; resolve { exit, saved } when it exits. */
function oneToggle(file, refId, startFile, doneFile) {
  const child = spawn(process.execPath, [WORKER, file, refId, startFile, doneFile], { cwd: HERE, stdio: 'ignore' });
  const guard = setTimeout(() => child.kill('SIGKILL'), 20000);
  guard.unref();
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      clearTimeout(guard);
      const saved = existsSync(doneFile) ? readFileSync(doneFile, 'utf8').startsWith('saved') : undefined;
      resolve({ exit: code ?? -1, saved });
    });
    writeFileSync(startFile, ''); // release the spinning worker
  });
}

/** Spawn two workers for two distinct refs, release them in the same tick,
 * and resolve { savedA, savedB, keys } — the final stars-file content. */
function raceTwoToggles(file, startFile, doneA, doneB) {
  for (const f of [startFile, doneA, doneB]) try { unlinkSync(f); } catch { /* absent */ }
  const a = spawn(process.execPath, [WORKER, file, 'alpha', startFile, doneA], { cwd: HERE, stdio: 'ignore' });
  const b = spawn(process.execPath, [WORKER, file, 'beta', startFile, doneB], { cwd: HERE, stdio: 'ignore' });
  const guard = setTimeout(() => { a.kill('SIGKILL'); b.kill('SIGKILL'); }, 20000);
  guard.unref();
  return new Promise((resolve) => {
    let exits = 0;
    const step = (code) => { exits += 1; if (exits === 2) finish(); };
    a.on('exit', step);
    b.on('exit', step);
    function finish() {
      clearTimeout(guard);
      const savedA = existsSync(doneA) ? readFileSync(doneA, 'utf8').startsWith('saved') : undefined;
      const savedB = existsSync(doneB) ? readFileSync(doneB, 'utf8').startsWith('saved') : undefined;
      let state;
      try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { /* read below reports it */ }
      resolve({ exitA: a.exitCode, exitB: b.exitCode, savedA, savedB, state });
    }
    writeFileSync(startFile, '');
  });
}

describe('cross-process stars merging (reopened dms-0ll.11): separate processes never lose a toggle', () => {
  it('two simultaneous star writes from two processes both persist (' + ROUNDS + ' races)', async () => {
    let lost = 0;
    let firstLost;
    for (let round = 0; round < ROUNDS; round++) {
      const home = mkdtempSync(join(tmpdir(), 'dms-concurrency-'));
      try {
        const file = join(home, 'model-stars.json');
        const start = join(home, 'start.now');
        const doneA = join(home, 'done.alpha');
        const doneB = join(home, 'done.beta');
        const r = await raceTwoToggles(file, start, doneA, doneB);
        const keys = ((r.state && r.state.models) ?? []).map((m) => m.provider + '/' + m.id).sort();
        const kept = keys.includes('mock/alpha') && keys.includes('mock/beta');
        if (!kept || r.savedA === false || r.savedB === false || r.exitA !== 0 || r.exitB !== 0) {
          lost += 1;
          if (!firstLost) firstLost = { round, ...r, keys };
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
    assert.equal(lost, 0, 'lost updates in ' + lost + '/' + ROUNDS + ' inter-process races; first lost: ' + JSON.stringify(firstLost));
  });

  it('a stale lock left by a killed process is stolen and cleaned up', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dms-stalelock-'));
    try {
      const file = join(home, 'model-stars.json');
      const lock = file + '.lock';
      writeFileSync(lock, 'held by a process that died');
      utimesSync(lock, new Date(Date.now() - 60000), new Date(Date.now() - 60000)); // 60 s old
      const start = join(home, 'start.now');
      const done = join(home, 'done.only');
      const { exit, saved } = await oneToggle(file, 'only', start, done);
      assert.equal(exit, 0, 'the worker ran to completion');
      assert.equal(saved, true, 'the toggle succeeds despite the stale lock');
      const fileKeys = (JSON.parse(readFileSync(file, 'utf8')).models ?? []).map((m) => m.provider + '/' + m.id);
      assert.deepEqual(fileKeys, ['mock/only'], 'the toggle persisted');
      assert.equal(existsSync(lock), false, 'the stolen lock file is removed after the toggle');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
