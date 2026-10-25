// dms-dcg: recents follow the active backend, and a pick follows dsh-TUI 0.15's
// recorded switch contract (Chat.js `switchModelRecorded`):
//   notify "Switching model to <name>…" → channel.switchModel → on ok notify
//   "Model switched to <name>" and, unless the backend routes models itself
//   (backendCapabilities.modelRoutes === 'backend'), record the use in
//   modelRecentsFile(backendCapabilities.backendId) — `model-recents.json` for
//   the DSH kernel, `backends/<id>/model-recents.json` for any other backend.
// The Recent scope reads the same backend's list, and is empty when the
// backend routes models itself (the stock picker hides recents then).
//
// Oracles: the expected file path is computed here from the documented rule;
// dsh-TUI's own readModelRecents(dir, backendId) cross-checks the format.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import fc from 'fast-check';
import { catalog, selectorOf } from './arbitraries.js';
import { bootHost, fakeChannel, isolatedHome, KEYS, openScene, tuiRecents } from './harness.js';

const NUM_RUNS = Number(process.env.NUM_RUNS ?? 25);
const LIMIT = 10;

/** The documented backend → file rule (independent of lib/ and of dsh-TUI). */
function expectedFile(backendId) {
  if (backendId === undefined || backendId === '' || backendId === 'dsh') return 'model-recents.json';
  return join('backends', backendId.replace(/[^a-z0-9-]/giu, '_'), 'model-recents.json');
}

const BACKENDS = [undefined, '', 'dsh', 'codex', 'claude', 'Codex CLI!', 'gpu-local'];

/** Every file under dir → sha256, for "nothing else changed" checks. */
function snapshot(dir) {
  const out = new Map();
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

function seed(dataDir, file, refs) {
  const p = join(dataDir, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify({ models: refs }, null, 2)}\n`);
}

const scenarioArb = catalog.filter((c) => c.models.length >= 2).chain(({ models, providers }) => fc.record({
  models: fc.constant(models),
  providers: fc.constant(providers),
  backendId: fc.constantFrom(...BACKENDS),
  // Distinct seeded lists per backend file, so reading the wrong file shows.
  perFile: fc.array(fc.subarray(models, { maxLength: Math.min(4, models.length) }), { minLength: 3, maxLength: 3 }),
  pick: fc.nat(),
}));

async function pickInAllModels(s, pick, count) {
  while (s.frame().scope !== 'All models') await s.press(KEYS.tab);
  for (let i = 0; i < pick % count; i += 1) await s.press(KEYS.down);
  const target = s.frame().focused.selector;
  await s.press(KEYS.enter);
  return target;
}

describe('recents follow the active backend (dms-dcg)', () => {
  it('a pick records into the active backend\'s recents file only, readable by dsh-TUI', async () => {
    await fc.assert(fc.asyncProperty(scenarioArb, async ({ models, providers, backendId, perFile, pick }) => {
      const home = isolatedHome();
      try {
        const files = ['model-recents.json', join('backends', 'codex', 'model-recents.json'), join('backends', 'claude', 'model-recents.json')];
        files.forEach((f, i) => seed(home.dataDir, f, perFile[i].map(({ provider, id }) => ({ provider, id }))));
        const mine = expectedFile(backendId);
        const priorMine = tuiRecents.readModelRecents(home.dataDir, backendId).map((r) => `${r.provider}/${r.id}`);
        const caps = backendId === undefined ? undefined : { backendId, models: true, modelRoutes: 'providers' };
        const host = await bootHost();
        const { channel, calls } = fakeChannel({ models, providers, backendCapabilities: caps });
        const s = await openScene(host, channel);
        const catalogKeys = new Set(models.map(selectorOf));
        const expectedRecentCount = priorMine.filter((k) => catalogKeys.has(k)).length;
        assert.equal(s.frame().sidebar.find((e) => e.label === 'Recent')?.count, expectedRecentCount,
          `Recent scope reads ${mine}`);
        const before = snapshot(home.dataDir);
        const target = await pickInAllModels(s, pick, models.length);
        await s.quiet();
        assert.equal(calls.switchModel.length, 1, 'exactly one switch');
        const after = snapshot(home.dataDir);
        for (const [file, hash] of before) {
          if (file !== mine && !file.startsWith('model-stars')) assert.equal(after.get(file), hash, `${file} untouched (backend ${JSON.stringify(backendId)})`);
        }
        const read = tuiRecents.readModelRecents(home.dataDir, backendId).map((r) => `${r.provider}/${r.id}`);
        assert.ok(after.has(mine), `${mine} written`);
        assert.equal(read[0], target, 'picked model at the front of this backend\'s recents');
        assert.deepEqual(read.slice(1), priorMine.filter((k) => k !== target).slice(0, LIMIT - 1), 'move-to-front dedupe');
        const name = models.find((m) => selectorOf(m) === target).name;
        assert.deepEqual(calls.notify.map((n) => n.text), [`Switching model to ${name}…`, `Model switched to ${name}`],
          'stock switch notifications');
        await s.unmount();
        await host.unload();
      } finally { home.dispose(); }
    }), { numRuns: Math.max(8, Math.floor(NUM_RUNS / 3)) });
  });

  it('a backend that routes models itself records nothing and shows no recents', async () => {
    await fc.assert(fc.asyncProperty(scenarioArb, async ({ models, providers, backendId, perFile, pick }) => {
      const home = isolatedHome();
      try {
        seed(home.dataDir, expectedFile(backendId), perFile[0].map(({ provider, id }) => ({ provider, id })));
        const host = await bootHost();
        const { channel, calls } = fakeChannel({
          models, providers, backendCapabilities: { backendId: backendId ?? 'claude', models: true, modelRoutes: 'backend' },
        });
        const s = await openScene(host, channel);
        assert.equal(s.frame().sidebar.find((e) => e.label === 'Recent')?.count, 0, 'no recents for backend-routed models');
        const before = snapshot(home.dataDir);
        await pickInAllModels(s, pick, models.length);
        await s.quiet();
        assert.equal(calls.switchModel.length, 1);
        assert.deepEqual([...snapshot(home.dataDir)].filter(([f]) => !f.startsWith('model-stars')),
          [...before].filter(([f]) => !f.startsWith('model-stars')), 'no recents file written or changed');
        await s.unmount();
        await host.unload();
      } finally { home.dispose(); }
    }), { numRuns: Math.max(6, Math.floor(NUM_RUNS / 4)) });
  });
});
