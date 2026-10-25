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
 * @module
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const { open, setOpen, openOverlay, closeOverlay, toggleOverlay } = useUrlOverlay(COMMAND_PALETTE_PARAM, {
    alias: 'cmdk',
  });

  // ⌘K / Ctrl+K accelerator. Lives here (not in CommandPalette) so the command
  // and its shortcut share one definition and one open-state source. Toggle is
  // fine for the *keyboard* (close-on-repeat); buttons/links/programmatic open
  // paths use the idempotent openOverlay().
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleOverlay();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleOverlay]);
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
    <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>
  );
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
