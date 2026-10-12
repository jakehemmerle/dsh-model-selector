# Source of the vendored fleet expressions

Every file here is a verbatim (or, for `dsh.nix`, minimally extracted) copy of
nix-config's packaged fleet build, so this repo's flake tests against the
**same dsh and dsh-TUI store paths the fleet runs** — not a guess. Do not edit
by hand: re-vendor from nix-config and update the commit column.

Vendored by the dsh-model-selector program (round 1, 2026-10-11) from
`github:jakehemmerle/nix-config`, verified with `diff -r`:

| Vendored | nix-config path | Commit |
|---|---|---|
| `dsh-tui.nix` | `pkgs/dsh-tui.nix` | `5e9f96d` (2026-10-11) |
| `dsh.nix` | `home/dsh.nix` (only the `dsh` package: nix-dsh `package.nix` + the postInstall override — dsh-speed's `patch-model-modal.mjs` and the Tailscale trusted-login check) | `5e9f96d` (2026-10-11) |
| `dsh-tui/*.patch`, `dsh-tui/package-lock.json`, `dsh-tui/test/*` | `pkgs/dsh-tui/…` | `5e9f96d` / patches `50a02af`, `28787de` |
| `dsh-omp-keys/dsh-tui-0.14.0.patch`, `dsh-omp-keys/test/*` | `pkgs/dsh-omp-keys/…` | `d9787c2` (2026-10-10) |
| `dsh-speed/scripts/patch-model-modal.mjs`, `patch-tui.mjs`, `test/tui-patch.test.mjs` | `pkgs/dsh-speed/{scripts,test}/…` | `5e9f96d` |

`dsh.nix` keeps the two relative script references working by referencing
`./dsh-speed/scripts/…` next to it; `dsh-tui.nix` needs no path edits because
`dsh-tui/` and `dsh-omp-keys/` sit beside it here as they do in `pkgs/`.

nix-dsh is pinned by rev in `flake.nix` (`f0ca0d745df8cbe99bad91d59153dbd690ae6660`),
the same rev nix-config's `flake.lock` held when this was vendored. nixpkgs is
pinned to nix-config's nixpkgs rev, `nixpkgs-tools` to the rev providing
beads 1.3.0.
