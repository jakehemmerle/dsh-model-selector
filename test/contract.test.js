// Upstream contract: the dsh-TUI seams this plugin depends on still exist, and
// the plugin uses them the way the host expects (registration, disposal,
// shortcut dispatch, shared recents file format).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';
import { catalog, selectorOf } from './arbitraries.js';
import {
  bootHost, fakeChannel, isolatedHome, KEYS, openScene, plugin, sleep, tuiPackageJson, tuiRecents, tuiUiPolicy,
} from './harness.js';

describe('dsh-TUI host contract', () => {
  it('the ChannelUi methods and properties the scene uses are part of the host surface', () => {
    for (const method of ['listModels', 'listProviders', 'switchModel', 'openPluginScene', 'closePluginScene']) {
      assert.ok(method in tuiUiPolicy.CHANNEL_UI_EFFECTS || method === 'notify', `ChannelUi.${method}`);
    }
    for (const prop of ['provider', 'model', 'working']) assert.ok(tuiUiPolicy.CHANNEL_UI_PROPERTIES.includes(prop), `ChannelUi.${prop}`);
    assert.ok(tuiPackageJson.exports['./scenes'], 'scenes subpath is public');
  });

  it('registers its scene and alt+p shortcut, and disposes both when unloaded', async () => {
    const home = isolatedHome();
    try {
      const host = await bootHost();
      assert.deepEqual(host.scenes.list().map((s) => s.id), [plugin.SCENE_ID]);
      assert.ok(host.shortcuts.list().some((s) => s.combo === 'alt+p'), 'alt+p bound');
      assert.equal(host.warnings.length, 0, host.warnings.join('\n'));
      await host.unload();
      assert.deepEqual(host.scenes.list(), [], 'scene released');
      assert.equal(host.shortcuts.list().length, 0, 'shortcut released');
    } finally { home.dispose(); }
  });

  it('the shortcut opens the scene; config can rebind or disable it', async () => {
    const home = isolatedHome();
    try {
      const host = await bootHost();
      assert.equal(host.shortcuts.dispatch('p', { meta: true }), true, 'alt+p consumed');
      await sleep(0);
      assert.equal(host.scenes.active?.id, plugin.SCENE_ID);
      await host.unload();

      const rebound = await bootHost({ config: { shortcut: 'alt+m' } });
      assert.ok(rebound.shortcuts.list().some((s) => s.combo === 'alt+m'));
      await rebound.unload();

      const none = await bootHost({ config: { shortcut: false } });
      assert.equal(none.shortcuts.list().length, 0);
      await none.unload();
    } finally { home.dispose(); }
  });

  it('switching records the model in dsh-TUI\'s own recents file, readable by dsh-TUI', async () => {
    await fc.assert(fc.asyncProperty(catalog.filter((c) => c.models.length >= 2), fc.nat(), async ({ models, providers }, pick) => {
      const home = isolatedHome();
      try {
        const prior = models.slice(0, 3).map(({ provider, id }) => ({ provider, id }));
        home.write('model-recents.json', { models: prior });
        const host = await bootHost();
        const { channel, calls } = fakeChannel({ models, providers });
        const s = await openScene(host, channel);
        // Go to All models, move to an arbitrary row, switch.
        while (s.frame().scope !== 'All models') await s.press(KEYS.tab);
        for (let i = 0; i < pick % models.length; i += 1) await s.press(KEYS.down);
        const target = s.frame().focused.selector;
        await s.press(KEYS.enter);
        assert.equal(calls.switchModel.length, 1);
        const read = tuiRecents.readModelRecents(home.dataDir).map((r) => `${r.provider}/${r.id}`);
        assert.equal(read[0], target, 'front of dsh-TUI recents');
        assert.equal(new Set(read).size, read.length, 'deduped');
        assert.ok(read.length <= tuiRecents.MODEL_RECENTS_LIMIT);
        assert.deepEqual(read.slice(1), prior.map((r) => `${r.provider}/${r.id}`).filter((k) => k !== target).slice(0, tuiRecents.MODEL_RECENTS_LIMIT - 1));
        await s.unmount();
        await host.unload();
      } finally { home.dispose(); }
    }), { numRuns: 8 });
  });

  it('a failed switch (host refused) records nothing and the scene is closed', async () => {
    const home = isolatedHome();
    try {
      const models = [{ provider: 'a', id: 'one', name: 'One' }, { provider: 'a', id: 'two', name: 'Two' }];
      const host = await bootHost();
      const { channel, calls } = fakeChannel({ models, providers: [{ id: 'a', name: 'a' }], provider: 'a', model: 'one', switchResult: false });
      const s = await openScene(host, channel);
      await s.press(KEYS.down);
      await s.press(KEYS.enter);
      assert.equal(calls.switchModel.length, 1);
      assert.equal(home.read('model-recents.json'), undefined, 'no recents written on refusal');
      assert.equal(s.open, false);
      await s.unmount();
      await host.unload();
    } finally { home.dispose(); }
  });

  it('the scene re-reads the catalog on every open (provider edits show up)', async () => {
    const home = isolatedHome();
    try {
      const host = await bootHost();
      const models = [{ provider: 'a', id: 'one', name: 'One' }];
      const { channel, calls } = fakeChannel({ models, providers: [{ id: 'a', name: 'a' }] });
      let s = await openScene(host, channel);
      await s.press(KEYS.escape);
      models.push({ provider: 'a', id: 'two', name: 'Two' });
      await s.unmount();
      s = await openScene(host, channel);
      assert.equal(calls.listModels, 2);
      assert.equal(s.frame().sidebar.find((e) => e.label === 'All models').count, 2);
      await s.unmount();
      await host.unload();
    } finally { home.dispose(); }
  });
});

void selectorOf;
