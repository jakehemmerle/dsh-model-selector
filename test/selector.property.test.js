// Model-based property tests through the public surface: the plugin is loaded
// into real dsh-TUI scene/shortcut runtimes, its scene is opened by the host,
// and arbitrary keystroke sequences are typed into a headless terminal.
// Every step checks the rendered frame, the ChannelUi calls, and the files the
// plugin owns or shares under $HOME/.dsh-tui.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fc from 'fast-check';
import { queryChar, scenario, selectorOf } from './arbitraries.js';
import { bootHost, fakeChannel, isSubsequence, isolatedHome, KEYS, openScene, words } from './harness.js';

const NUM_RUNS = Number(process.env.NUM_RUNS ?? 25);
const STARS = 'model-stars.json';
const RECENTS = 'model-recents.json';

const refKey = (ref) => `${ref.provider}/${ref.id}`;

/** ALT-NUM swap variants (omp's typo tolerance: "gpt5" ~ "gtp5" is not, "5gpt" ~ "g5pt"). */
function swaps(token) {
  const out = [token];
  for (let i = 0; i < token.length - 1; i += 1) {
    const a = token[i];
    const b = token[i + 1];
    if ((/[a-z]/.test(a) && /\d/.test(b)) || (/\d/.test(a) && /[a-z]/.test(b))) out.push(token.slice(0, i) + b + a + token.slice(i + 2));
  }
  return out;
}

/**
 * Soundness oracle: a listed model contains every query token as a
 * subsequence — modulo omp's tolerances (one letter/digit swap, and a token
 * may overshoot a whole word by up to two trailing characters).
 */
function soundlyMatches(query, selector) {
  const compact = words(selector).join('');
  return words(query).every((token) => swaps(token).some((variant) => (
    isSubsequence(variant.slice(0, Math.max(1, variant.length - 2)), compact))));
}

/** Completeness oracle: if every token sits inside one word of the selector, it MUST match. */
function mustMatch(query, selector) {
  const ws = words(selector);
  return words(query).every((token) => ws.some((w) => w.includes(token)));
}

function deleteWord(query) {
  return query.replace(/[^\p{Letter}\p{Number}]*$/u, '').replace(/[\p{Letter}\p{Number}]*$/u, '');
}

// ── the reference model ────────────────────────────────────────────────────
// What a user can predict without knowing the ranking: the query text, the
// starred set, whether the scene is open, and what Enter must have done.

