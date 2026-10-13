# Testing

Every suite drives the plugin through its public surface only: the module is
loaded as a cordis plugin into dsh-TUI's real `TuiSceneRuntime` and
`TuiShortcutRuntime`, the host opens the scene with dsh-TUI's own scene outlet,
and a headless xterm receives raw keystrokes. Assertions read the rendered
frame, the `ChannelUi` calls (`switchModel`, `notify`, `closePluginScene`), and
the files under `$HOME/.dsh-tui`. No test imports `lib/`.

`npm test` links the installed dsh and dsh-TUI into `test/.host`
(`scripts/link-host.mjs`; override with `DSH_SCOPE_DIR` / `DSH_TUI_DIR`) and
runs with `--preserve-symlinks`, so dsh-TUI's bare imports resolve the way the
dsh Loader routes them. `NUM_RUNS` scales the property suites.

## Property suites (`test/selector.property.test.js`)

Model-based (`fc.commands`) over arbitrary catalogs (1–4 providers, 0–9 models
each, real and generated ids), starred sets (including stars for models that
are not in the catalog), recents, live route, busy/idle, and terminal sizes.
Commands: type a character, backspace, ctrl+u, ctrl+w, ↑ ↓ PgUp PgDn Home End,
Tab Shift+Tab ← →, Space, Esc, Enter.

After every keystroke:

- the frame is one intact bordered box that never exceeds the terminal;
- the search line echoes exactly what was typed;
- the sidebar is on the right, starts with **Starred**, has **All models** and
  one entry per provider, and provider counts sum to the All models count;
- the `n/total` on the search line equals the active scope's count; exactly one
  focused row when n > 0, an empty state otherwise;
- every row is a catalog model, its ★ matches the starred set, ✓ marks only
  the live model, it matches the query (soundness: each token is a
  subsequence), and Starred/provider scopes list only their own models;
- on All models, every model whose words contain each token is counted and,
  when it fits, listed (completeness);
- the stars file equals the starred set plus untouched stars for models
  missing from the catalog.

Per command: typing focuses the first result and moves Starred/Recent to All
models; ↑/↓ move exactly one row; Home/End reach the ends; scope hops land on
the next non-empty scope; Space toggles in place and keeps focus; Esc clears
the query then closes without switching; Enter switches exactly once to the
focused model and closes, is a no-op close on the live model, and is refused
with a warning while a turn runs. A switch puts the model at the front of
dsh-TUI's `model-recents.json`.

Also: landing (Starred when any starred model exists, else All models; the live
model preselected), stars survive closing and reloading the plugin, and any
stars-file content (junk, wrong shapes) opens cleanly and is rewritten valid.

## Contract suite (`test/contract.test.js`)

Pins the dsh-TUI seams the plugin depends on, so a dsh-TUI bump that renames
or drops one fails here first: the `ChannelUi` methods/properties, the public
`./scenes` subpath, scene + `alt+p` shortcut registration without host
warnings, disposal on unload, shortcut dispatch opening the scene, `shortcut`
config, recents written in the format dsh-TUI's own `readModelRecents` parses
(front, deduped, capped), nothing recorded when the host refuses a switch, and
a fresh catalog read on every open.

## Examples (`test/selector.examples.test.js`)

Ported from oh-my-pi's `model-hub`, `model-picker` and `model-browser` tests:
exact match outranks recents, recents and stars break ties, version order,
letter/digit swap tolerance, All models spans providers, provider-scoped search
keeps that provider, a scope with no matches falls back to All models, hops skip
empty scopes, Starred → All on typing, Esc twice, live model preselected,
Enter while busy, switch announcement, Starred empty state, Recent order,
phone-width layout, windowing, and the metadata detail line.

## End-to-end (`test/e2e/`, `npm run test:e2e`)

Runs the real `dsh --profile` with the patched dsh-TUI build in tmux, against an
isolated `HOME`/`DSH_HOME` and a local OpenAI-compatible mock provider (no
network, no credentials). Covers what only the integrated host can show:

1. the plugin loads from `cordis.patch.yml` with no warnings in the dsh log;
2. bare `/model` opens this scene (dsh-TUI patch); Esc or a pick lands back on
   a clean launch page (the typed `/model` draft is dropped); `/model
   provider/id` still switches directly without opening it;
