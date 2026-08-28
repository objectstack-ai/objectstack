// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';
import type { ServiceObject } from '@objectstack/spec/data';

/**
 * #12623 — `SchemaRegistry.registerObject`'s `packageId` parameter is
 * optional (maintainer ruling, issue #12623 comment 5434929046, Option A),
 * matching the sibling `registerItem` and the behaviour `applyProtection`
 * (`packages/spec/src/shared/protection.zod.ts`) already documents as
 * intended: "bare `registerItem(type, item)` calls without a package
 * context still produce a clean item."
 *
 * The risk the ruling names by hand is NOT "packageId required" — it is
 * "packageId optional WITH A DEFAULT", the way the engine facade defaults
 * to `'__runtime__'` (`engine.ts`, deliberately out of scope here). Because
 * `applyProtection` runs UNCONDITIONALLY on every `registerObject` call
 * (`registry.ts`, `applyProtection(schema as any, { packageId })`), a
 * quietly-defaulted `packageId` would stamp `_packageId` and
 * `_provenance: 'package'` onto every bare-call registration — exactly the
 * fixtures the helper's own comment says must stay clean — silently, at
 * every one of the 82 single-argument call sites this repo carries.
 *
 * This pin is the whole test for that distinction. It asserts on KEY
 * PRESENCE via `hasOwnProperty`, not `=== undefined`: a default that
 * resolves to `undefined` at call time but still assigns the key (e.g.
 * `applyProtection`'s own `_provenance = ctx.provenance ?? 'package'`
 * pattern, misapplied one layer up) must still fail this pin, which
 * `=== undefined` alone would miss.
 */
describe('SchemaRegistry.registerObject — optional packageId, no default (#12623)', () => {
  let registry: SchemaRegistry;
  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
  });

  it('a bare registerObject(schema) call — no packageId — produces a provenance-free item', () => {
    const obj: ServiceObject = { name: 'bare_fixture', fields: { name: { type: 'text' } } } as ServiceObject;

    registry.registerObject(obj);

    const resolved = registry.getObject('bare_fixture');
    expect(resolved).toBeDefined();

    // hasOwnProperty, not `=== undefined` — see file header.
    expect(Object.prototype.hasOwnProperty.call(resolved, '_packageId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(resolved, '_provenance')).toBe(false);
  });

  it('positive control: registerObject(schema, packageId) DOES stamp provenance', () => {
    const obj: ServiceObject = { name: 'packaged_fixture', fields: { name: { type: 'text' } } } as ServiceObject;

    registry.registerObject(obj, 'com.example.pkg');

    const resolved = registry.getObject('packaged_fixture');
    expect(resolved).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(resolved, '_packageId')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(resolved, '_provenance')).toBe(true);
    expect((resolved as any)._packageId).toBe('com.example.pkg');
    expect((resolved as any)._provenance).toBe('package');
  });
});