function invariants(model, real) {
  const { s, cols } = real;
  const f = s.frame();
  const lines = s.lines();
  const catalogKeys = new Set(real.models.map(selectorOf));
  const starredInCatalog = [...model.stars].filter((key) => catalogKeys.has(key));

  // Layout: one bordered frame, intact on every edge (nothing overflowed/wrapped).
  assert.match(f.title, /^╭─ Models /u, 'title border');
  assert.ok(f.title.endsWith('╮'), `title border closed: ${f.title}`);
  const bottom = lines.findLastIndex((line) => line.startsWith('╰'));
  assert.ok(bottom > 0 && lines[bottom].endsWith('╯'), 'bottom border');
  for (const line of lines.slice(1, bottom)) assert.match(line, /^[│├]/u, `side border intact: ${JSON.stringify(line)}`);
  for (const line of lines) assert.ok([...line].length <= cols, 'no line exceeds the terminal');

  // The query box shows exactly what was typed.
  assert.equal(f.query, model.query, 'search line echoes the query');

  // Sidebar: on the RIGHT, "Starred" first, "All models", one entry per provider.
  assert.ok(f.sidebarX > cols / 2, `sidebar sits on the right (x=${f.sidebarX})`);
  assert.equal(f.sidebar[0]?.label, 'Starred', 'Starred heads the sidebar');
  const all = f.sidebar.find((e) => e.label === 'All models');
  assert.ok(all, 'All models entry');
  const providerEntries = f.sidebar.filter((e) => e.icon === '●' || e.icon === '○');
  assert.deepEqual(new Set(providerEntries.map((e) => e.label)), new Set(real.providerLabels), 'one entry per provider');
  assert.equal(providerEntries.reduce((n, e) => n + (e.count ?? 0), 0), all.count, 'provider counts sum to All models');
  const starredEntry = f.sidebar[0];
  if (model.query === '') {
    assert.equal(starredEntry.count, starredInCatalog.length, 'Starred count = starred catalog models');
    assert.equal(all.count, real.models.length, 'All models count = catalog size');
  } else {
    assert.ok(starredEntry.count <= starredInCatalog.length);
  }
  assert.equal(f.sidebar.filter((e) => e.active).length, 1, 'exactly one active scope');

  // The list: n/total on the search line agrees with the active scope's count.
  const active = f.sidebar.find((e) => e.active);
  assert.equal(f.matches, active.count ?? f.matches, 'n matches = active scope count');
  if (f.matches > 0) {
    assert.equal(f.rows.filter((r) => r.focused).length, 1, 'exactly one focused row');
    assert.ok(!f.empty);
  } else {
    assert.equal(f.rows.length, 0, 'no rows when nothing matches');
    assert.ok(f.empty || active.label === 'Starred' || active.label === 'Recent', 'empty state shown');
  }
  assert.ok(f.rows.length <= f.matches, 'never more rows than matches');

  for (const row of f.rows) {
    assert.ok(catalogKeys.has(row.selector), `row ${row.selector} is a catalog model`);
    assert.equal(row.starred, model.stars.has(row.selector), `star glyph for ${row.selector}`);
    assert.equal(row.current, row.selector === real.currentKey, `current marker for ${row.selector}`);
    if (model.query !== '') assert.ok(soundlyMatches(model.query, row.selector), `${row.selector} matches "${model.query}"`);
    if (active.label === 'Starred') assert.ok(model.stars.has(row.selector), 'Starred scope lists only starred');
    if (providerEntries.some((e) => e.label === active.label)) {
      const id = real.providerIdByLabel.get(active.label);
      assert.ok(row.selector.startsWith(`${id}/`), 'provider scope lists only that provider');
    }
  }

  // Completeness on All models.
  if (active.label === 'All models' && model.query !== '') {
    const required = real.models.map(selectorOf).filter((key) => mustMatch(model.query, key));
    assert.ok(f.matches >= required.length, `all ${required.length} plain matches counted (got ${f.matches})`);
    if (f.matches <= f.rows.length) for (const key of required) assert.ok(f.rows.some((r) => r.selector === key), `${key} listed`);
  }

  // Disk: the stars file holds exactly the starred set plus untouched phantoms.
  if (model.starsTouched) {
    const file = real.home.read(STARS);
    const onDisk = new Set((file?.models ?? []).map(refKey));
    assert.deepEqual(onDisk, new Set([...model.stars, ...real.phantoms]), 'stars file = starred set ∪ phantoms');
  }
}

class Cmd {
  constructor(label, keys, update) { this.label = label; this.keys = keys; this.update = update; }
  check(model) { return model.open; }
  async run(model, real) {
    const before = real.s.frame();
    real.prev = before;
    await real.s.press(this.keys);
    this.update?.(model, real, before);
    if (model.open) {
      assert.ok(real.s.open, `${this.label}: scene still open`);
      invariants(model, real);
      this.after?.(model, real, before, real.s.frame());
    } else {
      assert.ok(!real.s.open, `${this.label}: scene closed`);
    }
  }
  toString() { return this.label; }
}

const typeChar = (ch) => Object.assign(new Cmd(`type(${ch})`, ch, (m) => { m.query += ch; }), {
  after(model, real, before, now) {
    if (now.matches > 0) assert.equal(now.rows[0]?.focused, true, 'typing focuses the first result');
    if (before.query === '' && (before.scope === 'Starred' || before.scope === 'Recent')) {
      assert.equal(now.scope, 'All models', 'typing from Starred/Recent searches All models');
    }
  },
});

const editCmds = [
  new Cmd('backspace', KEYS.backspace, (m) => { m.query = m.query.slice(0, -1); }),
  new Cmd('ctrl+u', KEYS.ctrlU, (m) => { m.query = ''; }),
  new Cmd('ctrl+w', KEYS.ctrlW, (m) => { m.query = deleteWord(m.query); }),
];

function step(label, keys, direction) {
  return Object.assign(new Cmd(label, keys), {
    after(_m, _r, before, now) {
      if (before.scope !== now.scope || before.matches !== now.matches) return;
      const i = before.rows.findIndex((r) => r.focused);
      if (i < 0) return;
      const j = i + direction;
      if (j >= 0 && j < before.rows.length) assert.equal(now.focused?.selector, before.rows[j].selector, `${label} moves one row`);
    },
  });
}

const moveCmds = [
  step('down', KEYS.down, +1),
  step('up', KEYS.up, -1),
  new Cmd('pageDown', KEYS.pageDown),
  new Cmd('pageUp', KEYS.pageUp),
  Object.assign(new Cmd('home', KEYS.home), { after(_m, _r, _b, now) { if (now.matches > 0) assert.equal(now.rows[0].focused, true, 'home → first'); } }),
  Object.assign(new Cmd('end', KEYS.end), { after(_m, _r, _b, now) { if (now.matches > 0) assert.equal(now.rows.at(-1).focused, true, 'end → last'); } }),
];

