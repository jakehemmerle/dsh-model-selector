// dsh-model-selector: an oh-my-pi style model selector for dsh-TUI.
//
// Registers a full-screen scene (`model-selector`) and an alt+p shortcut.
// With the dsh-TUI patch in nix-config (pkgs/dsh-tui/model-selector-scene.patch)
// a bare `/model`, the launch page's model segment and the footer's model
// segment open this scene instead of the built-in picker.
//
// Config (cordis.patch.yml):
//   shortcut:  combo that opens the scene ("alt+p"), or false for none
//   starsFile: where stars live (default ~/.dsh-tui/model-stars.json)
import { createSceneComponent } from './lib/scene.js';

export const name = 'dsh-model-selector';
export const inject = ['tuiScenes'];
export const SCENE_ID = 'model-selector';

export function apply(ctx, config = {}) {
  let llmService;
  // `llm` is optional: without it rows simply carry no context/effort facts.
  ctx.inject(['llm'], (inner) => {
    llmService = inner.get('llm');
    inner.effect(() => () => { llmService = undefined; }, 'dsh-model-selector: llm metadata');
  });

  ctx.tuiScenes.register({
    id: SCENE_ID,
    title: 'Models',
    component: createSceneComponent({ config, llm: () => llmService }),
  }, ctx);

  const shortcut = config.shortcut ?? 'alt+p';
  if (shortcut !== false) {
    ctx.inject(['tuiShortcuts'], (inner) => {
      inner.tuiShortcuts.register(shortcut, {
        description: 'Open the model selector',
        handler: () => { ctx.tuiScenes.open(SCENE_ID); },
      }, inner);
    });
  }
}
