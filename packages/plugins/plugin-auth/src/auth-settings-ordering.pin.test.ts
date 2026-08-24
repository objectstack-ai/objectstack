// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AuthPlugin`'s settings ORDERING contract (#11579) — declared, not incidental.
 *
 * ## What went wrong
 *
 * `SettingsServicePlugin` binds its data engine from a `kernel:ready` hook
 * registered in its `start()`. `AuthPlugin` reaches `getService('settings')`
 * from `kernel:ready` hooks registered in ITS `start()` — at depth 3, through
 * `runBackfill` → `ensureAuthSettingsBound` → `bindAuthSettings` — and calls
 * `settings.getNamespace('auth')` in the same tick.
 *
 * Hooks fire in registration order, and registration order is `start()` order,
 * so whichever plugin starts first registers the earlier hook. Until this
 * change **nothing constrained that order**: `AuthPlugin` declared
 * `dependencies: ['com.objectstack.engine.objectql']` and nothing about
 * settings, and `resolvePluginOrder` preserves insertion order for plugins
 * with no edge between them. On the shipped composition that ordering was not
 * merely unconstrained but WRONG — `os serve` does `kernel.use(new
 * AuthPlugin(...))` before the capability loop registers
 * `SettingsServicePlugin` — so at boot `getNamespace('auth')` took
 * `SettingsService`'s empty in-memory fallback and answered the manifest
 * DEFAULTS with `source: 'default'`, while the workspace's saved `sys_setting`
 * rows sat unread. `settings.subscribe('auth', …)` only re-applies on a LATER
 * change, so a deployment that configured auth in Setup and never touched it
 * again kept booting on defaults.
 *
 * ## The division of labour with `check:settings-bind-window`
 *
 * Two different claims, checked in two different ways, both in CI:
 *
 *  - **That the edge names the REAL provider, and that the read is still in
 *    the window at all** is `scripts/check-settings-bind-window.mjs`. It walks
 *    the TypeScript AST, DERIVES the provider from whoever declares
 *    `providesServices: ['settings']`, and fails if a `start()`-registered
 *    `kernel:ready` read is not covered by a declaration naming it. That is
 *    why `SETTINGS_PLUGIN` below is not cross-checked against the settings
 *    package here: a unit test comparing the constant to the same declaration
 *    it came from would pass on a typo. The gate is what cannot.
 *  - **That the declaration MOVES the order** is this file. A declaration
 *    nothing acts on is the defect, not the fix (ADR-0049), and the gate is
 *    satisfied by the declaration's presence alone.
 *
 * ## Resolution note
 *
 * `AuthPlugin` is imported from SOURCE (a relative specifier inside this
 * package), which is what this file is a verdict about. `resolvePluginOrder`
 * comes from `@objectstack/core`, a bare workspace specifier already listed in
 * `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/plugin-auth']`
 * (`scripts/check-test-source-alias.mjs`), so it resolves to that package's
 * `dist/` — the ordering algorithm is the fixed instrument here, not the
 * subject.
 *
 * The settings plugin is a NAME-ONLY stub rather than the real
 * `SettingsServicePlugin`: `@objectstack/service-settings` is not a dependency
 * of `@objectstack/plugin-auth`, and adding one so a test could import it
 * would both create a workspace edge that exists for nothing else and force a
 * new entry into the shrink-only registry above. `resolvePluginOrder` reads
 * only the `OrderablePlugin` surface — `name`, `dependencies`,
 * `optionalDependencies` — and the property under test is `AuthPlugin`'s
 * declaration, so the stub is the whole of what the resolver would see.
 */

import { describe, it, expect } from 'vitest';
import { resolvePluginOrder } from '@objectstack/core';
import type { OrderablePlugin } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';

const SETTINGS_PLUGIN = 'com.objectstack.service.settings';
const ENGINE_PLUGIN = 'com.objectstack.engine.objectql';

/**
 * `AuthPlugin` declares `com.objectstack.engine.objectql` a HARD dependency,
 * so every registry below has to contain it or `resolvePluginOrder` throws
 * before it can order anything. Name-only: this module orders plugins by their
 * declarations and never runs a lifecycle.
 */
const engineStub = (): OrderablePlugin => ({ name: ENGINE_PLUGIN });

/** See the resolution note in the header for why this is a stub. */
const settingsStub = (): OrderablePlugin => ({ name: SETTINGS_PLUGIN });

