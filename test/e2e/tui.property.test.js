// Property suite: fast-check generated key/command sequences against the REAL
// patched dsh-TUI on a private tmux socket (test/e2e/dsh-tui.js). The oracle is
// independent of lib/: the expected query, starred set and live route are
// tracked here; rows, focus, counts and the warning are parsed from the frame;
// model-stars.json / model-recents.json / model.json on disk are read directly.
// Invariants are checked after EVERY command. Replay: FC_SEED=<seed> (printed
// on failure together with the shrunk counterexample). Budgets: TUI_PROP_LAUNCH
// / TUI_PROP_CHAT / TUI_PROP_BUSY / TUI_PROP_RESTART sequences per group.
//
// Frame facts (verified against the real patched dsh-TUI 0.14.0, see
// test/e2e/dump-frame.mjs): rows are `│ <focus char><star char> provider/id[ ✓]
// <ctx>[ ◫] │`; the search line is `⌕ > <query|placeholder> <matches>/<catalog>`;
// the sidebar's active scope carries the ❯. This profile's real llm catalog has
// 6 models (the two mock providers plus dsh's deepseek-official registry
// provider), so row ids are treated as opaque; their ids carry every token the
// generator can type, which keeps the soundness check exact for this fixture
// modulo omp's tolerances (one adjacent letter/digit swap; a token may
// overshoot a word by up to two trailing characters — soundlyMatches below is
// aligned with the fast suite's documented oracle; the stricter plain
// subsequence was a suite bug found by the release campaign, dms-0ll.13).
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { writeFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { makeProfile, sleep, startMock, startTui } from './dsh-tui.js';

const SCENE = /⌕ >/u;
const EXPECTED_TOTAL = 6; // fixture fact: 3 mock + 1 mock2 + 2 deepseek-official models
const LIVE0 = 'mock/mock-alpha';
const STAR_TARGETS = ['mock/mock-alpha', 'mock/mock-beta', 'mock/mock-gamma-1-5', 'mock2/other-delta'];
const ISOLATING_QUERY = { 'mock/mock-alpha': 'alpha', 'mock/mock-beta': 'beta', 'mock/mock-gamma-1-5': 'gamma', 'mock2/other-delta': 'delta' };
const ALPHA = ['m', 'o', 'c', 'k', 'a', 'l', 'p', 'h', 'b', 'e', 't', 'g', '1', '5', '-', 'z'];
const SEED = Number(process.env.FC_SEED ?? 20261012);
const N_LAUNCH = Number(process.env.TUI_PROP_LAUNCH ?? 15);
const N_CHAT = Number(process.env.TUI_PROP_CHAT ?? 10);
const N_BUSY = Number(process.env.TUI_PROP_BUSY ?? 6);
const N_RESTART = Number(process.env.TUI_PROP_RESTART ?? 6);

// ---- frame parsing (no lib/ imports) --------------------------------------

// One row: focus char, separator, star char, provider/id, optional ✓, ctx size.
// The focus and star columns are separated by one space; star is '★' or ' '.
const ROW_LINE = /│\s(?<focus>[❯ ])\s(?<star>[★ ])\s+(?<key>[a-z0-9-]+\/[a-z0-9._-]+)(?<live>\s✓)?/giu;
const SEARCH_LINE = /⌕ > ([^\n│]*?)\s+(\d+)\/(\d+)\s*│/u;

export function parseFrame(screen) {
  const rows = [];
  for (const m of screen.matchAll(ROW_LINE)) {
    const { focus, star, key, live } = m.groups;
    rows.push({ focused: focus === '❯', starred: star === '★', key, live: live !== undefined });
  }
  const search = SEARCH_LINE.exec(screen);
  const empty = /⌕ > type a model name/u.test(screen);
  return {
    rows,
    query: search && !empty ? search[1].trim() : '',
    n: search ? Number(search[2]) : undefined,
    total: search ? Number(search[3]) : undefined,
    warning: /⚠ ([^\n│]+)/u.exec(screen)?.[1]?.trim(),
  };
}

const subseq = (needle, hay) => {
  let i = 0;
  for (const c of hay) if (c === needle[i]) i += 1;
  return i >= needle.length;
};
const token = (q) => [...q].filter((c) => /[a-z0-9]/i.test(c)).join('').toLowerCase();
const hayOf = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, ''); // ids carry the generator's tokens

