# Agent instructions

- Issues live in beads (`bd`, prefix `dms`): `bd ready`, `bd show <id>`, `bd close <id> --reason "<evidence>"`.
  Run `bd export -o .beads/issues.jsonl` before committing so the export stays current.
- Loop state and gotchas: [RALPH.md](RALPH.md). Product contract: [SPEC.md](SPEC.md). Evidence: [TESTING.md](TESTING.md).
- Enter the environment with `nix develop`; fast suites: `nix flake check`; real clients: `nix run .#e2e`.
- Commit directly to `main` as jakehemmerle; stage explicit paths only.
