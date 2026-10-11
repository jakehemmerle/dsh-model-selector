// Frame layout: a full-screen box with the model list on the left and the
// scope sidebar on the right.
//
//   ╭─ Models ────────────────────────────┬──────────────────────╮
//   │ ⌕ > opus                       3/30 │ ❯ ★ Starred        2 │
//   │                                      │   ◷ Recent         4 │
//   │ ❯ ★ anthropic/claude-opus-5-5 ✓  1M ◫│   ⬢ All models    30 │
//   │     providerproxy/claude-opus-5  1M ◫│ ──────────────────── │
//   │ Claude Opus 5.5 · anthropic · 1M ctx │   ● anthropic      8 │
//   ├──────────────────────────────────────┴──────────────────────┤
//   │ type to search · ↑↓ move · ⇥ scope · space star · ⏎ switch · esc close │
//   ╰─────────────────────────────────────────────────────────────╯
//
// Each line is a list of segments { text, color?, bold?, dim? } whose cell
// widths sum to exactly `cols`.
import { keyOf } from './rank.js';
import { cellWidth, padEnd, truncate, truncateStart } from './width.js';

const HINTS = 'type to search · ↑↓ move · ⇥/←→ scope · space star · ⏎ switch · esc close';
const PLACEHOLDER = 'type a model name…';

