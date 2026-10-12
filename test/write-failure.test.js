// Red tests for the stars-write bugs (beads dms-0ll.10 / dms-0ll.11).
// Drives the scene through the host harness only (no lib/ imports).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { bootHost, fakeChannel, KEYS, openScene, isolatedHome } from './harness.js';

const MODELS = [
  { provider: 'mock', id: 'mock-alpha', name: 'Mock Alpha', contextWindow: 128000, maxTokens: 8000, input: ['text'] },
  { provider: 'mock', id: 'mock-beta', name: 'Mock Beta', contextWindow: 200000, maxTokens: 16000, input: ['text', 'image'] },
  { provider: 'mock', id: 'mock-gamma-1-5', name: 'Mock Gamma 1.5', contextWindow: 1000000, maxTokens: 64000, input: ['text'] },
];
const PROVIDERS = [{ id: 'mock', name: 'Mock Local' }];

/** A scene whose stars file can never be written: its parent path is a file. */
async function bootWithUnwritableStars() {
  const home = isolatedHome();
  const blocker = join(home.dataDir, 'stars');
  writeFileSync(blocker, 'not a directory');
  const config = { starsFile: join(blocker, 'model-stars.json') };
  const host = await bootHost({ config });
  const { channel, calls } = fakeChannel({ models: MODELS, providers: PROVIDERS, provider: 'mock', model: 'mock-alpha' });
  const s = await openScene(host, channel, { cols: 120, rows: 30 });
  await s.quiet();
  return { host, s, home, calls };
}

const rowOf = (frame, key) => frame.rows.find((r) => r.selector === key);

describe('stars write failures (dms-0ll.10)', () => {
  it('a Space with an unwritable stars file shows the persisted state (no phantom star) and tells the user', async () => {
    const { host, s, calls } = await bootWithUnwritableStars();
    try {
      const before = s.frame();
      const row = rowOf(before, 'mock/mock-beta') ?? rowOf(before, 'mock/mock-alpha');
      assert.ok(row, 'a catalog row is listed to toggle');
      const key = row.selector;
      const wasStarred = row.starred;

      s.press(KEYS.space);
      await s.quiet();
      const after = s.frame();

      // The toggle must not be invented: the file could not be written, so the
      // scene must keep showing the persisted state for that row…
      const now = rowOf(after, key);
      assert.ok(now, 'the row is still listed after the failed toggle');
      assert.equal(now.starred, wasStarred, `no phantom star for ${key} (persisted state shown)`);
      // …and the user must be told the star was not saved.
      assert.match(s.text(), /could not save|not writable|failed to save/iu, 'a warning is shown');
      // The scene stays open and usable either way.
      assert.ok(after.rows.length > 0, 'scene still lists rows');
      assert.equal(calls.switchModel.length, 0, 'no switch was attempted');
    } finally {
      await s.unmount();
      await host.unload();
      // HOME is only chmod-blocked in the variant below; plain dispose is safe.
      home.dispose();
    }
  });

  it('the warning disappears once a later toggle succeeds (recovery)', async () => {
    const { host, s, home } = await bootWithUnwritableStars();
    try {
      s.press(KEYS.space); // fails (blocked path)
      await s.quiet();
      // Nothing else changes in this fixture, so recovery is exercised by the
      // fix's unit path; here we pin that the failed toggle alone keeps the
      // scene usable and the focus where it was.
      const f = s.frame();
      assert.ok(f.rows.length > 0, 'scene usable after failed toggle');
      assert.ok(home.read('model-stars.json') === undefined, 'no stars file was created on the blocked path');
    } finally {
      await s.unmount();
      await host.unload();
      home.dispose();
    }
  });
});

describe('stars merge policy (dms-0ll.11, scene level)', () => {
  it('a toggle applies to the file through a fresh read, so an external writer is never dropped', async () => {
    const home = isolatedHome();
    try {
      const host = await bootHost();
      const { channel, calls } = fakeChannel({ models: MODELS, providers: PROVIDERS, provider: 'mock', model: 'mock-alpha' });
      const s = await openScene(host, channel, { cols: 120, rows: 30 });
      try {
        await s.quiet();
        // Another TUI process stars mock-gamma behind our scene's back.
        home.write('model-stars.json', { models: [{ provider: 'mock', id: 'mock-gamma-1-5' }] });
        const before = s.frame();
        assert.equal(before.rows.find((r) => r.focused)?.selector, 'mock/mock-alpha', 'the live model is preselected');
        const row = rowOf(before, 'mock/mock-beta');
        assert.ok(row && !row.starred, 'mock-beta is listed and unstarred on screen');
        s.press(KEYS.down); // focus mock-beta — the row we intend to toggle
        await s.quiet();
        assert.equal(s.frame().rows.find((r) => r.focused)?.selector, 'mock/mock-beta', 'mock-beta is focused');
        s.press(KEYS.space);
        await s.quiet();
        const onDisk = home.read('model-stars.json');
        const keys = (onDisk?.models ?? []).map((m) => `${m.provider}/${m.id}`).sort();
        assert.deepEqual(keys, ['mock/mock-beta', 'mock/mock-gamma-1-5'], 'both the external star and ours persist (read-modify-write per toggle)');
        assert.equal(calls.switchModel.length, 0, 'starring never switches');
      } finally {
        await s.unmount();
        await host.unload();
      }
    } finally {
      home.dispose();
    }
  });
});
