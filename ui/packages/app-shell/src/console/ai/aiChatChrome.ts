// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full-page AI chat's chrome: the collapsible conversations list, its
 * keyboard shortcuts, and where "collapse to dock" lands. Split out of
 * `AiChatPage.tsx` move-only (objectstack#37730).
 */

import { useCallback, useState } from 'react';
import type { AdvertisedShortcut, ShortcutLabelTranslate } from '../../chrome/advertisedShortcuts.js';

const CHATS_COLLAPSED_STORAGE_KEY = 'ai-chats-collapsed';

export interface CollapsibleChatsList {
  /** Whether the desktop conversations list is currently hidden. */
  collapsed: boolean;
  /** User-driven collapse/expand; persists the preference. */
  toggle: () => void;
}

/**
 * State for the collapsible desktop conversations list. Exported for tests.
 * `toggle()` flips it and PERSISTS the preference (localStorage).
 *
 * objectstack#34610 — the Live Canvas split that used to tuck the list away
 * while a preview was open is gone (the draft is the main area now), so the
 * user's toggle is the only driver.
 */
export function useCollapsibleChatsList(): CollapsibleChatsList {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHATS_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHATS_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* private mode / disabled storage — preference just won't persist */
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

export type AiChatShortcut = 'toggle-list' | 'new-chat';

/**
 * Match a keydown to an AI-chat shortcut, mirroring ChatGPT/Claude:
 *  - ⌘/Ctrl+Shift+O → new chat
 *  - ⌘/Ctrl+Shift+S → toggle the conversations list
 *
 * Both use the ⌘/Ctrl+Shift modifier so they're safe to fire even while the
 * composer is focused (they can't be produced by ordinary typing). Pure +
 * exported for tests.
 */
export function matchAiChatShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): AiChatShortcut | null {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case 'o':
      return 'new-chat';
    case 's':
      return 'toggle-list';
    default:
      return null;
  }
}

/**
 * The two {@link matchAiChatShortcut} chords, advertised to the
 * keyboard-shortcuts dialog by `AiChatPage` beside the listener that calls it,
 * so they are listed only where that page is mounted (objectui#11674).
 */
export const NEW_CHAT_SHORTCUT: AdvertisedShortcut = {
  id: 'ai-new-chat',
  group: 'aiChat',
  chord: { key: 'o', mod: true, shift: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.newChat'),
};

export const TOGGLE_CHATS_LIST_SHORTCUT: AdvertisedShortcut = {
  id: 'ai-toggle-chats-list',
  group: 'aiChat',
  chord: { key: 's', mod: true, shift: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.toggleChatsList'),
};

/**
 * ADR-0057 P3c — where the "collapse to dock" affordance navigates, in
 * preference order:
 *
 *  1. The REMEMBERED maximize origin (`storedPath`, written by the dock's own
 *     maximize handlers at click time) — the exact page the user left, immune
 *     to in-page history churn (conversation switches push `/ai/...` entries,
 *     so blind history-back can land on a prior `/ai` URL instead of the
 *     console).
 *  2. History back, when react-router has an in-app entry to return to
 *     (`window.history.state.idx > 0` — the router stamps a monotonically
 *     increasing `idx` on entries it creates).
 *  3. `homePath` — the page was the entry point (deep link, fresh tab).
 *
 * `homePath` is a PARAMETER, not a literal, since objectui#7373: home is
 * whatever the deployment declared (`useHomePath()` at the call site), and on a
 * control plane the environment launcher is the wrong screen to land a customer
 * on. Required rather than defaulted, so a new call site cannot silently
 * reintroduce the literal this card removed.
 *
 * The dock itself is armed to open expanded separately
 * ({@link armChatDockExpanded}); this only picks the landing. Pure + exported
 * for tests.
 */
export function resolveCollapseToDockTarget(
  historyIdx: unknown,
  storedPath: string | undefined,
  homePath: string,
): string | -1 {
  if (storedPath) return storedPath;
  return typeof historyIdx === 'number' && historyIdx > 0 ? -1 : homePath;
}
