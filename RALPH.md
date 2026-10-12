# RALPH — dsh-model-selector work state

Ralph loop for the 5.3 FLASH program (3 rounds). Work graph: beads epic
`dms-0ll` (run `bd ready`). Every commit starts with `5.3 FLASH: `.

## Environment (round 1, verified)

- DSH `0.2.1-alpha.2` (`/nix/store/i24c2k38bz3h86r0v7bjr4amk7d4vxrj-dsh-0.2.1-alpha.2`),
  dsh-TUI `0.14.0` fleet-patched (`/nix/store/inl2nrkcnbp50r1yq7fh5y0zibx96gvl-dsh-tui-0.14.0`), node v24.21.0, nix 2.34.8.
- Fast suites: `node scripts/link-host.mjs && NUM_RUNS=<n> node --preserve-symlinks --test --test-concurrency=1 test/*.test.js`
  (resolves the fleet store paths automatically on this host).
- Real-client e2e: `DSH_TUI_DIR=<fleet dsh-tui>/lib/node_modules/@deepseek-harness-tui/dsh-tui DSH_VERSION=0.2.1-alpha.2 \
  node --test --test-concurrency=1 --test-timeout=300000 test/e2e/tui.e2e.test.js`
  — runs on a **private tmux socket** since `466d476`; never Jake's server.
- Nix: `nix flake check` green (incl. `checks.fast` at NUM_RUNS=1000: 30/30,
  0 skipped, 644 s, x86_64-linux). `nix run .#e2e` is wired to the same suites.

## Round log

### Round 1 (2026-10-11 → 12) — recovered interrupted work + 5 beads

Recovered the previous engineer's uncommitted mid-round tree (flake + fleet
vendor + rig vendor), verified it end-to-end, and landed it:

- **dms-0ll.1** source reconcile (was already closed; verified `1a15abf` == nix-config vendor).
- **dms-0ll.2 ✓** `SPEC.md` — 25 properties P-01…P-25, independent oracles,
  surfaces, web N/A rationale (`43317f5`).
- **dms-0ll.3 ✓** `flake.nix` + `nix/fleet/` verbatim from nix-config `5e9f96d`
  with `SOURCE.md` provenance (`f10fef4`); `nix flake check` all green.
- **dms-0ll.4 ✓** rig vendored byte-identical (nix-config `2d658d4`) + SOURCE.md
  (`731f156`); nothing imports `~/.agents`.
- **dms-0ll.12 ✓** e2e on a private tmux socket (`466d476`); reproduced the
  historical flakes, root-caused them (restart asserted the scene before the
  async catalog loaded → empty 0/0 frame; cascade into the busy-turn test),
  fixed the race (`7ef3902`), **10/10 loops pass 8/8**.
- playwright devDep added for the web inertness suite (`edcfd93`).

### Round 2 (2026-10-12) — dms-0ll.6 ✓, .10 ✓, .11 ✓; .7 groundwork

- **dms-0ll.6 ✓** `test/e2e/tui.property.test.js`: fast-check generated
  key/command sequences (12 command kinds) against the REAL patched dsh-TUI on
  the private-socket rig — **launch page AND chat**, invariants after every
  step (query echo, n/total vs parsed rows, exactly-one-focus with predicted
  index/key, ★/✓ glyphs vs tracked sets, token soundness, stars-file oracle,
  recents front after picks), plus generated busy-turn refusal and
  restart-persistence groups. **37 sequences this round** (15/10/6/6), seeds
  `20261012`–`20261015`, FC_SEED + TUI_PROP_* replay, green 4/4 in 349 s
  (`d2ae87d`). Parser validated against real frames (`test/e2e/dump-frame.mjs`);
  the frame grammar quirks are documented in the suite header (star column
  separated by a space from the focus column; the profile's real llm catalog
  has 6 models incl. deepseek-official registry rows).
- **dms-0ll.10 ✓ (red→fix)** `test/write-failure.test.js`: unwritable
  `starsFile` → Space showed a phantom star and no warning. Red `b273cbe`
  (assertion-level red re-proven against the pre-fix lib), fix `971f076`:
  `toggleStar` returns `{ stars, saved }` with the persisted state re-read on
  failure; the scene reverts the row and warns "Could not save the star — the
  stars file is not writable." Fast suite 33/33 green after the fix.
- **dms-0ll.11 ✓** merge policy verified per SPEC P-24: two-writer scene test
  green (external writer's star + own toggle persist via per-toggle RMW); the
  real-TUI property suites cover restart convergence. Residual narrow
  cross-process RMW window documented; file-locking follow-up deferred.
- **dms-0ll.7 groundwork**: TESTING.md gained the SPEC ↔ test traceability
  table with versions, seeds and results.

### Next (round 3)

1. **dms-0ll.5 web inertness** (Playwright, real dsh web, plugin-loaded vs
   baseline, ≥25 sequences, Nix Chromium via playwright-driver.browsers;
   playwright 1.59.1 devDep already in).
2. **dms-0ll.8** mutation check (≥3 realistic mutants against the new suites;
   record caught N/N in TESTING.md) and finish the traceability table (P-25
   row) → close .7.
3. **dms-0ll.9** release: RELEASING.md + CHANGELOG.md; release-run budgets
   (≥100 sequences/surface across ≥3 seeds) if green → tag `v0.1.0-alpha.1`.
