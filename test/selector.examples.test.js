// Example tests ported from oh-my-pi's model hub / picker / browser suites
// (packages/coding-agent/test/model-{hub,picker,browser}.test.ts), restated
// for this scene and driven through the same public surface as the
// property suite.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bootHost, fakeChannel, fakeLlmService, isolatedHome, KEYS, openScene } from './harness.js';

const m = (provider, id, name = id) => ({ provider, id, name });

async function withScene({ models, providers, current, stars = [], recents, working, cols = 140, rows = 30, llm }, body) {
  const home = isolatedHome();
  if (stars.length) home.write('model-stars.json', { models: stars.map(([provider, id]) => ({ provider, id })) });
  if (recents) home.write('model-recents.json', { models: recents.map(([provider, id]) => ({ provider, id })) });
  const provs = providers ?? [...new Set(models.map((x) => x.provider))].map((id) => ({ id, name: id }));
  const host = await bootHost({ llm });
  const { channel, calls } = fakeChannel({ models, providers: provs, provider: current?.[0] ?? '', model: current?.[1] ?? '', working });
  const s = await openScene(host, channel, { cols, rows });
  try {
    await body(s, { calls, home, channel });
  } finally {
    await s.unmount();
    await host.unload();
    home.dispose();
  }
}

describe('search ranking (omp ModelBrowser)', () => {
  it('an exact query match outranks the recently used model', async () => {
    const models = [m('openai-codex', 'gpt-5.6-sol'), m('openai-codex', 'gpt-5.6-luna'), m('openai-codex', 'gpt-5.5'), m('openai-codex', 'gpt-5.4')];
    await withScene({ models, current: ['openai-codex', 'gpt-5.6-sol'], recents: [['openai-codex', 'gpt-5.6-sol'], ['openai-codex', 'gpt-5.6-luna']] }, async (s) => {
      await s.type('gpt-5.5');
      assert.equal(s.frame().focused.selector, 'openai-codex/gpt-5.5');
    });
  });

  it('recent use breaks ties between equally good matches', async () => {
    await withScene({ models: [m('g0i', 'gpt-5.5'), m('zenmux', 'gpt-5.5')], recents: [['zenmux', 'gpt-5.5']] }, async (s) => {
      await s.type('gpt-5.5');
      assert.equal(s.frame().focused.selector, 'zenmux/gpt-5.5');
    });
  });

  it('a starred model wins ties too', async () => {
    await withScene({ models: [m('g0i', 'gpt-5.5'), m('zenmux', 'gpt-5.5')], stars: [['zenmux', 'gpt-5.5']] }, async (s) => {
      await s.type('gpt-5.5');
      assert.equal(s.frame().focused.selector, 'zenmux/gpt-5.5');
    });
  });

  it('versions sort newest first within a provider when nothing is typed', async () => {
    const models = [m('anthropic', 'claude-opus-4-6'), m('anthropic', 'claude-opus-5-5'), m('anthropic', 'claude-opus-5')];
    await withScene({ models }, async (s) => {
      assert.deepEqual(s.frame().rows.map((r) => r.selector), ['anthropic/claude-opus-5-5', 'anthropic/claude-opus-5', 'anthropic/claude-opus-4-6']);
    });
  });

  it('typo tolerance: swapped letter/digit still finds the model', async () => {
    await withScene({ models: [m('zai', 'glm5'), m('zai', 'other')] }, async (s) => {
      await s.type('gl5m');
      assert.equal(s.frame().focused.selector, 'zai/glm5');
    });
  });
});

describe('provider scopes and search (omp ModelHub)', () => {
  const glms = [m('openrouter', 'z-ai/glm-5.2'), m('custom-provider', 'glm-5.2')];

  it('search on All models spans every provider', async () => {
    await withScene({ models: glms }, async (s) => {
      await s.type('glm');
      const keys = s.frame().rows.map((r) => r.selector);
      assert.ok(keys.includes('openrouter/z-ai/glm-5.2') && keys.includes('custom-provider/glm-5.2'));
    });
  });

  it('search inside a provider scope keeps that provider\'s model', async () => {
    await withScene({ models: glms }, async (s, { calls }) => {
      while (s.frame().scope !== 'openrouter') await s.press(KEYS.tab);
      await s.type('glm-5.2');
      await s.press(KEYS.enter);
      assert.deepEqual(calls.switchModel[0], { provider: 'openrouter', id: 'z-ai/glm-5.2' });
    });
  });

  it('a provider scope that loses every match falls back to All models', async () => {
    await withScene({ models: glms }, async (s) => {
      while (s.frame().scope !== 'openrouter') await s.press(KEYS.tab);
      await s.type('does-not-exist');
      const f = s.frame();
      assert.equal(f.scope, 'All models');
      assert.ok(f.empty, 'No matching models');
    });
  });

  it('scope hop skips providers without matches while searching', async () => {
    await withScene({ models: [m('openrouter', 'z-ai/glm-5.2'), m('custom-provider', 'different-model')] }, async (s) => {
      await s.type('z-ai');
      await s.press(KEYS.tab);
      assert.equal(s.frame().scope, 'openrouter');
    });
  });

  it('typing while on Starred searches All models', async () => {
    await withScene({ models: [m('a', 'one'), m('b', 'target')], stars: [['a', 'one']] }, async (s) => {
      assert.equal(s.frame().scope, 'Starred');
      await s.type('targ');
      const f = s.frame();
      assert.equal(f.scope, 'All models');
      assert.equal(f.focused.selector, 'b/target');
    });
  });

  it('provider labels use the registry display name with counts', async () => {
    await withScene({ models: [m('providerproxy', 'x'), m('providerproxy', 'y')], providers: [{ id: 'providerproxy', name: 'ProviderProxy (GPU)' }] }, async (s) => {
      const entry = s.frame().sidebar.find((e) => e.label === 'ProviderProxy (GPU)');
      assert.equal(entry?.count, 2);
    });
  });
});