/** omp's typo tolerances, mirroring the fast suite's documented oracle
 * (test/selector.property.test.js): at most one adjacent letter/digit swap and
 * a token may overshoot a word by up to two trailing characters. Found by the
 * release campaign (dms-0ll.13): the plain-subsequence oracle here was
 * stricter than the product's ported omp matcher and flagged rows like
 * mock/mock-gamma-1-5 for a query '1z' (the '1' word plus a two-char
 * overshoot) that the fast suite correctly accepts. */
const swaps = (needle) => {
  const chars = [...needle];
  const out = [needle];
  for (let i = 0; i < chars.length - 1; i += 1) {
    const a = chars[i];
    const b = chars[i + 1];
    if ((/[a-z]/.test(a) && /\d/.test(b)) || (/\d/.test(a) && /[a-z]/.test(b))) {
      out.push(chars.slice(0, i).concat(b, a, chars.slice(i + 2)).join(''));
    }
  }
  return out;
};
function soundlyMatches(query, key) {
  const t = token(query);
  return t === '' || swaps(t).some((variant) => subseq(variant.slice(0, Math.max(1, variant.length - 2)), hayOf(key)));
}

// ---- the model (expected screen state), independent of lib/ ---------------

class Model {
  constructor() {
    this.open = false;
    this.query = '';
    this.stars = new Set();
    this.live = LIVE0;
    // Focus expectation for the next frame: { index } or { key }, null = resync.
    this.focus = null;
  }
}

/** Structural + cross-oracle invariants, after every command. */
function assertInvariants(screen, model, tag) {
  if (!model.open) {
    assert.doesNotMatch(screen, SCENE, `${tag}: scene closed`);
    model.focus = null;
    return;
  }
  assert.match(screen, /╭─ Models /u, `${tag}: scene frame top`);
  const f = parseFrame(screen);
  const ctx = `${tag}: q=${JSON.stringify(model.query)}`;
  assert.equal(f.query, model.query, `${ctx}: query echo`);
  assert.ok(f.n <= f.total && f.total <= EXPECTED_TOTAL, `${ctx}: total is the active scope's candidate count (${f.n}/${f.total})`);
  const keys = f.rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, `${ctx}: rows unique`);
  assert.equal(f.n, f.rows.length, `${ctx}: search-line n equals listed rows (list always fits)`);
  const focused = f.rows.filter((r) => r.focused);
  assert.ok(f.rows.length === 0 || focused.length === 1, `${ctx}: exactly one focused row when n>0 (got ${focused.length})`);
  assert.ok(f.rows.length > 0 || focused.length === 0, `${ctx}: no focus when n=0`);
  for (const r of f.rows) {
    assert.equal(r.starred, model.stars.has(r.key), `${ctx}: ★ of ${r.key} matches the starred set`);
    assert.equal(r.live, r.key === model.live, `${ctx}: ✓ only on the live route (${r.key})`);
    assert.ok(soundlyMatches(model.query, r.key), `${ctx}: row ${r.key} matches query tokens (soundness, omp tolerances)`);
  }
  if (model.focus && f.rows.length > 0) {
    if (model.focus.key !== undefined) assert.equal(focused[0]?.key, model.focus.key, `${ctx}: focused row key`);
    else assert.equal(f.rows.indexOf(focused[0]), model.focus.index, `${ctx}: focused row index`);
  }
  if (f.rows.length === 0) model.focus = null;
}

/** Wait until the stars file equals the expected set (the TUI writes async to us). */
async function starsFileIs(profile, model, tag) {
  const expected = { models: [...model.stars].map((k) => { const [provider, id] = k.split('/'); return { provider, id }; }) };
  for (let i = 0; i < 20; i += 1) {
    const got = profile.read('model-stars.json');
    const absent = got === undefined && expected.models.length === 0; // no toggle yet: no file
    if (absent || JSON.stringify(got) === JSON.stringify(expected)) return got;
    await sleep(100);
  }
  assert.deepEqual(profile.read('model-stars.json'), expected, `${tag}: model-stars.json on disk`);
  return undefined;
}

