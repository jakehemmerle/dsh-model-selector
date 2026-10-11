# dsh-model-selector

An oh-my-pi style model selector for [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI).

```
╭─ Models ─────────────────────────────────────────┬──────────────────────────╮
│ ⌕ > opus                                    3/30 │   ★ Starred            2 │
│                                                  │   ◷ Recent             4 │
│ ❯ ★ anthropic/claude-opus-5-5 ✓          1M ◫   │ ❯ ⬢ All models        30 │
│     providerproxy/claude-opus-5           1M ◫   │ ──────────────────────── │
│     providerproxy/claude-opus-4-8         1M ◫   │   ● Anthropic          8 │
│ Claude Opus 5.5 · anthropic · 1M ctx · 128K out · vision · low–max · current │
├──────────────────────────────────────────────────┴──────────────────────────┤
│ type to search · ↑↓ move · ⇥/←→ scope · space star · ⏎ switch · esc close   │
╰─────────────────────────────────────────────────────────────────────────────╯
```

- **Type immediately** — the search box has focus the moment it opens. Search is
  omp's fuzzy matcher (word-local, letter/digit swap tolerant); exact matches
  rank first, then starred, then recently used models.
- **Space** stars or unstars the highlighted model. Stars persist in
  `~/.dsh-tui/model-stars.json`.
- **Sidebar on the right**: Starred (first), Recent (dsh-TUI's own
  `model-recents.json`), All models, then one entry per provider with counts.
  It opens on Starred when you have stars. Typing from Starred/Recent searches
  All models; a provider scope keeps its provider until it has no matches.
- **⇥ / ⇧⇥ / ← / →** change scope (skipping empty ones), **↑ ↓ PgUp PgDn Home
  End** move, **⏎** switches (the session forks onto the new route, as dsh-TUI's
  `/model` does), **Esc** clears the query, then closes.
- Rows and the detail line show context window, output cap, vision and reasoning
  efforts from the dsh `llm` service.

## Install

A cordis plugin inserted into the dsh-tui profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-model-selector
      name: /path/to/dsh-model-selector/index.js
      config:
        shortcut: alt+p   # or false; default alt+p
```

It registers the `model-selector` scene and, by default, an `alt+p` shortcut
in chat. dsh-TUI has no seam to replace its built-in `/model` picker, so
nix-config carries `pkgs/dsh-tui/model-selector-scene.patch`: a bare `/model`
(typed, Alt+P via dsh-omp-keys, or the launch page/footer model segment)
opens this scene when it is registered. `/model provider/id` still switches
directly.

## Tests

See [TESTING.md](TESTING.md). `npm test` runs the property, contract and
example suites against the installed dsh / dsh-TUI;
`DSH_TUI_DIR=<patched dsh-tui> npm run test:e2e` runs the tmux end-to-end suite.
