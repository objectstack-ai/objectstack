// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Detect whether a loaded config is a host/aggregator configuration.
 *
 * A host config already contains a `plugins` array with instantiated Plugin
 * objects (i.e. objects that have an `init` method). Such configs must NOT
 * be wrapped again by AppPlugin in the CLI, as that would cause duplicate
 * plugin registration and startup failures.
 */
export function isHostConfig(config: any): boolean {
  return (
    Array.isArray(config.plugins) &&
    config.plugins.some((p: any) => typeof p?.init === 'function')
  );
}

/**
 * Returns true when a bare `defineStack()` config should be booted via
 * `createBootStack()` (full project / cloud / standalone stack) rather
 * than the CLI's lightweight in-memory plugin assembler.
 *
 * **Default behaviour: enabled.** Project mode is the canonical OS dev
 * workflow — every bare `defineStack()` config gets the full stack
 * (ObjectQL + Auth + Console + control plane) unless one of the
 * opt-out conditions below applies.
 *
 * Skips library boot when:
 *   1. The config is a host config (already has instantiated plugins).
 *   2. `OS_MODE=off` is explicitly set (escape hatch for the
 *      legacy lightweight assembler).
 *
 * Recognised mode aliases match the cloud distribution's
 * `resolveMode()` (kept in sync for back-compat).
 */
const RECOGNISED_MODES = new Set([
  'runtime',
  'cloud',
  'standalone',
  // Deprecated aliases (kept for back-compat — emit a console warning at boot).
  'project',
  'local',
  'single-environment',
  'multi-environment',
]);

export function shouldBootWithLibrary(config: any): boolean {
  if (isHostConfig(config)) return false;
  const mode = process.env.OS_MODE?.trim().toLowerCase();
  if (mode === 'off' || mode === 'none' || mode === 'legacy') return false;
  if (mode && !RECOGNISED_MODES.has(mode)) {
    console.warn(`[objectstack] Unknown OS_MODE=${mode}; falling back to standalone mode.`);
  }
  if (config?.bootMode === 'off') return false;
  return true;
}