async function waitModelIs(profile, key, tag) {
  for (let i = 0; i < 60; i += 1) {
    if (profile.read('model.json')?.model === key.split('/')[1]) return;
    await sleep(100);
  }
  assert.equal(profile.read('model.json')?.model, key.split('/')[1], `${tag}: route persisted`);
}

async function openScene(tui, { typed = false } = {}) {
  if (typed) {
    tui.text('/model');
    await sleep(300);
    tui.keys('Enter');
  } else {
    tui.keys('M-p');
  }
  await tui.waitFor(SCENE, { timeout: 20000 });
  await sleep(600); // catalog load; invariants re-sync from the screen
}

async function closeScene(tui) {
  for (let i = 0; i < 4; i += 1) {
    tui.keys('Escape');
    await sleep(250);
    if (!SCENE.test(tui.capture())) return;
  }
  assert.doesNotMatch(tui.capture(), SCENE, 'scene closed after escape presses');
}

// ---- command machine -------------------------------------------------------

const commandArb = fc.oneof(
  { arbitrary: fc.constant({ t: 'backspace' }), weight: 3 },
  { arbitrary: fc.constant({ t: 'clear' }), weight: 1 },
  { arbitrary: fc.constant({ t: 'up' }), weight: 4 },
  { arbitrary: fc.constant({ t: 'down' }), weight: 4 },
  { arbitrary: fc.constant({ t: 'home' }), weight: 1 },
  { arbitrary: fc.constant({ t: 'end' }), weight: 1 },
  { arbitrary: fc.constant({ t: 'hopNext' }), weight: 2 },
  { arbitrary: fc.constant({ t: 'hopPrev' }), weight: 1 },
  { arbitrary: fc.constant({ t: 'space' }), weight: 4 },
  { arbitrary: fc.constant({ t: 'escape' }), weight: 2 },
  { arbitrary: fc.constant({ t: 'enter' }), weight: 2 },
  { arbitrary: fc.constantFrom(...ALPHA).map((c) => ({ t: 'type', c })), weight: 8 },
);
const cmdLabel = (cmd) => (cmd.t === 'type' ? `type ${JSON.stringify(cmd.c)}` : cmd.t);

async function runCommand(tui, profile, model, cmd, tag) {
  if (!model.open) {
    await openScene(tui);
    model.open = true;
    model.query = '';
    model.focus = null; // landing scope/list unknown; resync from the screen
  }
  await sleep(150);
  const before = parseFrame(tui.capture());
  const focusKey = before.rows.find((r) => r.focused)?.key;
  switch (cmd.t) {
    case 'type': {
      tui.text(cmd.c);
      model.query += cmd.c;
      model.focus = { index: 0 }; // every query change focuses the first result
      break;
    }
    case 'backspace': {
      tui.keys('BSpace');
      model.query = [...model.query].slice(0, -1).join('');
      model.focus = { index: 0 };
      break;
    }
    case 'clear': {
      tui.keys('C-u');
      model.query = '';
      model.focus = { index: 0 };
      break;
    }
    case 'up': case 'down': case 'home': case 'end': {
      tui.keys({ up: 'Up', down: 'Down', home: 'Home', end: 'End' }[cmd.t]);
      if (before.rows.length > 0) {
        const at = before.rows.findIndex((r) => r.focused);
        const to = cmd.t === 'up' ? Math.max(0, at - 1)
          : cmd.t === 'down' ? Math.min(at + 1, before.rows.length - 1)
            : cmd.t === 'home' ? 0 : before.rows.length - 1;
        model.focus = { key: before.rows[to].key };
      }
      break;
    }
    case 'hopNext': case 'hopPrev': {
      tui.keys(cmd.t === 'hopNext' ? 'Tab' : 'BTab');
      model.focus = null; // target scope not predicted; structural invariants still hold
      break;
    }
    case 'space': {
      tui.keys('Space');
      if (focusKey) {
        if (model.stars.has(focusKey)) model.stars.delete(focusKey); else model.stars.add(focusKey);
        model.focus = { key: focusKey }; // toggles in place and keeps focus (P-11)
      }
      break;
    }
    case 'escape': {
      tui.keys('Escape');
      if (model.query !== '') { model.query = ''; model.focus = { index: 0 }; }
      else model.open = false;
      break;
    }
    case 'enter': {
      tui.keys('Enter');
      if (before.rows.length === 0) break; // no focused row: no-op
      const target = focusKey;
      model.open = false;
      if (target !== model.live) {
        await waitModelIs(profile, target, tag + ' enter-pick');
        model.live = target;
        // recordRecent runs right after the host's switch completes; poll
        // the file like starsFileIs instead of racing a one-shot read (a
        // campaign run saw model.json update before recents landed).
        let recents;
        for (let i = 0; i < 30; i += 1) {
          recents = profile.read('model-recents.json');
          if (recents && recents.models[0] !== undefined && recents.models[0].provider + '/' + recents.models[0].id === target) break;
          await sleep(100);
        }
        assert.ok(recents !== undefined, tag + ': model-recents.json exists after pick');
        assert.equal(recents.models[0].provider + '/' + recents.models[0].id, target, tag + ': recents front after pick');
      }
      break;
    }
    default: throw new Error(`unknown command ${JSON.stringify(cmd)}`);
  }
  await sleep(350);
  const after = tui.capture();
  assertInvariants(after, model, `${tag} after ${cmdLabel(cmd)}`);
  if (cmd.t === 'space') await starsFileIs(profile, model, `${tag} after space`);
  if (cmd.t === 'enter' && before.rows.length > 0) assert.doesNotMatch(after, SCENE, `${tag}: scene closed after pick`);
}

