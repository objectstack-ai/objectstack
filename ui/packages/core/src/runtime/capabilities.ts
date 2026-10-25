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
 * main React tree, no sandbox) defaults **OFF**: whether a deployment's page
 * authors are trusted is the operator's call, so the host turns it on
 * explicitly. The ObjectStack runtime injects the enable global when the
 * deployment sets `OS_PAGE_REACT_ENABLED=true`, and the disable global
 * otherwise (objectstack `packages/cli/src/utils/console.ts`,
 * `readReactPagesTier`; ADR-0081 as amended).
 *
 * Globals a host/server can set in the page before the bundle runs:
 *   - `globalThis.__OBJECTUI_CAPABILITIES__`          — string[] to force ON
 *   - `globalThis.__OBJECTUI_CAPABILITIES_DISABLED__` — string[] to force OFF
 */

/** Default state per capability when neither the host nor a global overrides it. */
const DEFAULTS: Record<string, boolean> = {
  'react-pages': false,
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
 * handlers, arbitrary JS) directly in the main React tree. Default OFF; a
 * deployment turns it on server-side with `OS_PAGE_REACT_ENABLED=true`.
 */
export const CAP_REACT_PAGES = 'react-pages';