describe('opening, closing and picking (omp ModelPicker)', () => {
  it('highlights and preselects the session\'s current model; Enter on it closes without forking', async () => {
    const models = [m('test', 'aa-model'), m('test', 'bb-model'), m('test', 'cc-model')];
    await withScene({ models, current: ['test', 'bb-model'] }, async (s, { calls }) => {
      const f = s.frame();
      assert.equal(f.focused.selector, 'test/bb-model');
      assert.equal(f.focused.current, true);
      assert.match(f.detail, /current/u);
      await s.press(KEYS.enter);
      assert.equal(calls.switchModel.length, 0);
      assert.equal(s.open, false);
    });
  });

  it('Esc clears an active query first, then closes', async () => {
    await withScene({ models: [m('test', 'escape-model')] }, async (s, { calls }) => {
      await s.type('esc');
      await s.press(KEYS.escape);
      assert.equal(s.open, true);
      assert.equal(s.frame().query, '');
      await s.press(KEYS.escape);
      assert.equal(s.open, false);
      assert.equal(calls.switchModel.length, 0);
    });
  });

  it('Enter while a turn is running keeps the scene open and says why', async () => {
    await withScene({ models: [m('a', 'one'), m('a', 'two')], current: ['a', 'one'], working: true }, async (s, { calls }) => {
      await s.press(KEYS.down);
      await s.press(KEYS.enter);
      assert.equal(s.open, true);
      assert.equal(calls.switchModel.length, 0);
      assert.ok(calls.notify.some((n) => n.color === 'warning'));
    });
  });

  it('Enter switches, closes, and announces the switch by display name', async () => {
    await withScene({ models: [m('a', 'one', 'Model One'), m('a', 'two', 'Model Two')], current: ['a', 'one'] }, async (s, { calls }) => {
      await s.press(KEYS.down);
      await s.press(KEYS.enter);
      await s.quiet();
      assert.deepEqual(calls.switchModel, [{ provider: 'a', id: 'two' }]);
      assert.ok(calls.notify.some((n) => n.text.includes('Model Two')));
    });
  });

  it('Starred empty state tells you how to star', async () => {
    await withScene({ models: [m('a', 'one')], stars: [['a', 'one']] }, async (s, { home }) => {
      assert.equal(s.frame().scope, 'Starred');
      await s.press(KEYS.space); // unstar the only starred model while viewing Starred
      const f = s.frame();
      assert.equal(f.scope, 'Starred', 'stays put rather than jumping away');
      assert.equal(f.rows.length, 0);
      assert.match(s.text(), /space to star/u);
      assert.deepEqual(home.read('model-stars.json').models, []);
    });
  });

  it('Recent lists dsh-TUI\'s model-recents.json in order', async () => {
    const models = [m('a', 'one'), m('a', 'two'), m('b', 'three')];
    await withScene({ models, recents: [['b', 'three'], ['a', 'one']] }, async (s) => {
      while (s.frame().scope !== 'Recent') await s.press(KEYS.tab);
      assert.deepEqual(s.frame().rows.map((r) => r.selector), ['b/three', 'a/one']);
    });
  });
});

describe('layout (omp hub responsive tests)', () => {
  it('keeps the title, scopes and model names visible at phone-sized widths', async () => {
    await withScene({ models: [m('test', 'phone-model')], cols: 44, rows: 16 }, async (s) => {
      const text = s.text();
      assert.match(text, /Models/u);
      assert.match(text, /Starred/u);
      assert.match(text, /test\/ph/u);
      for (const line of s.lines()) assert.ok([...line].length <= 44);
    });
  });

  it('long lists window around the focused row', async () => {
    const models = Array.from({ length: 60 }, (_, i) => m('test', `model-${String(i).padStart(2, '0')}`));
    await withScene({ models, rows: 18 }, async (s) => {
      await s.press(KEYS.end);
      let f = s.frame();
      assert.equal(f.focused.selector, f.rows.at(-1).selector);
      assert.ok(f.rows.length < 60);
      await s.press(KEYS.home);
      f = s.frame();
      assert.equal(f.focused.selector, f.rows[0].selector);
    });
  });

  it('the detail line shows the focused model\'s metadata from the llm service', async () => {
    const llm = fakeLlmService((provider, id) => ({
      provider, id, name: 'Claude Opus 5.5', inputModalities: ['text', 'image'],
      context: { contextWindow: 1_000_000 }, defaultMaxTokens: 128_000,
      reasoning: { efforts: ['low', 'medium', 'high', 'max'].map((e) => ({ id: e, name: e })) },
    }));
    await withScene({ models: [m('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5')], llm }, async (s) => {
      await s.until((t) => t.includes('1M ctx'));
      const f = s.frame();
      assert.match(f.detail, /Claude Opus 5\.5/u);
      assert.match(f.detail, /1M ctx/u);
      assert.match(f.detail, /128K out/u);
      assert.match(f.detail, /vision/u);
      assert.match(f.detail, /low–max/u);
      assert.match(f.rows[0].extra, /1M/u, 'context column on the row');
    });
  });
});
