# SPEC — dsh-model-selector

An oh-my-pi-style model selector **for dsh-TUI only** (full-screen scene
`model-selector` + `alt+p` shortcut; with nix-config's `model-selector-scene.patch`
a bare `/model`, the launch page's model segment and the footer's model segment
open this scene). Config: `shortcut` (default `alt+p`, `false` disables),
`starsFile` (default `~/.dsh-tui/model-stars.json`). Recents are shared with
dsh-TUI via `~/.dsh-tui/model-recents.json` in dsh-TUI's own format.

**Surfaces.** TUI only: the plugin registers `tuiScenes`/`tuiShortcuts`, which
only dsh-TUI provides; `package.json` has no `./client` export and the plugin
does not touch `connection`/web routes.
**Web surface rationale (not applicable):** there is no web UI by design — the
product replaces dst's model picking, which the web client does separately.
The required web check is therefore an **inertness property** (P-25): loading
the row in a real `dsh web` profile must not alter or break the web client.

**State ownership.** Stars and recents live in `~/.dsh-tui/*.json` (per HOME,
shared by every TUI process on that HOME). Nothing is session-scoped; nothing
resets on model switch (a switch is itself recorded as a recent). Failed reads
→ empty; failed writes are best-effort (P-26 defines the star-write failure
behavior). Concurrent writers follow P-27's merge policy.

Oracle convention: every oracle below is computed **independently of `lib/`** —
test-local generators (`test/arbitraries.js`), test-local filters/rankers, the
rendered frame text, the `ChannelUi` spy, and the files on disk. No property's
expected value is imported from production code.

## Properties