/** A fresh real TUI per generated case (fresh fixture per case and shrink). */
/** Submit a prompt on the launch/chat composer. The historical Launchpad
 * Enter drop (text+Enter in one burst gets eaten about half the time) makes
 * single-burst submits flaky; setup prompts are not a property under test, so
 * retry Enter until the mock actually sees the request. */
async function submitPrompt(tui, mock, text, { retries = 4 } = {}) {
  tui.text(text);
  await sleep(300);
  tui.keys('Enter');
  for (let i = 0; i < retries; i += 1) {
    let seen = false;
    for (let k = 0; k < 30 && !(seen = mock.requests.some((r) => JSON.stringify(r.messages ?? []).includes(text))); k += 1) await sleep(100);
    if (seen) return;
    tui.keys('Enter');
    await sleep(600);
  }
  const payload = 'premise: ' + JSON.stringify(text) + ' was submitted to the mock';
  assert.ok(mock.requests.some((r) => JSON.stringify(r.messages ?? []).includes(text)), payload);
}
async function withFixture(kind, run) {
  const mock = await startMock();
  const profile = makeProfile({ port: mock.port });
  let tui = startTui(profile);
  try {
    await tui.waitFor(/Say something/u, { timeout: 60000 });
    if (kind === 'chat') {
      await submitPrompt(tui, mock, 'warm the chat');
      await tui.waitFor(/pong from mock-alpha/u, { timeout: 20000 });
    }
    await run(tui, profile, mock);
  } catch (e) {
    let screen = '';
    try { screen = tui.capture(); } catch { /* gone */ }
    e.message += `\n--- screen at failure ---\n${screen.slice(0, 2500)}`;
    throw e;
  } finally {
    try { tui.kill(); tui.killServer(); } catch { /* gone */ }
    await mock.close();
    profile.dispose();
  }
}

async function runSequence(kind, cmds, tagPrefix, opener = 'mp') {
  await withFixture(kind, async (tui, profile) => {
    const model = new Model();
    await openScene(tui, { typed: opener === 'typed' });
    model.open = true;
    model.query = '';
    assertInvariants(tui.capture(), model, `${tagPrefix} open`);
    let n = 0;
    for (const cmd of cmds) {
      if (cmd.t === 'escape' && !model.open) continue; // already closed; reopen on next need
      await runCommand(tui, profile, model, cmd, `${tagPrefix}#${n}`);
      n += 1;
    }
  });
}

// ---- suites -----------------------------------------------------------------

