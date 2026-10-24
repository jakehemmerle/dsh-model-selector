# Agent instructions

- Work is tracked in the workspace Beads instance (`nx`, `~/ws/.beads`), label `project:dsh`.
  In the `~/ws/code/personal/<repo>` clone `bd` resolves there through `.beads/redirect`
  (written by `ws sync`); this repo has no Beads database of its own.
- Loop state and gotchas: [RALPH.md](RALPH.md). Product contract: [SPEC.md](SPEC.md). Evidence: [TESTING.md](TESTING.md).
- Enter the environment with `nix develop`; fast suites: `nix flake check`; real clients: `nix run .#e2e`.
- Commit directly to `main` as jakehemmerle; stage explicit paths only.
