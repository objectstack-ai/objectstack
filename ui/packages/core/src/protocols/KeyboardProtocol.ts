/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Keyboard Protocol Bridge
 *
 * Converts spec-aligned keyboard navigation and focus management
 * schemas into runtime-usable configurations, shortcut parsers,
 * and focus trap settings.
 *
 * @module protocols/KeyboardProtocol
 * @packageDocumentation
 */

// ============================================================================
// Keyboard / Focus Vocabulary (formerly `@objectstack/spec/ui`)
// ============================================================================
// `@objectstack/spec` 17.0.0-rc.3 deleted the whole `ui/keyboard` module with
// the four other interaction-config modules (objectstack#4988, PR
// objectstack#5321) — none had an authoring door, so no metadata document could
// ever carry a keyboard block. The declarations below are that vocabulary moved
// here verbatim (same keys, same members, same optionality as the retired
// `z.infer` types this module imported through `@object-ui/types`). This bridge
// is the only consumer of the semantics and is now their owner; resolver
// behaviour is unchanged. See `DndProtocol.ts` for the objectui#3363 premise
// correction that applies to this file too.

/** A single keyboard shortcut binding. */
export interface KeyboardShortcut {
  key: string;
  action: string;
  description?: string;
  scope: 'global' | 'form' | 'modal' | 'view' | 'list';
}

/** Focus trap declaration for a modal-like region. */
export interface FocusTrapConfig {
  enabled: boolean;
  initialFocus?: string;
  returnFocus: boolean;
  escapeDeactivates: boolean;
}

/** Focus management declaration. */
export interface FocusManagement {
  tabOrder: 'manual' | 'auto';
  skipLinks: boolean;
  focusVisible: boolean;
  focusTrap?: FocusTrapConfig;
  arrowNavigation: boolean;
}

/** Top-level keyboard navigation configuration. */
export interface KeyboardNavigationConfig {
  shortcuts?: KeyboardShortcut[];
  focusManagement?: FocusManagement;
  rovingTabindex: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  role?: string;
}

// ============================================================================
// Resolved Types
// ============================================================================

/** Fully resolved keyboard navigation configuration. */
export interface ResolvedKeyboardConfig {
  shortcuts: KeyboardShortcut[];
  focusManagement: ResolvedFocusManagement;
  rovingTabindex: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  role?: string;
}

/** Fully resolved focus management configuration. */
export interface ResolvedFocusManagement {
  tabOrder: 'auto' | 'manual';
  skipLinks: boolean;
  focusVisible: boolean;
  focusTrap?: ResolvedFocusTrapConfig;
  arrowNavigation: boolean;
}

/** Fully resolved focus trap configuration. */
export interface ResolvedFocusTrapConfig {
  enabled: boolean;
  initialFocus?: string;
  returnFocus: boolean;
  escapeDeactivates: boolean;
}

/** Parsed keyboard shortcut descriptor. */
export interface ParsedShortcut {
  key: string;
  ctrlOrMeta: boolean;
  shift: boolean;
  alt: boolean;
}

/** Minimal keyboard event shape for matching (no React dependency). */
export interface KeyboardEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

// ============================================================================
// Keyboard Config Resolution
// ============================================================================

/**
 * Resolve a keyboard navigation configuration by applying spec defaults.
 *
 * @param config - KeyboardNavigationConfig from the spec
 * @returns Fully resolved keyboard navigation configuration
 */
export function resolveKeyboardConfig(config: KeyboardNavigationConfig): ResolvedKeyboardConfig {
  return {
    shortcuts: config.shortcuts ?? [],
    focusManagement: resolveFocusManagement(config.focusManagement),
    rovingTabindex: config.rovingTabindex ?? false,
    ariaLabel: config.ariaLabel,
    ariaDescribedBy: config.ariaDescribedBy,
    role: config.role,
  };
}

/**
 * Resolve focus management configuration with defaults.
 */
function resolveFocusManagement(fm?: FocusManagement): ResolvedFocusManagement {
  return {
    tabOrder: fm?.tabOrder ?? 'auto',
    skipLinks: fm?.skipLinks ?? false,
    focusVisible: fm?.focusVisible ?? true,
    focusTrap: fm?.focusTrap ? createFocusTrapConfig(fm.focusTrap) : undefined,
    arrowNavigation: fm?.arrowNavigation ?? false,
  };
}

// ============================================================================
// Shortcut Parsing
// ============================================================================

/**
 * Parse a shortcut string like "Ctrl+Shift+S" into a structured descriptor.
 * Recognises Ctrl, Meta, Cmd (mapped to ctrlOrMeta), Shift, and Alt modifiers.
 * The last segment is treated as the key.
 *
 * Keys are normalised to lowercase for case-insensitive matching. The Shift
 * modifier is tracked separately, so "Shift+A" and "Shift+a" are equivalent
 * (both represent the same physical key combination).
 *
 * @param shortcut - Shortcut string (e.g. "Ctrl+S", "Alt+Shift+N", "Escape")
 * @returns Parsed shortcut descriptor
 */
export function parseShortcutKey(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+').map(p => p.trim());
  const modifiers = new Set(parts.slice(0, -1).map(m => m.toLowerCase()));
  const key = (parts[parts.length - 1] ?? '').toLowerCase();

  return {
    key,
    ctrlOrMeta: modifiers.has('ctrl') || modifiers.has('meta') || modifiers.has('cmd'),
    shift: modifiers.has('shift'),
    alt: modifiers.has('alt'),
  };
}

// ============================================================================
// Shortcut Matching
// ============================================================================

/**
 * Test whether a keyboard event matches a shortcut string.
 * Comparison is case-insensitive; the Shift modifier is checked separately.
 *
 * @param event - The keyboard event (or a plain object with key + modifier flags)
 * @param shortcut - Shortcut string (e.g. "Ctrl+S")
 * @returns `true` if the event matches the shortcut
 */
export function matchesShortcut(event: KeyboardEventLike, shortcut: string): boolean {
  const parsed = parseShortcutKey(shortcut);

  if (event.key.toLowerCase() !== parsed.key) return false;

  const eventCtrlOrMeta = !!(event.ctrlKey || event.metaKey);
  if (parsed.ctrlOrMeta !== eventCtrlOrMeta) return false;

  if (parsed.shift !== !!(event.shiftKey)) return false;
  if (parsed.alt !== !!(event.altKey)) return false;

  return true;
}

// ============================================================================
// Focus Trap Configuration
// ============================================================================

/**
 * Create a resolved focus trap configuration from a spec FocusTrapConfig.
 *
 * @param config - FocusTrapConfig from the spec
 * @returns Resolved focus trap configuration with defaults applied
 */
export function createFocusTrapConfig(config: FocusTrapConfig): ResolvedFocusTrapConfig {
  return {
    enabled: config.enabled ?? false,
    initialFocus: config.initialFocus,
    returnFocus: config.returnFocus ?? true,
    escapeDeactivates: config.escapeDeactivates ?? true,
  };
}
