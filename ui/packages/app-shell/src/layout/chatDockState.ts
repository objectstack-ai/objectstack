/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3a/P3c — state helpers for the ChatDock (the right-docked console
 * AI rail). Kept React-free so the width math and the keyboard matcher are
 * unit-testable without the component tree; the storage round-trip helpers
 * guard every `sessionStorage` touch so they degrade to defaults in private
 * mode (and no-op cleanly under a DOM-less test runner).
 */

export const DOCK_WIDTH_STORAGE_KEY = 'ai-chat-dock-width';
/**
 * ADR-0057 P3c — sessionStorage key holding `'1'` when the dock should mount
 * EXPANDED. Armed by the `/ai` page's "collapse to dock" affordance (so landing
 * back in the console shows the same thread in the rail, completing the
 * maximize ⇄ tuck loop), and kept up to date by expand/collapse so the rail
 * survives in-tab navigation between console pages. sessionStorage — not
 * localStorage — on purpose: a fresh tab/session keeps P3a's default-collapsed
 * virtue (zero layout cost until invoked), and the flag can never leak into a
 * shared URL (ADR-0013 deep links stay clean).
 */
export const DOCK_EXPANDED_STORAGE_KEY = 'ai-chat-dock-expanded';
/**
 * sessionStorage key for whether the STUDIO right slot is shown (objectui#12725;
 * the Studio right dock's expanded/collapsed state before it). Distinct from
 * the console key so the two surfaces never fight over one flag. The slot
 * shows by default, but a user who hides it keeps it hidden across pillar /
 * package switches and re-entering Studio in the same tab — the annoyance was
 * it re-opening every time (issue #2477 item 2). Per-tab (sessionStorage): a
 * fresh tab re-defaults to the slot shown.
 */
export const DOCK_STUDIO_EXPANDED_STORAGE_KEY = 'ai-chat-studio-dock-expanded';
/** Default rail width (px). */
export const DOCK_DEFAULT_WIDTH = 420;
/** The rail never narrower than this. */
export const DOCK_MIN_WIDTH = 340;
/** The main content always keeps at least this much room (caps rail growth). */
export const DOCK_CONTENT_MIN_WIDTH = 520;
/** Keyboard resize step (px) when the divider is focused. */
export const DOCK_KEYBOARD_STEP = 24;

/**
 * Clamp a desired rail width so neither pane collapses: at least
 * {@link DOCK_MIN_WIDTH}, and never so wide that the main content drops below
 * {@link DOCK_CONTENT_MIN_WIDTH}. `containerWidth <= 0` (unmeasured) skips the
 * upper bound. Pure + exported for tests.
 */
export function clampDockWidth(desired: number, containerWidth: number): number {
  const upper =
    containerWidth > 0 ? Math.max(DOCK_MIN_WIDTH, containerWidth - DOCK_CONTENT_MIN_WIDTH) : Infinity;
  return Math.min(Math.max(desired, DOCK_MIN_WIDTH), upper);
}

/**
 * ADR-0057 P3c / ADR-0037 — the widest legal rail for a container: the Live
 * Canvas "maximize in place" width. Just {@link clampDockWidth} pinned to its
 * own upper bound (main content keeps {@link DOCK_CONTENT_MIN_WIDTH}), named so
 * call sites read as intent. Pure + exported for tests.
 */
export function maximizedDockWidth(containerWidth: number): number {
  return clampDockWidth(containerWidth, containerWidth);
}

/**
 * Parse the stored expanded value — `'1'` → expanded, `'0'` → collapsed;
 * anything else (incl. null) is "unset", returned as `null` so the caller can
 * fall back to its own default. Distinguishing "explicitly collapsed" (`'0'`)
 * from "never set" (null) is what lets a default-EXPANDED surface (Studio)
 * remember a collapse — a bare remove-on-collapse would read back as unset and
 * re-expand. Pure + exported for tests.
 */
export function parseStoredDockExpanded(raw: string | null): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** Read a stored expanded flag; unset OR storage failure (private mode) → `fallback`. */
export function readStoredDockExpanded(key: string, fallback: boolean): boolean {
  try {
    const parsed = parseStoredDockExpanded(window.sessionStorage.getItem(key));
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/**
 * Persist an expanded flag as `'1'` / `'0'` (never a remove) — see
 * {@link parseStoredDockExpanded} for why collapse must be stored explicitly.
 * Storage failures are swallowed.
 */
export function writeStoredDockExpanded(key: string, expanded: boolean): void {
  try {
    window.sessionStorage.setItem(key, expanded ? '1' : '0');
  } catch {
    /* private mode — the rail just won't survive navigation */
  }
}

/**
 * ADR-0057 P3c — arm the console dock to mount EXPANDED on the next page that
 * hosts it. The `/ai` page's "collapse to dock" affordance calls this right
 * before navigating back, completing the maximize ⇄ tuck loop with the same
 * thread showing in the rail. Lives here (not ChatDock.tsx) so AiChatPage can
 * import it without a module cycle — ChatDock.tsx imports ChatPane FROM
 * AiChatPage.
 */
export function armChatDockExpanded(): void {
  writeStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, true);
}

/**
 * sessionStorage key holding the in-app path (`pathname?search`) the user
 * maximized the dock FROM — a console page, or the Studio design surface. The
 * `/ai` page's collapse-to-dock prefers it over blind history-back, so the
 * round trip lands exactly where the user left (history-back could land on a
 * prior `/ai` URL after in-page conversation switches). Written by the
 * maximize handlers at click time (the only moment the origin is known);
 * per-tab by design.
 */
export const DOCK_RETURN_TO_STORAGE_KEY = 'ai-chat-dock-return-to';

/** Record where a dock→`/ai` maximize departed from (see the key's doc). */
export function rememberDockReturnLocation(path: string): void {
  try {
    window.sessionStorage.setItem(DOCK_RETURN_TO_STORAGE_KEY, path);
  } catch {
    /* private mode — collapse just falls back to history-back */
  }
}

/** The remembered maximize origin — only an in-app absolute path is trusted. */
export function readDockReturnLocation(): string | undefined {
  try {
    const raw = window.sessionStorage.getItem(DOCK_RETURN_TO_STORAGE_KEY);
    // Reject anything that isn't a same-app absolute path ('//host' included),
    // so a corrupted/injected value can never turn this into an open redirect.
    return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : undefined;
  } catch {
    return undefined;
  }
}

export type ChatDockShortcut = 'toggle';

/**
 * Match a keydown to the ChatDock toggle — ⌘/Ctrl+Shift+I (the ADR's ⌘I idiom,
 * made composer-safe with Shift so ordinary typing can't produce it, mirroring
 * {@link matchAiChatShortcut}). Distinct from the AI-chat page shortcuts (O / S).
 * Pure + exported for tests.
 */
export function matchChatDockShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): ChatDockShortcut | null {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return null;
  return e.key.toLowerCase() === 'i' ? 'toggle' : null;
}
