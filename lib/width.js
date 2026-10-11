// Terminal cell width for the strings this scene draws (no dependency on the
// host's string-width: the plugin resolves from its own store path).

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff)
    || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f)
    || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function isZero(cp) {
  return cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp < 0x20;
}

export function cellWidth(text) {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (isZero(cp)) continue;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

/** Cut to at most `width` cells, ending in `…` when cut. */
export function truncate(text, width) {
  if (width <= 0) return '';
  if (cellWidth(text) <= width) return text;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = cellWidth(ch);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}

/** Keep the END of the text (for a long query), prefixed with `…`. */
export function truncateStart(text, width) {
  if (width <= 0) return '';
  if (cellWidth(text) <= width) return text;
  const chars = [...text];
  let out = '';
  let used = 0;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const w = cellWidth(chars[i]);
    if (used + w > width - 1) break;
    out = chars[i] + out;
    used += w;
  }
  return `…${out}`;
}

export function padEnd(text, width) {
  const w = cellWidth(text);
  return w >= width ? text : text + ' '.repeat(width - w);
}