3. Alt+P (nix-config's dsh-omp-keys patch, routed through `/model`) opens it
   from the launch page and from chat;
4. type → Enter: the footer shows the new model, `~/.dsh-tui/model.json` and
   `model-recents.json` update, the old session remains in `/resume`, and the
   **next prompt reaches the mock server with the picked model id**;
5. Space stars persist across a full TUI restart;
6. during a running turn (mock server holds the stream) the scene opens, Enter is
   refused with a warning, the route is unchanged and the turn completes;
7. no host warnings about the scene in the dsh logs.

The rig (`test/e2e/dsh-tui.js`) writes an isolated profile that mirrors
nix-config's dsh-tui profile: the patched dsh-TUI symlinked in, the plugin
inserted with `shortcut: false`, and two `openai-completions` providers
pointing at the mock.

## Traceability (SPEC ↔ tests, round 2 status 2026-10-12)

Versions under test: DSH `0.2.1-alpha.2`, dsh-TUI `0.14.0` (fleet patch stack,
`nix/fleet/`), node v24.21.0. Hosts: fast suites via `TuiSceneRuntime` against
`test/.host`; real-client suites against the store builds in a private tmux
socket (`test/e2e/`).

| SPEC property | Test | Surface | Last result |
|---|---|---|---|
| *(round-3 closure audit, 2026-10-13)* | walked every closed bead against its recorded commit/test evidence; all 11 evidence commits re-verified; **one reopen: dms-0ll.11** (see P-24 row) | — | audit clean otherwise: no silent skips, no `~/.agents` imports, suites run real clients |
| P-01…P-07, P-09…P-12, P-14…P-17 | `test/selector.property.test.js` (model-based through the host runtime) | TUI fast | green, NUM_RUNS=1000 in `nix flake check` (`checks.fast`, 30/30, 0 skipped, 644 s, 2026-10-11) and NUM_RUNS=25/40 locally |
| P-08 landing/scope semantics | same, plus `test/selector.examples.test.js` | TUI fast | green (same runs) |
| P-18 openings + draft drop, P-19 pick reaches the mock with history, P-20 no host warnings, P-13 busy refusal, P-16 restart persistence | `test/e2e/tui.e2e.test.js` (real dsh + patched dsh-TUI, private tmux socket) | TUI real | green, **10/10 consecutive loops** (8/8 tests each, 2026-10-11, after the restart-catalog-race fix `7ef3902`) |
| P-01…P-07, P-09…P-17 (generated sequences on the real host: launch page AND chat, busy turn, restart) | `test/e2e/tui.property.test.js` (fast-check commands, invariants after every step, FC_SEED replay) | TUI real | green: **37 sequences** (launch 15 / chat 10 / busy 6 / restart 6), seeds `20261012`–`20261015`, 349 s (2026-10-12, commit `d2ae87d`) |
| P-21 contract seams | `test/contract.test.js` | TUI fast | green (same runs) |
| P-22 omp parity examples | `test/selector.examples.test.js` | TUI fast | green (same runs) |
| P-23 failed stars write → persisted state + warning | `test/write-failure.test.js` | TUI fast | red `b273cbe` → green after fix `971f076` (33/33 fast suite) |
| P-24 concurrent writers merge policy | `test/write-failure.test.js` (scene-level, external writer between reads) and `test/concurrent-toggle.test.js` (two REAL child processes racing in the same instant; stale-lock reclaim) | TUI fast + cross-process | **reopened by the round-3 closure audit** (closed state carried a deferred residual: the un-locked RMW lost updates when two processes toggled in the same tick — reproduced red, 4/60 races, commit `e05cba9`) → fix: exclusive lock file around each toggle, stale locks stolen, lock-timeout falls back to the persisted-state warning (`{saved:false}`); green: race test 60/60 rounds keep both stars, stale-lock case passes; full fast suite green |
| P-25 web inertness | pending | Web real | **pending, round 3** (Playwright, plugin-loaded vs baseline) |

No required test silently skips: the e2e suites fail loudly when `DSH_TUI_DIR`
is unset, and `checks.fast` runs the fast suites inside the Nix build.
