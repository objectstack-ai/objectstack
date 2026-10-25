/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// `src/index.tsx` pulls in `ObjectMap.tsx`, which imports the real map bindings.
// Stub them so a plain module import needs no WebGL canvas (`maplibre-gl` itself
// is already stubbed in the repo-root `vitest.setup.base.ts`, which every project
// loads). This used to name `packages/plugin-map/vitest.setup.ts`, a copy of that
// same mock that only the package's own vitest config loaded — i.e. never under
// the invocation CI runs. objectui#3240 deleted the config and the copy.
vi.mock('react-map-gl/maplibre', () => ({
  default: () => null,
  Map: () => null,
  NavigationControl: () => null,
  Marker: () => null,
  Popup: () => null,
}));

// AGENTS.md §9 测试纪律 — the assertion below re-imports this module after
// `vi.resetModules()`, and that import drags in the whole component graph
// (`@object-ui/components`, `@object-ui/react`, the map bindings). Loading it
// for the FIRST time inside the test put an unbounded transform inside the 5s
// test budget: this file timed out when run on its own and stayed green only
// while a sibling file happened to warm the transform cache first — an order
// dependency that broke as soon as the package gained another test file
// (objectui#4941). Importing the same specifiers at module scope moves the cost
// into the import phase, which no test/hook timeout bounds, and leaves the
// in-test import to re-EXECUTE an already-transformed graph. The specifiers
// must match the in-test ones exactly for the cache to serve them.
import './index';
import '@object-ui/core';

/**
 * Regression pin for objectstack#7139: a leftover
 * `console.log('Registering object-map...')` sat at this module's top level, so
 * *merely loading* the plugin printed to the console — in the console app (where
 * `register-plugins` imports it eagerly), in tests, and in the production bundle.
 *
 * Scope note — this asserts the debug-noise channels (`log`/`info`/`debug`) only,
 * deliberately not `warn`/`error`. `ComponentRegistry.register()` warns by design
 * on namespace-less registration and on bare-name fallback collisions
 * (`packages/core/src/registry/Registry.ts`), so a blanket "zero console output"
 * assertion here would be pinning *Registry's* diagnostics contract rather than
 * this module's, and would go red for reasons unrelated to a leftover debug print.
 * The defect class being pinned is the leftover debug print itself.
 */
const NOISE_CHANNELS = ['log', 'info', 'debug'] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('plugin-map module load', () => {
  it('registers its components without printing to the console', async () => {
    const spies = new Map(
      NOISE_CHANNELS.map((channel) => [
        channel,
        vi.spyOn(console, channel).mockImplementation(() => {}),
      ])
    );

    // Re-evaluate the module even if another test file already imported it, so
    // the top-level side effects actually run under the spies rather than being
    // served from the module cache (which would make this assertion vacuous).
    vi.resetModules();
    await import('./index');

    // Non-vacuity guard: prove the module body really executed. Without this a
    // silently skipped import would satisfy the console assertion for the wrong
    // reason — green because nothing happened, not because nothing printed.
    const { ComponentRegistry } = await import('@object-ui/core');
    expect(ComponentRegistry.has('object-map', 'plugin-map')).toBe(true);

    const printed = NOISE_CHANNELS.flatMap((channel) =>
      spies.get(channel)!.mock.calls.map((args) => `console.${channel}(${JSON.stringify(args)})`)
    );
    expect(printed).toEqual([]);
  });
});
