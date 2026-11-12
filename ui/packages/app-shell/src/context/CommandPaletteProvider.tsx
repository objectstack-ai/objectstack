/**
 * CommandPaletteProvider
 *
 * Single source of truth for whether the global ⌘K command palette is open,
 * plus the shared, idempotent commands used to open / close it.
 *
 * Open state is delegated to {@link useUrlOverlay} (`?palette=1`, `?cmdk=1`
 * alias), so it is URL-addressable (deep-linkable, restore-on-reload,
 * back/forward) per ADR-0054 invariant C3, and every "open" affordance — the
 * top-bar search button, a programmatic caller, a deep-link — shares the same
 * idempotent `openCommandPalette()` (never a toggle) per C1.
 *
 * `⌘K` stays an *accelerator*: the keydown handler toggles (close-on-repeat is
 * a keyboard nicety), but the OPEN path used by buttons / links / programmatic
 * callers is the idempotent `openCommandPalette()`.
 *
 * ## What is typed while it opens is kept (objectstack#32627)
 *
 * Opening is a URL change, so the palette's input mounts a render or more
 * after the shortcut, and characters typed in between went to whatever had
 * focus (the page, or another field) and never reached the query. From the
 * moment an open is asked for until the palette's input has focus, printable
 * keys and Backspace are held here instead of reaching the page, and the
 * palette takes them as the start of its query when it mounts
 * ({@link useCommandPaletteTypeahead}). The hold ends when the input takes
 * focus, when the palette closes, or after `TYPEAHEAD_HOLD_MS`, so it can never
 * swallow keys the page should get.
 *
 * @module
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useUrlOverlay } from '../hooks/useUrlOverlay.js';
import { COMMAND_PALETTE_PARAM } from '../urlParams.js';
import {
  useAdvertiseShortcut,
  type AdvertisedShortcut,
  type ShortcutLabelTranslate,
} from '../chrome/advertisedShortcuts.js';

/** `⌘K` / `Ctrl+K` — the keydown handler in {@link CommandPaletteProvider}. */
const OPEN_COMMAND_PALETTE_SHORTCUT: AdvertisedShortcut = {
  id: 'command-palette',
  group: 'general',
  chord: { key: 'k', mod: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.openCommandPalette'),
};

export interface CommandPaletteContextValue {
  /** Whether the palette is currently open (derived from the URL). */
  open: boolean;
  /** Idempotent open — calling when already open is a no-op (C1). */
  openCommandPalette: () => void;
  /** Idempotent close. */
  closeCommandPalette: () => void;
  /** Toggle — reserved for the keyboard accelerator, not the open affordances. */
  toggleCommandPalette: () => void;
  /** Imperative setter, used by the dialog's `onOpenChange`. */
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

/** The palette's stable locator, which `CommandPalette` sets on its dialog content. */
export const COMMAND_PALETTE_TESTID = 'overlay:command-palette';

/**
 * The longest the keys typed while the palette opens are held for it. Opening
 * takes a render or a few; this only bounds an open that never completes.
 */
export const TYPEAHEAD_HOLD_MS = 2000;

/** Where held keys go once the palette's input can take them. */
type TypeaheadSink = (edit: (query: string) => string) => void;

interface TypeaheadChannel {
  /** Start holding keys: an open was asked for. */
  begin(): void;
  /** Stop holding keys and forget what was held. */
  end(): void;
  /** The palette's input is mounted: hand it what was held, and what comes until it has focus. */
  attach(sink: TypeaheadSink): () => void;
}

const TypeaheadContext = createContext<TypeaheadChannel | null>(null);

/**
 * The typeahead channel (objectstack#32627): the keys held between the
 * shortcut and the input's focus, as edits to apply to the query.
 */
function useTypeaheadChannel(open: boolean): TypeaheadChannel {
  const held = useRef<Array<(query: string) => string>>([]);
  const holding = useRef(false);
  const sink = useRef<TypeaheadSink | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const end = useCallback(() => {
    holding.current = false;
    held.current = [];
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const begin = useCallback(() => {
    end();
    holding.current = true;
    timer.current = setTimeout(end, TYPEAHEAD_HOLD_MS);
  }, [end]);

  const attach = useCallback((next: TypeaheadSink) => {
    sink.current = next;
    for (const edit of held.current.splice(0)) next(edit);
    return () => {
      if (sink.current === next) sink.current = null;
    };
  }, []);

  // Capture phase, so a key is held before anything on the page can act on it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!holding.current) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(`[data-testid="${COMMAND_PALETTE_TESTID}"]`)) {
        // The palette has focus now: from here its input reads the keys itself.
        if (target.matches('input, textarea')) end();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      let edit: ((query: string) => string) | null = null;
      if (e.key.length === 1) {
        const key = e.key;
        edit = (query) => query + key;
      } else if (e.key === 'Backspace') {
        edit = (query) => query.slice(0, -1);
      }
      if (!edit) return;
      e.preventDefault();
      e.stopPropagation();
      if (sink.current) sink.current(edit);
      else held.current.push(edit);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [end]);

  // Closed again before the input took focus: nothing more is held for it.
  useEffect(() => {
    if (!open) end();
  }, [open, end]);
  useEffect(() => end, [end]);

  return useMemo(() => ({ begin, end, attach }), [begin, end, attach]);
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const { open, setOpen, openOverlay: openUrlOverlay, closeOverlay, toggleOverlay } = useUrlOverlay(COMMAND_PALETTE_PARAM, {
    alias: 'cmdk',
  });
  const typeahead = useTypeaheadChannel(open);
  // Every open a person asks for holds what they type next (objectstack#32627).
  const openOverlay = useCallback(() => {
    if (!open) typeahead.begin();
    openUrlOverlay();
  }, [open, openUrlOverlay, typeahead]);

  // ⌘K / Ctrl+K accelerator. Lives here (not in CommandPalette) so the command
  // and its shortcut share one definition and one open-state source. Toggle is
  // fine for the *keyboard* (close-on-repeat); buttons/links/programmatic open
  // paths use the idempotent openOverlay().
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!open) typeahead.begin();
        toggleOverlay();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, toggleOverlay, typeahead]);
  useAdvertiseShortcut(OPEN_COMMAND_PALETTE_SHORTCUT);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      open,
      openCommandPalette: openOverlay,
      closeCommandPalette: closeOverlay,
      toggleCommandPalette: toggleOverlay,
      setOpen,
    }),
    [open, openOverlay, closeOverlay, toggleOverlay, setOpen],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      <TypeaheadContext.Provider value={typeahead}>{children}</TypeaheadContext.Provider>
    </CommandPaletteContext.Provider>
  );
}