const authPlugin = (): OrderablePlugin =>
  new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long!!' }) as unknown as OrderablePlugin;

/** Registry in the given insertion order — `resolvePluginOrder` preserves it
 *  for plugins with no edges between them, which is what makes the hostile
 *  order below hostile. */
const registryOf = (...plugins: OrderablePlugin[]) =>
  new Map<string, OrderablePlugin>(plugins.map((p) => [p.name, p]));

describe('AuthPlugin declares the settings ordering edge (ADR-0116, #11579)', () => {
  it('1. declares `com.objectstack.service.settings` as an OPTIONAL dependency', () => {
    const auth = authPlugin();
    expect(auth.optionalDependencies ?? []).toContain(SETTINGS_PLUGIN);
    // Not a hard one: case 4 is the behavioural half of this, but the
    // declaration site is asserted directly too, because promoting the edge to
    // `dependencies` would pass case 2 and 3 while breaking every lean kernel.
    expect(auth.dependencies ?? []).not.toContain(SETTINGS_PLUGIN);
    // The pre-existing hard edge is untouched — this change adds an edge, it
    // does not move one.
    expect(auth.dependencies ?? []).toContain(ENGINE_PLUGIN);
  });

  it('2. the declaration MOVES resolution order — settings inits/starts first even when used last', () => {
    // `ObjectKernel.bootstrap` and `LiteKernel.bootstrap` both iterate the SAME
    // `resolvePluginOrder` output for Phase 1 (init) and Phase 2 (start), so
    // this is the order the `kernel:ready` hooks get registered in.
    const auth = authPlugin();
    // The shipped hostile order: `os serve` uses AuthPlugin BEFORE the
    // capability loop registers the settings plugin.
    const ordered = resolvePluginOrder(registryOf(engineStub(), auth, settingsStub()))
      .map((p) => p.name);
    expect(ordered.indexOf(SETTINGS_PLUGIN)).toBeLessThan(ordered.indexOf(auth.name));
  });

  it('3. …and the declaration is what does it — forget it and the order reverts', () => {
    // The ADR-0049 half. Case 2 alone would still pass if `resolvePluginOrder`
    // happened to hoist by some other rule; this proves the DECLARATION is the
    // cause by removing it from a live instance and re-resolving.
    const auth = authPlugin();
    auth.optionalDependencies = (auth.optionalDependencies ?? []).filter(
      (d) => d !== SETTINGS_PLUGIN,
    );

    const ordered = resolvePluginOrder(registryOf(engineStub(), auth, settingsStub()))
      .map((p) => p.name);
    // Insertion order is preserved for plugins with no edges between them — so
    // with the declaration gone the reader is back in front, which is the
    // defect this card was filed about.
    expect(
      ordered.indexOf(auth.name),
      'without the declaration auth must come back first — if this passes, case 2 was not measuring the declaration',
    ).toBeLessThan(ordered.indexOf(SETTINGS_PLUGIN));
  });

  it('4. the edge is SOFT — a kernel with no settings plugin still resolves', () => {
    // `optionalDependencies` is order-if-present. A hard dependency here would
    // refuse to boot every metadata-only / lean kernel that composes auth
    // without a settings service — `bindAuthSettings` already returns early
    // when the service is absent.
    const auth = authPlugin();
    const registry = registryOf(engineStub(), auth);
    expect(() => resolvePluginOrder(registry)).not.toThrow();
    expect(resolvePluginOrder(registry).map((p) => p.name)).toContain(auth.name);
  });

  it('5. the edge introduces no cycle — auth is not upstream of settings', () => {
    // `resolvePluginOrder` throws `[Kernel] Circular dependency detected` when
    // both directions are declared, and an optional edge is a real edge
    // whenever both sides are composed. The settings plugin declares only
    // `com.objectstack.engine.objectql`, so this direction is free — asserted
    // rather than assumed, because the check that would otherwise catch it
    // (`check:settings-bind-window`'s `cycle` verdict) reports it as a finding
    // rather than as this plugin's failure.
    const settingsWithItsRealEdge: OrderablePlugin = {
      name: SETTINGS_PLUGIN,
      optionalDependencies: [ENGINE_PLUGIN],
    };
    const auth = authPlugin();
    const ordered = resolvePluginOrder(registryOf(engineStub(), auth, settingsWithItsRealEdge))
      .map((p) => p.name);
    expect(ordered).toEqual([ENGINE_PLUGIN, SETTINGS_PLUGIN, auth.name]);
  });
});
