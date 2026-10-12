# Source of the vendored rig

`rig.mjs` and `mock-llm.mjs` are byte-identical copies of the
new-dsh-plugin skill's scripts, vendored so the e2e suites never import from
`~/.agents` or any path outside this repo (that import broke nix-config CI
when the skill moved).

| Vendored | Source | Commit |
|---|---|---|
| `rig.mjs` | `~/nix-config/skills/new-dsh-plugin/scripts/rig.mjs` | `2d658d4` (2026-10-10, "rename dsh-plugin skill to new-dsh-plugin") |
| `mock-llm.mjs` | `~/nix-config/skills/new-dsh-plugin/scripts/mock-llm.mjs` | `2d658d4` |

Verified byte-identical with `diff` at vendoring time (2026-10-11). To update:
copy the newer skill script over these, refresh this table, and re-run the e2e
suites. Everything in this repo imports them by **relative path only**
(`test/e2e/dsh-tui.js`, `test/e2e/tui.e2e.test.js`); the private tmux socket
(`tmux -f /dev/null -L <socket>`) is started by the rig itself.
