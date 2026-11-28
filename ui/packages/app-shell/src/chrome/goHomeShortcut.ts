// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `⌘⇧H` / `Ctrl+Shift+H` — Home from any app page: on a phone its app list,
 * from 768 px up the last-used app's start page, where `/` lands now the
 * platform home page is retired (objectstack#36732). The app layout installs
 * it (`ConsoleLayout`), at every width, so it does not depend on a top bar
 * being drawn.
 * @module
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GO_HOME_SHORTCUT,
  GO_TO_APP_START_SHORTCUT,
  useAdvertiseShortcut,
  type ShortcutChord,
} from './advertisedShortcuts.js';
import { confirmUnsavedLeave } from './unsavedEdits.js';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';

/**
 * Whether a keydown is `chord`: ⌘ or Ctrl exactly when the chord has `mod`
 * (the advertised chords accept either), Shift exactly when it has `shift`,
 * never Alt, and the key compared case-blind (Shift makes it upper case).
 */
function matchesShortcutChord(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  chord: ShortcutChord,
): boolean {
  if (e.altKey) return false;
  if (Boolean(chord.mod) !== (e.metaKey || e.ctrlKey)) return false;
  if (Boolean(chord.shift) !== e.shiftKey) return false;
  return e.key.toLowerCase() === chord.key;
}

/**
 * A keydown aimed at something the user types into: a text field, a select,
 * a content-editable region (rich-text and code editors), or an ARIA textbox.
 * The home chord leaves those alone, so an editor that binds the same keys
 * keeps them (objectui#12605).
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}

/**
 * `⌘⇧H` / `Ctrl+Shift+H` goes to `homePath` from any app page, as a PUSH so
 * the browser's Back returns to the page (objectui#12605). Advertised beside
 * the listener, under the same gate, so the keyboard-shortcuts dialog lists it
 * exactly where it fires (objectui#11674), and named for where it goes: 「Back
 * to home」 on a phone, the last-used app's start page from 768 px up, where
 * `useHomePath()` no longer names a home page (objectstack#36732).
 */
export function useGoHomeShortcut(enabled: boolean, homePath: string): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!matchesShortcutChord(e, GO_HOME_SHORTCUT.chord)) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      // A page holding unsaved edits is asked first (objectui#13231).
      confirmUnsavedLeave(() => navigate(homePath));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, homePath, navigate]);
  const phone = usePhoneViewport();
  useAdvertiseShortcut(phone ? GO_HOME_SHORTCUT : GO_TO_APP_START_SHORTCUT, enabled);
}

