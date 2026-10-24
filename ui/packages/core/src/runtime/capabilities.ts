/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Runtime capability gates — switches a *host* controls, never authored
 * metadata. Each capability has a default; a host can flip it explicitly
 * (`enableCapability`/`disableCapability`) or seed it from globals before any
 * bundle code runs.
 *
 * {@link CAP_REACT_PAGES} (`kind:'react'` — execute author JavaScript in the
 * main React tree) defaults **ON**: ObjectStack pages are authored by trusted
 * authors and pass human review (draft-gating, ADR-0033), so the platform
 * trusts them by default. A deployment that does NOT trust its page authors
 * turns it off server-side — the ObjectStack runtime injects the disable global
 * when `OS_PAGE_REACT=off` (see framework cli/utils/console.ts).
 *
 * Globals a host/server can set in the page before the bundle runs:
 *   - `globalThis.__OBJECTUI_CAPABILITIES__`          — string[] to force ON
 *   - `globalThis.__OBJECTUI_CAPABILITIES_DISABLED__` — string[] to force OFF
 */

/** Default state per capability when neither the host nor a global overrides it. */
const DEFAULTS: Record<string, boolean> = {
  'react-pages': true,
};

// Explicit host overrides (enable/disable) — win over defaults and globals.
const overrides = new Map<string, boolean>();

let _seeded = false;
function seedFromGlobals(): void {
  if (_seeded) return;
  _seeded = true;
  const g = globalThis as unknown as {
    __OBJECTUI_CAPABILITIES__?: unknown;
    __OBJECTUI_CAPABILITIES_DISABLED__?: unknown;
  };
  if (Array.isArray(g.__OBJECTUI_CAPABILITIES__)) {
    for (const c of g.__OBJECTUI_CAPABILITIES__) if (typeof c === 'string' && !overrides.has(c)) overrides.set(c, true);
  }
  if (Array.isArray(g.__OBJECTUI_CAPABILITIES_DISABLED__)) {
    // Disable wins: a server that turned something off must not be overridden
    // by a stale enable-list left in the same page.
    for (const c of g.__OBJECTUI_CAPABILITIES_DISABLED__) if (typeof c === 'string') overrides.set(c, false);
  }
}

/** Turn a capability on. Call from the host process only (not from metadata). */
export function enableCapability(name: string): void {
  seedFromGlobals();
  overrides.set(name, true);
}

/** Turn a capability off. */
export function disableCapability(name: string): void {
  seedFromGlobals();
  overrides.set(name, false);
}

/** Whether a capability is enabled. Host/global override wins over the default. */
export function isCapabilityEnabled(name: string): boolean {
  seedFromGlobals();
  const o = overrides.get(name);
  if (o !== undefined) return o;
  return DEFAULTS[name] ?? false;
}

/**
 * `kind:'react'` — execute trusted author JavaScript (full React: hooks, event
 * handlers, arbitrary JS) directly in the main React tree. Default ON; a
 * deployment disables it server-side with `OS_PAGE_REACT=off`.
 */
export const CAP_REACT_PAGES = 'react-pages';
