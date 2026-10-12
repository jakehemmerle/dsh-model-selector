// The full-screen scene component. Everything React comes from the host
// (props.React / props.ui) — a plugin-owned React copy would break hooks
// under dsh-TUI's reconciler (see dsh-TUI dsh-adapter/scenes.d.ts).
import { createCatalog, derive, initialState, reduce, refocus, scrollFor } from './model.js';
import { keyOf } from './rank.js';
import { readRecents, readStars, recordRecent, toggleStar } from './store.js';
import { buildFrame } from './view.js';

const BUSY = 'A turn is running — wait for it to finish (or Ctrl+C) before switching models.';

/**
 * @param {object} deps
 * @param {object} deps.config plugin config
 * @param {() => object | undefined} deps.llm the live `llm` service, if any
 */
export function createSceneComponent({ config, llm }) {
  return function ModelSelectorScene({ React, ui, channel, close }) {
    const { useState, useEffect, useMemo, useRef, createElement: h } = React;
    const size = ui.useTerminalSize();
    const [catalogInput, setCatalogInput] = useState(undefined);
    const [stars, setStars] = useState(() => new Set(readStars(config).map(keyOf)));
    const [state, setState] = useState(undefined);
    const [info, setInfo] = useState(() => new Map());
    const scrollRef = useRef(0);
    const closedRef = useRef(false);

    // Fresh catalog on every open: provider edits and OAuth sign-ins show up.
    useEffect(() => {
      let live = true;
      Promise.all([
        channel.listModels().catch(() => []),
        channel.listProviders().catch(() => []),
      ]).then(([models, providers]) => {
        if (!live) return;
        setCatalogInput({
          models: [...models],
          providers: [...providers],
          recents: readRecents(),
          currentKey: channel.provider && channel.model ? `${channel.provider}/${channel.model}` : undefined,
        });
      });
      return () => { live = false; };
    }, []);

    // Context window / output cap / efforts for the row and detail line.
    useEffect(() => {
      const service = llm();
      if (!catalogInput || typeof service?.resolveModelInfo !== 'function') return undefined;
      let live = true;
      const queue = [...catalogInput.models];
      const worker = async () => {
        while (live && queue.length > 0) {
          const model = queue.shift();
          try {
            const resolved = await service.resolveModelInfo(model.provider, model.id);
            if (live) setInfo((prev) => new Map(prev).set(keyOf(model), resolved));
          } catch { /* metadata is optional */ }
        }
      };
      for (let i = 0; i < 4; i += 1) void worker();
      return () => { live = false; };
    }, [catalogInput]);

    const catalog = useMemo(
      () => (catalogInput ? createCatalog({ ...catalogInput, stars }) : undefined),
      [catalogInput, stars],
    );

    useEffect(() => {
      if (catalog && state === undefined) setState(initialState(catalog));
    }, [catalog]);

    const cols = Math.max(20, size?.columns ?? 80);
    const rows = Math.max(8, size?.rows ?? 24);
    const listHeight = Math.max(1, rows - 7);

    const exit = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      close();
    };

    const pick = (model) => {
      if (channel.working) {
        channel.notify(BUSY, { color: 'warning' });
        setState((s) => ({ ...s, warning: BUSY }));
        return;
      }
      const key = keyOf(model);
      exit();
      if (key === catalogInput.currentKey) return;
      const name = model.name || key;
      channel.notify(`Switching model to ${name}…`);
      void Promise.resolve(channel.switchModel(model.provider, model.id)).then((ok) => {
        if (!ok) return;
        recordRecent(model);
        channel.notify(`Model switched to ${name}`);
      }, (error) => {
        channel.notify(`Model switch failed: ${error instanceof Error ? error.message : String(error)}`, { color: 'error' });
      });
    };

    ui.useInput((input, key) => {
      if (closedRef.current) return;
      if (key.ctrl && input === 'c') { exit(); return; }
      if (!catalog || state === undefined) {
        if (key.escape) exit();
        return;
      }
      const view = derive(catalog, state);
      const act = (action) => setState((s) => reduce(catalog, s, action, listHeight));
      if (key.escape) {
        if (state.query !== '') act({ type: 'clear' }); else exit();
        return;
      }
      if (key.return) { if (view.focused) pick(view.focused); return; }
      if (key.upArrow || key.wheelUp) return act({ type: 'up' });
      if (key.downArrow || key.wheelDown) return act({ type: 'down' });
      if (key.pageUp) return act({ type: 'pageUp' });
      if (key.pageDown) return act({ type: 'pageDown' });
      if (key.home) return act({ type: 'home' });
      if (key.end) return act({ type: 'end' });
      if (key.tab) return act({ type: key.shift ? 'prevScope' : 'nextScope' });
      if (key.rightArrow) return act({ type: 'nextScope' });
      if (key.leftArrow) return act({ type: 'prevScope' });
      if (key.backspace || key.delete) return act({ type: key.meta ? 'deleteWord' : 'backspace' });
      if (key.ctrl && input === 'u') return act({ type: 'clear' });
      if (key.ctrl && input === 'w') return act({ type: 'deleteWord' });
      if (input === ' ' && !key.ctrl && !key.meta) {
        if (!view.focused) return undefined;
        const focusedKey = keyOf(view.focused);
        const { stars: next, saved } = toggleStar(config, view.focused);
        const nextCatalog = createCatalog({ ...catalogInput, stars: next });
        setStars(next);
        setState((s) => {
          const updated = refocus(nextCatalog, s, focusedKey);
          if (saved) return { ...updated, warning: undefined };
          // The write failed: show the persisted state and say so (dms-0ll.10).
          return { ...updated, warning: 'Could not save the star — the stars file is not writable.' };
        });
        return undefined;
      }
      if (key.ctrl || key.meta || key.fn || key.super) return undefined;
      const text = [...(input ?? '')].filter((ch) => ch >= ' ' && ch !== ' ' && ch !== '\x7f').join('');
      if (text !== '') act({ type: 'type', text });
      return undefined;
    });

    const loading = !catalog || state === undefined;
    const view = loading
      ? { scopes: [], active: { id: 'all', candidates: [] }, list: [], focus: -1, focused: undefined }
      : derive(catalog, state);
    if (!loading) scrollRef.current = scrollFor({ scroll: scrollRef.current }, view.focus, view.list.length, listHeight);
    const lines = buildFrame({
      view: loading ? { ...view, scopes: [{ id: 'starred', label: 'Starred', icon: '★', count: 0, candidates: [] }], active: { id: 'starred', label: 'Starred', candidates: [] } } : view,
      state: state ?? { query: '' },
      cols, rows, scroll: scrollRef.current, info, stars,
      currentKey: catalogInput?.currentKey, loading,
    });
    return h(ui.Box, { flexDirection: 'column', width: cols, height: rows },
      lines.map((segments, i) => h(ui.Text, { key: i, wrap: 'truncate' },
        segments.map((s, j) => h(ui.Text, { key: j, color: s.color, bold: s.bold, dimColor: s.dim }, s.text)))));
  };
}