| ID | Property (setup → action → observable result) | Independent oracle | Surface(s) |
|---|---|---|---|
| P-01 | Any generated catalog/state/terminal size, after **every** keystroke: the frame is one intact bordered box that never exceeds the terminal | Frame text parsed test-side: single box, width ≤ columns, height ≤ rows | TUI (scene runtime; layout invariants also e2e) |
| P-02 | Typing/backspace/ctrl+w/ctrl+u: the search line echoes exactly the resulting query (unicode, spaces stripped as input, quotes, newlines never reach the query) | Expected query tracked by the test model, character-exact | TUI |
| P-03 | Sidebar structure: right side, starts with **Starred**, then **Recent**, **All models**, one entry per provider; provider counts sum to the All models count | Counts recomputed from the generated catalog | TUI |
| P-04 | The `n/total` on the search line equals the active scope's count; exactly one focused row iff count > 0, else an explicit empty state | Recomputed scope counts; focus parsed from the frame | TUI |
| P-05 | Row soundness: every listed row is a catalog model; its ★ matches the starred set; ✓ marks only the live model; it matches the query (every query token is a subsequence of the row's words, modulo omp's tolerances: at most one adjacent letter/digit swap and a token may overshoot a word by up to two trailing characters); Starred/provider scopes list only their own models | Test-local subsequence filter + generated starred/live sets | TUI |
| P-06 | Completeness on **All models**: every model whose words contain each token is counted, and listed when it fits the window | Test-local filter enumerates the expected set | TUI |
| P-07 | After any Space toggle: `model-stars.json` on disk equals the starred set, plus untouched stars for models missing from the catalog | File contents parsed and compared to the model's expected set | TUI (fast + e2e restart) |
| P-08 | Typing (query empty → non-empty) focuses the first result and moves Starred/Recent to All models | State model transition | TUI |
| P-09 | ↑/↓ move exactly one row (clamped); Home/End reach the ends; PgUp/PgDn move by the visible page | Focus tracked in the test model | TUI |
| P-10 | Tab/Shift+Tab/←/→ hop scopes and land on the **next non-empty** scope (skipping empties; staying put if none) | Recomputed scope lists | TUI |
| P-11 | Space on a focused row toggles its star **in place**: focus and scroll are preserved | Focus before == focus after; P-07 file check | TUI |
| P-12 | Esc: clears a non-empty query first; with an empty query closes the scene **without switching** | `switchModel` spy call count unchanged; scene closed | TUI |
| P-13 | Enter: switches exactly once to the focused model and closes; on the live model it closes without switching; while a turn runs it is **refused with a warning**, the route is unchanged and the turn still completes | `switchModel` spy args + call count; warning line parsed; e2e: mock sees the turn complete | TUI (fast + e2e busy-turn) |
| P-14 | A completed switch puts the model at the **front** of `model-recents.json`, deduped, capped at 10, in dsh-TUI's own format (its `readModelRecents` parses it) | File parsed test-side against the expected order | TUI (fast contract + e2e) |
| P-15 | Landing state: Starred scope when any starred model exists, else All models; the live model is preselected (focused) when listed | Recomputed from generated stars + live route | TUI |
| P-16 | Stars survive closing and reloading the plugin (file → scene state) and a **full TUI restart** | Toggle, kill TUI, restart on the same profile, reopen: stars match the file | TUI (fast reload + e2e restart) |
| P-17 | Any stars-file content (junk, wrong shapes, stars for unknown models) opens cleanly and is rewritten valid on the next toggle | Pre-seeded corrupt file; scene opens; P-07 holds after a toggle | TUI |
| P-18 | Openings: bare `/model` (patched TUI), Alt+P (dsh-omp-keys patch), the launch page's model segment and the footer's model segment open this scene; a typed `/model <provider/id>` still switches directly; the typed `/model` draft is dropped after a pick or Esc (clean launch page after) | Real TUI screen: scene title frame appears; after close the launch page has no `/model` draft | TUI (e2e, patched host only) |
| P-19 | A pick updates the footer model, `~/.dsh-tui/model.json`, `model-recents.json`, leaves the old session in `/resume`, and the **next prompt reaches the mock with the picked model id** | Mock request log model id; state files parsed | TUI (e2e) |
| P-20 | No host warnings about the plugin/scene in the dsh logs after the above flows | `profile.logs()` grep | TUI (e2e) |
| P-21 | Contract seams (dsh-TUI bump guard): `ChannelUi` methods the scene uses, the public `./scenes` subpath, scene + shortcut registration with no host warnings, disposal on unload restores original behavior, `shortcut: false` config, recents format, nothing recorded when the host refuses a switch, fresh catalog read on every open | Host runtime assertions (real `TuiSceneRuntime`/`TuiShortcutRuntime`) | TUI (contract) |
| P-22 | omp parity examples: exact match outranks recents; recents and stars break ties; version order (1.5 > 1); letter/digit swap tolerance; All models spans providers; provider-scoped search keeps that provider; empty-scope query falls back to All models; hops skip empty scopes; Starred → All on typing; Esc twice closes; Starred empty state; Recent order; phone-width layout; windowing; metadata detail line | Expected outputs from omp's ported test cases | TUI (examples) |
| P-23 | **[bug dms-0ll.10]** When the stars file cannot be written, the scene shows the **persisted** state (no phantom star) and tells the user the star was not saved | Read-only file injected via `starsFile`; toggle → frame still shows unstarred + a warning is visible | TUI |
| P-24 | **[bug dms-0ll.11, reopened by the round-3 closure audit]** Concurrent writers of `model-stars.json` never lose or resurrect a star — each toggle runs a read-modify-write under an exclusive cross-process lock file, re-reads on open and on toggle; a lock older than a dead holder threshold is stolen, and tmp files remain pid-unique | Two real child processes race two distinct toggles in the same instant; the final file contains both stars on every round; a stale lock is stolen and removed | TUI (store + concurrency across processes) |
| P-25 | **[web inertness]** A real `dsh web` profile with the plugin row loads, serves, and streams turns exactly like a baseline profile without it (same routes answer, composer works, no console/page errors attributable to the plugin) | Same generated session driven on both profiles; diffs limited to the documented row | Web (Playwright, real dsh web) |

## Traceability

Implementation status is tracked in `TESTING.md` (property → test → surface →
seed/result). Beads: dms-0ll.2 (this file), .5 (P-25), .6 (P-01…P-22 on a real
TUI in a private tmux socket), .7 (traceability table), .8 (P-23/P-24 red→green
+ mutants), .10/.11 (bug beads; .11 was reopened by the round-3 closure audit
— its closed state carried a deferred cross-process residual — and re-closed
after the lock fix), and .12 (e2e tmux server bug).