function scopeHop(label, keys, direction) {
  return Object.assign(new Cmd(label, keys), {
    after(_m, _r, before, now) {
      const entries = before.sidebar;
      const from = entries.findIndex((e) => e.active);
      const candidates = [];
      for (let k = 1; k <= entries.length; k += 1) {
        const e = entries[(from + direction * k + entries.length * k) % entries.length];
        if ((e.count ?? 0) > 0) { candidates.push(e.label); break; }
      }
      const expected = candidates[0] ?? before.scope;
      assert.equal(now.scope, expected, `${label} hops to the next non-empty scope`);
      if (now.matches > 0) assert.ok(now.focused, 'a row is focused after a hop');
    },
  });
}

const scopeCmds = [
  scopeHop('tab', KEYS.tab, +1),
  scopeHop('shift+tab', KEYS.shiftTab, -1),
  scopeHop('right', KEYS.right, +1),
  scopeHop('left', KEYS.left, -1),
];

const starCmd = Object.assign(new Cmd('space', KEYS.space, (m, real, before) => {
  const key = before.focused?.selector;
  if (!key) return;
  m.starsTouched = true;
  if (m.stars.has(key)) m.stars.delete(key); else m.stars.add(key);
}), {
  after(model, _real, before, now) {
    const key = before.focused?.selector;
    if (!key) return;
    const row = now.rows.find((r) => r.selector === key);
    if (row) assert.equal(row.starred, model.stars.has(key), 'space toggled the star in place');
    if (row && before.scope !== 'Starred') assert.ok(row.focused, 'focus stays on the starred row');
  },
});

const escapeCmd = new Cmd('escape', KEYS.escape, (m, real) => {
  if (m.query !== '') { m.query = ''; return; }
  m.open = false;
  assert.equal(real.calls.switchModel.length, m.switches, 'escape never switches');
});

const enterCmd = new Cmd('enter', KEYS.enter, (m, real, before) => {
  const key = before.focused?.selector;
  if (!key) return; // nothing to pick: stays open
  if (real.working) {
    assert.ok(real.calls.notify.some((n) => /running|turn/i.test(n.text)), 'enter while working explains the refusal');
    return;
  }
  m.open = false;
  if (key === real.currentKey) {
    assert.equal(real.calls.switchModel.length, m.switches, 'picking the live model does not fork the session');
    return;
  }
  m.switches += 1;
  assert.equal(real.calls.switchModel.length, m.switches, 'enter switches exactly once');
  assert.equal(refKey(real.calls.switchModel.at(-1)), key, 'enter switches to the focused model');
});

const commands = [
  queryChar.map(typeChar),
  fc.constantFrom(...editCmds),
  fc.constantFrom(...moveCmds),
  fc.constantFrom(...scopeCmds),
  fc.constant(starCmd),
  fc.constant(escapeCmd),
  fc.constant(enterCmd),
];

async function setup(input) {
  const catalogKeys = new Set(input.models.map(selectorOf));
  const phantomStars = [...new Map(input.phantomStars.filter((r) => !catalogKeys.has(refKey(r))).map((r) => [refKey(r), r])).values()];
  const sc = { ...input, phantomStars };
  const home = isolatedHome();
  home.write(STARS, { models: [...sc.starred, ...sc.phantomStars].map(({ provider, id }) => ({ provider, id })) });
  home.write(RECENTS, { models: sc.recents.map(({ provider, id }) => ({ provider, id })) });
  const host = await bootHost();
  const { channel, calls } = fakeChannel({
    models: sc.models, providers: sc.providers,
    provider: sc.current?.provider ?? '', model: sc.current?.id ?? '', working: sc.working,
  });
  const s = await openScene(host, channel, { cols: sc.cols, rows: sc.rows });
  const providerLabels = sc.providers.map((p) => p.name);
  const real = {
    s, host, home, calls, cols: sc.cols, models: sc.models, working: sc.working,
    currentKey: sc.current ? selectorOf(sc.current) : undefined,
    phantoms: sc.phantomStars.map(refKey),
    providerLabels,
    providerIdByLabel: new Map(sc.providers.map((p) => [p.name, p.id])),
  };
  const model = { open: true, query: '', stars: new Set(sc.starred.map(selectorOf)), starsTouched: false, switches: 0 };
  return { model, real };
}

