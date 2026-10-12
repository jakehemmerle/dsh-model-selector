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

### Next (round 2)

1. **dms-0ll.6** — fast-check generated key/command sequences on the real TUI
   (private socket), ≥25 sequences/round, invariants after each step. The e2e
   rig's `keys/text/capture/waitFor` is the driver; keep the oracle independent
   of `lib/` (parse rows/query/focus from the frame; check `model-stars.json` on disk).
2. **dms-0ll.10 / dms-0ll.11** — red tests at scene level via `test/harness.js`
   (unwritable `starsFile` → no phantom star + user warning; external writer
   between open and toggle → scene must not show a stale set), red commit, then fix.
3. **dms-0ll.5** — web inertness (Playwright, real `dsh web`, plugin-loaded vs
   baseline, ≥25 sequences, Nix Chromium via `playwright-driver.browsers`).
4. **dms-0ll.7** — TESTING.md traceability refresh (add SPEC IDs, seeds, the
   round-1 evidence above). **dms-0ll.8** mutants. **dms-0ll.9** release cut in round 3.

## Known intermittent issues (watch in round 2)

- The scene's catalog and `resolveModelInfo` render asynchronously; any test
  asserting scene content must `waitFor` the row, never one-shot `assert.match`.
- Input bursts (text+Enter with no pacing) can drop Enter in dsh-TUI; pace
  ~300 ms or use a submit-with-until helper. Never retry away a real failure.