export function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`.replace('.0M', 'M');
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function rowExtra(info) {
  if (!info) return '';
  const ctx = formatTokens(info.context?.contextWindow);
  const vision = info.inputModalities?.includes('image') ? '◫' : '';
  return [ctx, vision].filter(Boolean).join(' ');
}

export function detailText(model, info, currentKey) {
  if (!model) return '';
  const parts = [info?.name || model.name || model.id, model.provider];
  const ctx = formatTokens(info?.context?.contextWindow);
  if (ctx) parts.push(`${ctx} ctx`);
  const out = formatTokens(info?.defaultMaxTokens);
  if (out) parts.push(`${out} out`);
  if (info?.inputModalities?.includes('image')) parts.push('vision');
  const efforts = info?.reasoning?.efforts ?? [];
  if (efforts.length === 1) parts.push(`effort ${efforts[0].name ?? efforts[0].id}`);
  if (efforts.length > 1) parts.push(`${efforts[0].name ?? efforts[0].id}–${efforts.at(-1).name ?? efforts.at(-1).id}`);
  if (keyOf(model) === currentKey) parts.push('current');
  return parts.join(' · ');
}

/** Sidebar inner width: fit the longest entry within 14..30, at most 40% of the box. */
function sidebarWidth(scopes, cols) {
  const longest = Math.max(...scopes.map((s) => cellWidth(s.label) + 4 + String(s.count).length + 2));
  const cap = Math.max(10, Math.floor((cols - 7) * 0.4));
  return Math.max(Math.min(14, cap), Math.min(longest, 30, cap));
}

const seg = (text, style = {}) => ({ text, ...style });

/**
 * Build every line of the frame.
 * @param {object} p
 * @param {object} p.view derive() output
 * @param {object} p.state selector state
 * @param {number} p.cols
 * @param {number} p.rows
 * @param {number} p.scroll first visible list row
 * @param {Map} p.info key → resolved model info
 * @param {Set} p.stars starred keys
 * @param {string} p.currentKey
 * @param {boolean} p.loading
 */
export function buildFrame({ view, state, cols, rows, scroll, info, stars, currentKey, loading }) {
  const S = sidebarWidth(view.scopes, cols);
  const B = Math.max(1, cols - S - 7);
  const H = Math.max(3, rows - 4);
  const L = Math.max(1, H - 3);
  const border = 'promptBorder';

  // ── body cells ──
  const body = [];
  const count = `${view.list.length}/${view.active.candidates.length}`;
  const prefix = '⌕ > ';
  const roomForQuery = Math.max(1, B - cellWidth(prefix) - count.length - 2);
  const queryText = state.query === '' ? PLACEHOLDER : truncateStart(state.query, roomForQuery);
  const searchGap = Math.max(2, B - cellWidth(prefix) - cellWidth(queryText) - count.length);
  body.push([
    seg(prefix, { color: 'accent', bold: true }),
    state.query === '' ? seg(queryText, { color: 'subtle' }) : seg(queryText, { bold: true }),
    seg(' '.repeat(searchGap)),
    seg(count, { color: 'subtle' }),
  ]);
  body.push(state.warning ? [seg(truncate(`⚠ ${state.warning}`, B), { color: 'warning' })] : [seg('')]);

  if (loading) {
    body.push([seg('Loading models…', { color: 'subtle' })]);
  } else if (view.list.length === 0) {
    const message = view.active.id === 'starred' && state.query === ''
      ? 'No starred models — press space to star one'
      : view.active.id === 'recent' && state.query === ''
        ? 'No recently used models yet'
        : 'No matching models';
    body.push([seg(`  ${truncate(message, B - 2)}`, { color: 'subtle' })]);
  } else {
    for (let i = scroll; i < Math.min(view.list.length, scroll + L); i += 1) {
      const model = view.list[i];
      const key = keyOf(model);
      const focused = i === view.focus;
      const starred = stars.has(key);
      const isCurrent = key === currentKey;
      const extra = rowExtra(info.get(key));
      const head = `${focused ? '❯' : ' '} ${starred ? '★' : ' '} `;
      const tail = isCurrent ? ' ✓' : '';
      const nameRoom = B - cellWidth(head) - cellWidth(tail);
      const showExtra = extra !== '' && nameRoom - cellWidth(key) >= cellWidth(extra) + 2;
      const nameWidth = showExtra ? nameRoom - cellWidth(extra) - 2 : nameRoom;
      const name = truncate(key, nameWidth);
      const pad = showExtra ? ' '.repeat(Math.max(2, nameRoom - cellWidth(name) - cellWidth(extra))) : '';
      body.push([
        seg(focused ? '❯' : ' ', { color: 'suggestion', bold: true }),
        seg(' '),
        seg(starred ? '★' : ' ', { color: 'chromeYellow' }),
        seg(' '),
        seg(name, focused ? { color: 'suggestion', bold: true } : {}),
        seg(tail, { color: 'success' }),
        ...(showExtra ? [seg(pad), seg(extra, { color: 'subtle' })] : []),
      ]);
    }
  }
  while (body.length < H - 1) body.push([seg('')]);
  body.length = H - 1;
  body.push([seg(truncate(detailText(view.focused, view.focused && info.get(keyOf(view.focused)), currentKey), B), { color: 'subtle' })]);

  // ── sidebar cells ──
  const entries = [];
  view.scopes.forEach((scope, index) => {
    if (index > 0 && view.scopes[index - 1].provider === undefined && scope.provider !== undefined) entries.push('sep');
    entries.push(scope);
  });
  const activeAt = entries.indexOf(view.active);
  const sideStart = Math.max(0, Math.min(activeAt - Math.floor(H / 2), entries.length - H));
  const side = entries.slice(sideStart, sideStart + H).map((entry) => {
    if (entry === 'sep') return [seg('─'.repeat(S), { color: 'subtle' })];
    const active = entry === view.active;
    const empty = entry.count === 0;
    const icon = entry.provider !== undefined && empty ? '○' : entry.icon;
    const countText = String(entry.count);
    const label = truncate(entry.label, Math.max(1, S - 4 - countText.length - 1));
    const gap = Math.max(1, S - 4 - cellWidth(label) - countText.length);
    return [
      seg(active ? '❯' : ' ', { color: 'suggestion', bold: true }),
      seg(' '),
      seg(icon, { color: entry.id === 'starred' ? 'chromeYellow' : empty ? 'subtle' : 'accent' }),
      seg(' '),
      seg(label, active ? { color: 'suggestion', bold: true } : empty ? { color: 'subtle' } : {}),
      seg(' '.repeat(gap)),
      seg(countText, { color: 'subtle' }),
    ];
  });
  while (side.length < H) side.push([seg('')]);

  // ── assemble ──
  const fit = (segments, width) => {
    const out = [];
    let used = 0;
    for (const s of segments) {
      if (used >= width) break;
      const text = cellWidth(s.text) + used > width ? truncate(s.text, width - used) : s.text;
      out.push({ ...s, text });
      used += cellWidth(text);
    }
    if (used < width) out.push(seg(' '.repeat(width - used)));
    return out;
  };
  const title = '─ Models ';
  const lines = [];
  lines.push([seg('╭', { color: border }), seg(title.slice(0, 2), { color: border }), seg('Models', { color: 'accent', bold: true }),
    seg(' ' + '─'.repeat(Math.max(0, B + 2 - title.length)), { color: border }), seg('┬', { color: border }),
    seg('─'.repeat(S + 2), { color: border }), seg('╮', { color: border })]);
  for (let i = 0; i < H; i += 1) {
    lines.push([seg('│ ', { color: border }), ...fit(body[i], B), seg(' │ ', { color: border }), ...fit(side[i], S), seg(' │', { color: border })]);
  }
  lines.push([seg(`├${'─'.repeat(B + 2)}┴${'─'.repeat(S + 2)}┤`, { color: border })]);
  lines.push([seg('│ ', { color: border }), seg(padEnd(truncate(HINTS, cols - 4), cols - 4), { color: 'subtle' }), seg(' │', { color: border })]);
  lines.push([seg(`╰${'─'.repeat(cols - 2)}╯`, { color: border })]);
  return lines;
}