async function teardown(real) {
  await real.s.unmount();
  await real.host.unload();
  real.home.dispose();
}

describe('model selector scene (model-based, through the host)', () => {
  it('lands on Starred (or All models), preselects the live model, and is ready to type', async () => {
    await fc.assert(fc.asyncProperty(scenario, async (sc) => {
      const { model, real } = await setup(sc);
      try {
        invariants(model, real);
        const f = real.s.frame();
        const starredInCatalog = sc.starred.length > 0;
        assert.equal(f.scope, starredInCatalog ? 'Starred' : 'All models', 'landing scope');
        const currentInScope = real.currentKey && (!starredInCatalog || model.stars.has(real.currentKey));
        if (currentInScope && f.rows.some((r) => r.selector === real.currentKey)) {
          assert.equal(f.focused?.selector, real.currentKey, 'live model preselected');
        }
        assert.match(f.hints, /space/u, 'hint row mentions space (star)');
      } finally { await teardown(real); }
    }), { numRuns: Math.max(8, Math.floor(NUM_RUNS / 2)) });
  });

  it('every keystroke sequence keeps frame, channel and disk consistent', async () => {
    await fc.assert(fc.asyncProperty(scenario, fc.commands(commands, { maxCommands: 22 }), async (sc, cmds) => {
      const { model, real } = await setup(sc);
      try {
        await fc.asyncModelRun(() => ({ model, real }), cmds);
        // Recents: a real switch moves the model to the front of dsh-TUI's own list.
        if (model.switches > 0) {
          const last = real.calls.switchModel.at(-1);
          assert.equal(refKey(real.home.read(RECENTS).models[0]), refKey(last), 'switch recorded in model-recents.json');
        }
      } finally { await teardown(real); }
    }), { numRuns: NUM_RUNS });
  });

  it('starring survives closing the scene and reloading the plugin', async () => {
    await fc.assert(fc.asyncProperty(scenario, fc.array(fc.constantFrom('space', 'down', 'tab'), { minLength: 1, maxLength: 10 }), async (sc, keys) => {
      const { model, real } = await setup(sc);
      try {
        for (const k of keys) {
          const cmd = k === 'space' ? starCmd : k === 'down' ? moveCmds[0] : scopeCmds[0];
          await cmd.run(model, real);
        }
        await real.s.unmount();
        await real.host.unload();
        const host = await bootHost();
        const { channel } = fakeChannel({ models: sc.models, providers: sc.providers });
        const s = await openScene(host, channel, { cols: sc.cols, rows: sc.rows });
        real.s = s; real.host = host; real.currentKey = undefined;
        const catalogKeys = new Set(sc.models.map(selectorOf));
        const f = s.frame();
        assert.equal(f.sidebar[0].count, [...model.stars].filter((k) => catalogKeys.has(k)).length, 'stars restored after reload');
        for (const row of f.rows) assert.equal(row.starred, model.stars.has(row.selector));
      } finally { await teardown(real); }
    }), { numRuns: Math.max(6, Math.floor(NUM_RUNS / 3)) });
  });

  it('any stars-file content opens cleanly and the next toggle writes a valid file', async () => {
    const junk = fc.oneof(fc.string(), fc.json(), fc.constant('{"models":[{"provider":"a"},{"provider":"zai","id":"glm-5"},7,null]}'));
    await fc.assert(fc.asyncProperty(scenario.filter((sc) => sc.models.length > 0), junk, async (sc, content) => {
      const { model, real } = await setup({ ...sc, starred: [], phantomStars: [] });
      try {
        await real.s.unmount();
        real.home.write(STARS, content);
        const { channel } = fakeChannel({ models: sc.models, providers: sc.providers });
        real.s = await openScene(real.host, channel, { cols: sc.cols, rows: sc.rows });
        real.currentKey = undefined;
        let prior = [];
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed?.models)) {
            prior = parsed.models.filter((r) => typeof r?.provider === 'string' && r.provider && typeof r?.id === 'string' && r.id).map(refKey);
          }
        } catch { /* invalid JSON reads as empty */ }
        const catalogKeys = new Set(sc.models.map(selectorOf));
        model.stars = new Set(prior.filter((k) => catalogKeys.has(k)));
        real.phantoms = [...new Set(prior.filter((k) => !catalogKeys.has(k)))];
        real.s.frame();
        await starCmd.run(model, real);
        const written = real.home.read(STARS);
        assert.ok(Array.isArray(written?.models), 'rewritten as { models: [...] }');
      } finally { await teardown(real); }
    }), { numRuns: Math.max(6, Math.floor(NUM_RUNS / 3)) });
  });
});
