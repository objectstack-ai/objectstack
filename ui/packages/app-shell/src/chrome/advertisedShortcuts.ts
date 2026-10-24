// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Advertised shortcuts — what the keyboard-shortcuts dialog lists, and the only
 * way a shortcut gets onto it (objectui#11674).
 *
 * The dialog used to be a static list kept apart from every key handler, and
 * five of its rows (`N`, `⌘E`, `⌘/`, `⌘D`, and a bare `B` for a sidebar that
 * toggles on `⌘B`) had no handler at all. A static list cannot notice that.
 *
 * So the list is now derived from the handlers. The code that owns a handler
 * advertises its shortcut BESIDE that handler, for exactly as long as the
 * handler is mounted (`useAdvertiseShortcut`), and the dialog lists what is
 * advertised at that moment (`useAdvertisedShortcuts`). A shortcut whose
 * handler is not mounted is not listed. That holds per page as well: the AI
 * chat page's `⌘⇧O` / `⌘⇧S` are advertised by that page, so they are listed
 * only where that page is mounted.
 *
 * Two advertisers sit beside a handler they do not own the code of: `⌘B` is
 * the Shadcn `SidebarProvider`'s own listener (a synced primitive, see
 * `ConsoleLayout`), and `Esc` is Radix's dismiss handler on every dialog and
 * panel (see `KeyboardShortcutsDialog`). The pin
 * `KeyboardShortcutsDialog.wiredOnly-11674.test.tsx` fires every listed
 * entry's chord against the real handler, those two included, and fails on a
 * listed entry it has no way to fire.
 *
 * A module store rather than a React context for the same reason as
 * `assistantBus`: the advertisers (the command-palette provider, the layout,
 * the dialog itself) sit on different branches of the tree from the dialog,
 * and an advertisement must reach it without a provider threaded through every
 * layout.
 *
 * @module
 */

import { useEffect, useSyncExternalStore } from 'react';

/** The dialog's sections, in the order it shows them. */
export const SHORTCUT_GROUPS = ['general', 'navigation', 'aiChat'] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/**
 * The key combination a handler answers to.
 *
 * `key` is the `KeyboardEvent.key` the handler matches, lower case for a
 * letter. `mod` is ⌘ on macOS and Ctrl elsewhere: every handler advertised
 * here accepts either.
 */
export interface ShortcutChord {
  key: string;
  mod?: boolean;
  shift?: boolean;
}

/** The translator the dialog hands to {@link AdvertisedShortcut.label}. */
export type ShortcutLabelTranslate = (key: string) => string;

export interface AdvertisedShortcut {
  /** Stable identity: one row per id however many holders advertise it. */
  id: string;
  group: ShortcutGroup;
  chord: ShortcutChord;
  /**
   * The row's text. Written as a literal `t('…')` call so the i18n gates read
   * the key; annotate the parameter as `ShortcutLabelTranslate`.
   */
  label: (t: ShortcutLabelTranslate) => string;
}

/**
 * `⌘⇧H` / `Ctrl+Shift+H` — back to home from any app page (objectui#12605).
 * `AppHeader` owns the listener and advertises this beside it; the app pill's
 * 「Back to home」 row draws its keycaps from the same chord, so the row, the
 * keyboard-shortcuts dialog and the handler cannot disagree. It lives here,
 * not beside either holder, because both read it: a test that stubs one
 * holder's module must not take the other's chord with it.
 */
export const GO_HOME_SHORTCUT: AdvertisedShortcut = {
  id: 'go-home',
  group: 'navigation',
  chord: { key: 'h', mod: true, shift: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.goHome'),
};

const KEYCAP_TEXT: Record<string, string> = { Escape: 'Esc' };

/** The keycaps the dialog draws for a chord: `{ key: 'k', mod: true }` → `['⌘', 'K']`. */
export function shortcutKeycaps(chord: ShortcutChord): string[] {
  const caps: string[] = [];
  if (chord.mod) caps.push('⌘');
  if (chord.shift) caps.push('⇧');
  caps.push(KEYCAP_TEXT[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return caps;
}

interface Holding {
  shortcut: AdvertisedShortcut;
  holders: number;
}

const holdings = new Map<string, Holding>();
const listeners = new Set<() => void>();
// Replaced only when the set of advertised ids changes, so
// `useSyncExternalStore` sees a stable reference between changes.
let snapshot: readonly AdvertisedShortcut[] = [];

function commit(): void {
  snapshot = Array.from(holdings.values(), (holding) => holding.shortcut);
  for (const listener of listeners) listener();
}

/**
 * Advertise `shortcut` until the returned release function is called. A second
 * holder of the same id shares the row; the row leaves when the last one
 * releases. Prefer {@link useAdvertiseShortcut} in a component.
 */
export function advertiseShortcut(shortcut: AdvertisedShortcut): () => void {
  const holding = holdings.get(shortcut.id);
  if (holding) {
    holding.holders += 1;
  } else {
    holdings.set(shortcut.id, { shortcut, holders: 1 });
    commit();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = holdings.get(shortcut.id);
    if (!current) return;
    current.holders -= 1;
    if (current.holders === 0) {
      holdings.delete(shortcut.id);
      commit();
    }
  };
}

/**
 * Advertise `shortcut` while the calling component is mounted and `enabled`.
 * Call it beside the handler the shortcut names, with the same gate the
 * handler has, and pass a module-level constant.
 */
export function useAdvertiseShortcut(shortcut: AdvertisedShortcut, enabled = true): void {
  useEffect(() => (enabled ? advertiseShortcut(shortcut) : undefined), [shortcut, enabled]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly AdvertisedShortcut[] {
  return snapshot;
}

/** The shortcuts advertised right now, in the order they were first advertised. */
export function useAdvertisedShortcuts(): readonly AdvertisedShortcut[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
