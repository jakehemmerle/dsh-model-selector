# Changelog

All notable changes to `dsh-model-selector` are documented here (Keep a
Changelog style, SemVer 2.0.0 with DSH's prerelease channels). The qualified
pair — exact dsh and dsh-TUI versions the full suites passed against — is
recorded in every entry per `RELEASING.md`.

## [0.1.0-alpha.1] — 2026-10-13

First tagged release: the omp-style model selector scene for dsh-TUI, with the
spec-driven, real-client test system, Nix environment and release procedure
built around it (epic `dms-0ll`).

### Added

- `SPEC.md` — 25 properties (P-01…P-25) with independent oracles and surfaces.
- `flake.nix` — `packages.default` from `package.json`, pinned dev shell
  (node, tmux, beads, dsh `0.2.1-alpha.2`, fleet-patched dsh-TUI `0.14.0`),
  `checks.fast` (all fast suites at `NUM_RUNS=1000` in the sandbox),
  `nix run .#e2e` (real-client suites incl. Playwright via
  `playwright-driver.browsers`).
- `test/e2e/` — real dsh-TUI property suites (fast-check generated key/command
  sequences on the launch page and in chat, busy-turn refusals, restart
  persistence; private tmux socket, invariants after every step), the tmux e2e
  for openings/picks/recents/restart (`/model` draft drop, Alt+P, mock round
  trip) and the web inertness suite (plugin-loaded vs baseline, generated
  action sequences, failure screenshots).
- `TESTING.md` — SPEC ↔ test traceability table, budgets, seeds, mutations,
  replay commands.
- `RELEASING.md` / `CHANGELOG.md` — SemVer release procedure matching the
  skill's `references/release.md`.

### Fixed

- **dms-0ll.10** — a failed `model-stars.json` write no longer shows a phantom
  star: `toggleStar` returns the persisted state with `saved:false` and the
  scene warns the user ("Could not save the star — the stars file is not
  writable."). Red `b273cbe` → fix `971f076`.
- **dms-0ll.11 (reopened by the round-3 closure audit)** — concurrent TUI
  processes toggling stars in the same instant no longer lose updates: the
  read-modify-write now runs under an exclusive cross-process lock file with
  stale-lock theft (a lock older than a dead-holder threshold is reclaimed) and
  a bounded live-contention timeout that falls back to the persisted-state
  warning. Red `e05cba9` (4/60 inter-process races lost an update) → fix.
  Residual (documented, not fixed here): `model-recents.json` is written by
  dsh-TUI itself without this plugin's lock and stays best-effort on the
  plugin side only.
- **dms-0ll.12** — the tmux e2e runs on a private socket (`-f /dev/null`),
  never the default server; the restart-catalog race (empty 0/0 frame cascading
  into the busy-turn test) fixed; 10/10 loops green (`466d476`).

### Testing

- DSH `0.2.1-alpha.2`, dsh-TUI `0.14.0` (fleet patch stack), node
  `v24.21.0`, npm playwright `1.59.1` with the Nix Chromium.
- Version under test, suite evidence, seeds and the replay commands: see the
  traceability sections in `TESTING.md`.
- Mutants: caught N/N recorded in `TESTING.md`.

[0.1.0-alpha.1]: ./RELEASING.md
