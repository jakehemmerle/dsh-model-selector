# RELEASING.md — dsh-model-selector

Releases follow the `new-dsh-plugin` skill's `references/release.md`: Semantic
Versioning 2.0.0 with DSH's prerelease-channel scheme.

## Version policy

1. This package's own version is SemVer, **independent of DSH's number**.
   While `0.x`, SemVer allows bumping MINOR instead of MAJOR for incompatible
   behavioural changes; no stable `x.y.z` is published until the full suites
   pass against a stable DSH.
2. Every qualification run targets DSH `0.2.1-alpha.2` and the fleet-patched
   dsh-TUI `0.14.0` (the nix-config patch stack vendored in `nix/fleet/`) —
   the temporary installed-alpha exception from the skill's version policy,
   re-checked each release. Package versions therefore carry the `-alpha.N`
   prerelease channel — `-alpha.N` against a DSH alpha, `-rc.N` against a DSH
   rc. The suffix is dropped only after the full suites pass against a stable
   DSH.
3. This plugin declares no `peerDependencies`; it imports no npm host package
   names at runtime (dsh-TUI injects the scene runtime, `ChannelUi`,
   `tuiScenes`/`tuiShortcuts`). The qualified pair — exact dsh and dsh-TUI
   versions the full suites passed against — is recorded in every
   `CHANGELOG.md` entry instead. Moving to a new DSH/dsh-TUI version is a
   release: re-run every suite against that exact build, update the recorded
   pair, bump the version, and only then ship.
4. Re-check DSH's release channels at each release
   (`npm view @deepseek-ai/dsh dist-tags versions --json`). Do not follow
   later alphas silently; a beta/stable target must be qualified on the full
   suites before the pair is recorded.

## Release gate — all green, in this order, against the pinned build

1. Clean `main`: `git pull --ff-only`, no uncommitted changes.
2. `nix flake check` green — `checks.fast` runs ALL top-level suites
   (property, contract, examples, stars-write failure, cross-process
   concurrency) at `NUM_RUNS=1000` in the sandbox against the pinned dsh and
   the fleet-patched dsh-TUI; the `package` check builds the store artifact.
3. Real-client release campaign on a real dsh-TUI (private tmux socket):
   **≥100 generated cases per surface** (launch page and chat) **over ≥3
   recorded seeds**, plus the busy-turn and restart groups; seeds logged in
   `TESTING.md`, replayable via `FC_SEED`/`TUI_PROP_*`, with the exact
   store paths under test.
4. Real-client release campaign for the web inertness property on real
   `dsh web` + Playwright (plugin-loaded vs baseline on both pages): same
   minimum (≥100 generated sequences over the same seed set).
5. `TESTING.md` updated with the campaign rows (sections on seeds, coverage
   buckets, durations and store paths — no open skip) and a `CHANGELOG.md`
   entry added.

A failing or skipped required suite blocks the release; there is no bypass.
Red → green discipline: a real product bug is committed failing first
(`5.3 FLASH: red: <id> …`), then fixed in a following commit; mutants from
the mutation check must stay at caught N/N in `TESTING.md`.

## Cut checklist

1. `git pull --ff-only` and confirm a clean tree.
2. Close or defer every open release-blocking bead (close the epic last).
3. Run the gate above; record the evidence in `TESTING.md`.
4. Bump `package.json` `version` — the flake derives every package version
   from `package.json`.
5. Add the `CHANGELOG.md` entry per release.md: version, date, changes, the
   exact dsh and dsh-TUI versions tested, the commit tested, and the suite
   evidence (seeds, counts, pass).
6. Commit prefixed `5.3 FLASH: release: vX.Y.Z[-alpha.N]`, create an
   **annotated** tag `vX.Y.Z[-alpha.N]` on that commit, push the commit and
   the tag.
7. Consumers (nix-config) pin tagged revisions only; local installation and
   fleet rollout then follow the skill's `references/rollout.md`, including
   Jake's acceptance gate before any deployment beyond the chosen test host.
   A pushed tag alone is not deployment evidence.

## Replay / audit commands

Seeds, exact `DSH_BIN`/`DSH_TUI_DIR` store paths and copy-pasteable
commands live at the bottom of `TESTING.md` (`Replay commands`), next to
the recorded results they reproduce. A release audit starts there.
