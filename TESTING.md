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

## Traceability (SPEC ↔ tests, round 3 status 2026-10-13)

Versions under test: DSH `0.2.1-alpha.2`
(`/nix/store/i24c2k38bz3h86r0v7bjr4amk7d4vxrj-dsh-0.2.1-alpha.2`), dsh-TUI
`0.14.0` with the fleet patch stack
(`/nix/store/inl2nrkcnbp50r1yq7fh5y0zibx96gvl-dsh-tui-0.14.0`, vendored in
`nix/fleet/`), node v24.21.0. Hosts: fast suites via `TuiSceneRuntime` against
`test/.host` (also at `NUM_RUNS=1000` inside `nix flake check`'s
`checks.fast`, which builds the same pinned dsh/dsh-TUI via `nix/fleet/`);
real-client suites against those same store builds in a private tmux socket
and a disposable web profile (`test/e2e/`). Web runs need
`PLAYWRIGHT_BROWSERS_PATH=<nix playwright-driver.browsers>` (the cache.mozilla
npm browsers do not match and Chromium needs the Nix build); the flake's
`apps.e2e` exports this automatically.

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
| dms-86g (release-campaign find, suite-oracle bug) | `test/e2e/tui.property.test.js` soundness oracle | TUI real | red: campaign seeds `20261014`/`20261015` counterexamples flagged rows like `mock/mock-gamma-1-5` for queries `1z`/`e1` (plain-subsequence oracle stricter than the product's documented omp tolerances — lib/fuzzy.js prefix-extension + swaps; the fast-suite oracle was already correct) → fix `dd4909f`: e2e oracle aligned (`soundlyMatches` with swap + ≤2-char overshoot); SPEC P-05 wording updated; green on re-run |
| P-25 web inertness | test/e2e/web.inertness.test.js (real dsh web via the rig, Playwright; plugin-loaded vs baseline profiles; per-action landmarks + error parity on both pages; failure screenshots to test/.artifacts/) | Web real | green: suite pilot 4x2-sequence run (57 s), then release campaign 3 seeds x 40 sequences on both pages (rows below) |

### Round-3 release campaigns (2026-10-13, beads dms-0ll.5/.6/.9)

Seeds `20261013`, `20261014`, `20261015` (plus per-group derived seeds
`+1`…`+3`), every run logged with full fast-check output in
`test/.artifacts/campaign/` (`rel2-tui-<seed>.log`, `rel-web-<seed>.log`) and
replayable from the recorded commands above.

| Campaign | Budget | Result |
|---|---|---|
| TUI real client (`rel2-tui-*.log`) | 3 seeds × (launch 40 + chat 40 + busy 8 + restart 8) = **288 sequences**; per surface: launch **120**, chat **120** | **all green** (launch 358–374 s, chat 395–412 s, busy 67–68 s, restart 101–117 s per seed; seeds exit 0); invariants after every step; store paths under test: dsh `0.2.1-alpha.2` + dsh-TUI `0.14.0` fleet patch stack |
| Web inertness real client (`rel-web-*.log`) | 3 seeds × 40 generated sequences driven identically on BOTH pages = 40 loaded + 40 baseline per seed (**240 sequence applications**) | **all green, all seeds exit 0**; error parity on both pages; the loaded row's proof: `dump-config` row + clean logs (the alpha's Plugins page never renders profile rows — probed) |

Suite-version note (honesty ledger): TUI campaign seeds were first run against
the pre-fix suite revision and hit two infrastructure races (Launchpad
Enter-drop on setup prompts; `model-recents.json` one-shot read racing the
host); both were fixed in the suite (`submitPrompt` retry helper, recents
poll) and **all three TUI seeds were re-run as `rel2-tui-*` under one fixed
suite revision**. Web campaigns all ran under the committed suite.