describe('dsh-model-selector TUI properties (real host, private tmux socket)', { concurrency: 1, timeout: 1800000 }, () => {
  before(async () => {
    if (!process.env.DSH_TUI_DIR) throw new Error('set DSH_TUI_DIR to the patched dsh-tui build');
  });

  it(`generated sequences on the launch page (seed ${SEED}, ${N_LAUNCH} sequences)`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('mp', 'typed'), fc.array(commandArb, { minLength: 1, maxLength: 10 }), async (opener, cmds) => {
        await runSequence('launch', cmds, 'seq', opener);
      }),
      { seed: SEED, numRuns: N_LAUNCH, endOnFailure: true },
    );
  });

  it(`generated sequences in chat (seed ${SEED + 1}, ${N_CHAT} sequences)`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(commandArb, { minLength: 1, maxLength: 10 }), async (cmds) => {
        await runSequence('chat', cmds, 'chat');
      }),
      { seed: SEED + 1, numRuns: N_CHAT, endOnFailure: true },
    );
  });

  it(`busy turn refuses picks, route unchanged, turn completes (seed ${SEED + 2}, ${N_BUSY} sequences)`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(2), async (downs) => {
        await withFixture('chat', async (tui, prof, m) => {
          m.hold(true);
          await submitPrompt(tui, m, 'busy probe');
          await openScene(tui);
          for (let i = 0; i < downs; i += 1) { tui.keys('Down'); await sleep(200); }
          tui.keys('Enter');
          await tui.waitFor(/⚠ A turn is running/u, { timeout: 20000 });
          await sleep(300);
          const route = prof.read('model.json');
          assert.equal(`${route.provider}/${route.model}`, LIVE0, 'route unchanged while busy');
          await closeScene(tui);
          m.hold(false);
          await tui.waitFor(/pong from mock-alpha/u, { timeout: 20000 });
        });
      }),
      { seed: SEED + 2, numRuns: N_BUSY, endOnFailure: true },
    );
  });

  it(`stars survive a full TUI restart; landing scope is Starred (seed ${SEED + 3}, ${N_RESTART} sequences)`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.set(fc.constantFrom(...STAR_TARGETS), { minLength: 0, maxLength: 4 }),
        fc.boolean(),
        async (targets, unstarAfterRestart) => {
          await withFixture('launch', async (tui, prof) => {
            let handle = { tui };
            const model = new Model();
            const starOne = async (key) => {
              await closeScene(handle.tui);
              await openScene(handle.tui);
              handle.tui.text(ISOLATING_QUERY[key]);
              model.query = ISOLATING_QUERY[key];
              await sleep(500);
              const f = parseFrame(handle.tui.capture());
              if (!f.rows.some((r) => r.key === key && r.focused)) {
                writeFileSync(`/tmp/prop-isolate-fail-${key.replaceAll('/', '-')}.txt`, handle.tui.capture());
              }
              assert.ok(f.rows.some((r) => r.key === key && r.focused), `isolating query focuses ${key}`);
              handle.tui.keys('Space');
              model.stars.add(key);
              await starsFileIs(prof, model, `star ${key}`);
            };
            await openScene(handle.tui);
            for (const key of targets) await starOne(key);
            // Restart the whole TUI on the same profile.
            handle.tui.kill();
            handle.tui = startTui(prof);
            await handle.tui.waitFor(/Say something/u, { timeout: 60000 });
            await openScene(handle.tui);
            if (targets.length > 0) {
              const screen = await handle.tui.waitFor(/★ mock\/|★ mock2\//u, { timeout: 15000 });
              assert.match(screen, /❯ ★ Starred\s+\d+/u, 'lands on Starred when stars exist');
              model.open = true; model.query = '';
              assertInvariants(screen, model, 'after restart');
            }
            const afterRestart = prof.read('model-stars.json');
            const expectedStars = { models: [...model.stars].map((k) => { const [provider, id] = k.split('/'); return { provider, id }; }) };
            assert.ok(afterRestart === undefined ? expectedStars.models.length === 0 : JSON.stringify(afterRestart) === JSON.stringify(expectedStars), `stars file after restart: ${JSON.stringify(afterRestart)}`);
            if (unstarAfterRestart && targets.length > 0) {
              const victim = [...model.stars][0];
              await closeScene(handle.tui);
              await openScene(handle.tui);
              handle.tui.text(ISOLATING_QUERY[victim]);
              await sleep(500);
              handle.tui.keys('Space');
              model.stars.delete(victim);
              await starsFileIs(prof, model, 'unstar after restart');
            }
          });
        },
      ),
      { seed: SEED + 3, numRuns: N_RESTART, endOnFailure: true },
    );
  });
});
