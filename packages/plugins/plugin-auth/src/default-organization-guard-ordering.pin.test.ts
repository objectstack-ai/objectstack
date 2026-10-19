// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Default Organization is created only once the v18 boot guard has judged
 * the database (ADR-0131 D10 item 5) — declared, not incidental.
 *
 * `AuthPlugin.start()` and `IdentityObjectsPlugin.start()` create the Default
 * Organization under `single` (ADR-0131 D3). The guard
 * (`@objectstack/runtime`'s `OrganizationOwnershipBootGuardPlugin`) judges in
 * its own `start()`, and a database it refuses must be left as it found it, so
 * both plugins name it in `optionalDependencies`. This file proves the
 * declaration is what moves the order: a hostile registry (the writer used
 * BEFORE the guard) still starts the guard first, and the same registry with
 * the declaration removed does not. A bare kernel boot of the same property,
 * with the real guard, is `runtime/src/organization-ownership-boot-guard.kernel.test.ts`.
 *
 * The guard is a NAME-ONLY stub: this package does not depend on the runtime,
 * and `resolvePluginOrder` reads only the `OrderablePlugin` surface (see
 * `auth-settings-ordering.pin.test.ts`'s resolution note for the same choice).
 */

import { describe, expect, it } from 'vitest';
import { resolvePluginOrder } from '@objectstack/core';
import type { OrderablePlugin } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';
import { IdentityObjectsPlugin } from './identity-objects-plugin.js';

const GUARD_PLUGIN = 'com.objectstack.organization-ownership-boot-guard';
const ENGINE_PLUGIN = 'com.objectstack.engine.objectql';

const writers: Array<[string, () => OrderablePlugin]> = [
  ['AuthPlugin', () => new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long!!' }) as unknown as OrderablePlugin],
  ['IdentityObjectsPlugin', () => new IdentityObjectsPlugin() as unknown as OrderablePlugin],
];

/** The guard as the resolver sees it: its name and its own order-if-present edge on the engine. */
const guardStub = (): OrderablePlugin => ({ name: GUARD_PLUGIN, optionalDependencies: [ENGINE_PLUGIN] });

const orderOf = (...plugins: OrderablePlugin[]): string[] =>
  resolvePluginOrder(new Map(plugins.map((p) => [p.name, p]))).map((p) => p.name);

describe.each(writers)('%s creates the Default Organization only after the v18 boot guard has judged', (_label, make) => {
  it('declares the guard as an OPTIONAL dependency', () => {
    const writer = make();
    expect(writer.optionalDependencies ?? []).toContain(GUARD_PLUGIN);
    expect(writer.dependencies ?? []).not.toContain(GUARD_PLUGIN);
  });

  it('⭐ the declaration moves the order: used BEFORE the guard, it still starts after it', () => {
    const writer = make();
    const ordered = orderOf({ name: ENGINE_PLUGIN }, writer, guardStub());
    expect(ordered.indexOf(GUARD_PLUGIN)).toBeLessThan(ordered.indexOf(writer.name));
  });

  it('…and the declaration is what does it: forget it and the writer starts first', () => {
    const writer = make();
    writer.optionalDependencies = (writer.optionalDependencies ?? []).filter((d) => d !== GUARD_PLUGIN);
    const ordered = orderOf({ name: ENGINE_PLUGIN }, writer, guardStub());
    expect(ordered.indexOf(writer.name)).toBeLessThan(ordered.indexOf(GUARD_PLUGIN));
  });

  it('order-if-present: a kernel that composes no guard resolves as before', () => {
    const writer = make();
    expect(orderOf({ name: ENGINE_PLUGIN }, writer)).toContain(writer.name);
  });
});