| SPEC property | Test | Surface | Last result |
|---|---|---|---|
| P-01…P-17, P-19…P-22 (release campaign, generated sequences on the real host) | `test/e2e/tui.property.test.js` (rel2 campaign) | TUI real | **green: 288 sequences over 3 seeds** (launch 120 / chat 120 / busy 24 / restart 24, logs `rel2-tui-20261013/14/15`), seeds `20261013`-`20261015`, exit 0 per seed |
| P-25 web inertness (release campaign) | `test/e2e/web.inertness.test.js` (rel-web campaign) | Web real | **green: 120 loaded + 120 baseline sequences over the same 3 seeds** (logs `rel-web-20261013/14/15`), error parity on both pages, no console/page errors beyond the shared allowlist, release run `nix flake check` green and real-client suites green **2026-10-13** |

Release gate (2026-10-13): `nix flake check` — all checks passed
(`checks.fast` = every top-level fast suite at `NUM_RUNS=1000` inside the
Nix sandbox against the same pinned dsh/dsh-TUI builds; `package` builds the
store artifact), plus the two campaigns above and mutants 4/4.
## Mutants (round 3, dms-0ll.8 — caught 4/4)

Each mutant was applied with `sed` to an isolated copy of the repo
(`/tmp/dms-mutant-N`), the kill suite run there, and the copy discarded.

| Mutant (file, change) | Killed by |
|---|---|
| M1 `lib/model.js` `hop()`: empty-scope skip dropped | `test/selector.property.test.js` `scopeHop` oracle — "tab hops to the next non-empty scope" (2 properties fail at NUM_RUNS=25) |
| M2 `lib/rank.js` `comparator()`: version order flipped | `test/selector.examples.test.js` — version-order case (1 of 20 fail) |
| M3 `lib/store.js` `acquireLock()`: stale-lock theft dropped | `test/concurrent-toggle.test.js` — stale-lock reclaim case (the race case correctly still passes) |
| M4b `lib/store.js` `toggleStar()`: dms-0ll.10 failure fallback guard dropped | `test/write-failure.test.js` — "persisted state (no phantom star)" |

Process notes recorded honestly: a first sed used a conflicting delimiter
(mutants not applied; all suites green; run voided); mutant M4 v1 (phantom
stars behind the lock) was unreachable by design because the lock fallback is
the very guard under test, so it was redesigned as M4b (fallback dropped) and
killed as recorded. The examples suite alone does not pin idle hop landing
(the fast property does) — matching the M1 kill path.

## Replay commands (round 3)

Fast suites (host runtime):

    node scripts/link-host.mjs && NUM_RUNS=1000 node --preserve-symlinks --test --test-concurrency=1 test/*.test.js

Real-client TUI suites (private tmux socket; replay failures with FC_SEED
plus the shrunk path printed in the campaign logs at test/.artifacts/campaign/):

    DSH_TUI_DIR=/nix/store/inl2nrkcnbp50r1yq7fh5y0zibx96gvl-dsh-tui-0.14.0/lib/node_modules/@deepseek-harness-tui/dsh-tui \
    DSH_VERSION=0.2.1-alpha.2 FC_SEED=<seed> TUI_PROP_LAUNCH=40 TUI_PROP_CHAT=40 TUI_PROP_BUSY=8 TUI_PROP_RESTART=8 \
    node --test --test-concurrency=1 --test-timeout=3600000 test/e2e/tui.property.test.js

Web inertness (Nix Chromium via playwright-driver.browsers; flake apps.e2e
exports this automatically):

    PLAYWRIGHT_BROWSERS_PATH=/nix/store/3200rnpy59wxz2za3jzqd5ddm6ysp2bp-playwright-browsers \
    FC_SEED=<seed> WEB_INERTNESS_SEQ=<n> node --test --test-concurrency=1 test/e2e/web.inertness.test.js

Campaign logs (per-seed stdout incl. fast-check seeds and shrunk
counterexamples) live in test/.artifacts/campaign/.

No required test silently skips: the e2e suites fail loudly when DSH_TUI_DIR
is unset, and checks.fast runs the fast suites inside the Nix build.