/**
 * The palette's half of the typeahead channel (objectstack#32627): while
 * `open`, the keys typed since the open was asked for are applied to the
 * query through `setQuery`, the held ones at once and later ones as they
 * arrive, until the input has focus. Package-internal; a no-op outside a
 * provider.
 */
export function useCommandPaletteTypeahead(
  open: boolean,
  setQuery: (edit: (query: string) => string) => void,
): void {
  const channel = useContext(TypeaheadContext);
  // Latest-ref, written in an effect declared before the attach below.
  const setQueryRef = useRef(setQuery);
  useEffect(() => {
    setQueryRef.current = setQuery;
  });
  useEffect(() => {
    if (!open || !channel) return;
    return channel.attach((edit) => setQueryRef.current(edit));
  }, [open, channel]);
}

/**
 * Access the shared command-palette controls.
 *
 * Falls back to a no-op implementation when used outside a
 * `<CommandPaletteProvider>` (e.g. the `home`/`orgs` frames, where no palette is
 * mounted, or isolated unit tests): a caller there gets inert controls rather
 * than a throw. A control that only exists to open the palette should not be
 * shown there at all — `AppHeader` asks {@link useCommandPaletteProviderMounted}
 * and renders its search trigger only when it answers `true` (objectui#11912).
 */
export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    return {
      open: false,
      openCommandPalette: () => {},
      closeCommandPalette: () => {},
      toggleCommandPalette: () => {},
      setOpen: () => {},
    };
  }
  return ctx;
}

/**
 * Whether a `<CommandPaletteProvider>` is mounted above the caller — that is,
 * whether {@link useCommandPalette}'s controls reach a palette, or are the inert
 * fallback that opens nothing (on click, or on `⌘K`, whose keydown handler only
 * the provider installs).
 *
 * Package-internal (objectui#11912): `AppHeader` reads it so the "Search ⌘K"
 * trigger is not drawn on `/home`, `/ai` or the organizations frames, where it
 * would do nothing. It is deliberately not re-exported from `./index.ts` or the
 * package entry, and it leaves `useCommandPalette()`'s published return shape
 * and its no-op fallback as they were.
 */
export function useCommandPaletteProviderMounted(): boolean {
  return useContext(CommandPaletteContext) !== null;
}
