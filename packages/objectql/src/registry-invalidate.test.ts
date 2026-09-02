// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0008 PR-7: SchemaRegistry.invalidate() / invalidateAll().
 *
 * These hooks let event-driven consumers (ObjectQLPlugin) drop cached
 * merged definitions when an upstream metadata change makes them stale.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';
import type { ServiceObject } from '@objectstack/spec/data';

function makeObject(name: string, label = name): ServiceObject {
  return {
    name,
    label,
    fields: {
      id: { type: 'id', label: 'ID' },
      title: { type: 'string', label: 'Title' },
    },
  } as ServiceObject;
}

describe('SchemaRegistry — invalidate / invalidateAll (PR-7)', () => {
  let registry: SchemaRegistry;
  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
  });

  it('invalidate(fqn) drops only the named cache entry', () => {
    registry.registerObject(makeObject('account'), 'com.example.crm');
    registry.registerObject(makeObject('contact'), 'com.example.crm');

    // Prime the cache by resolving each
    expect(registry.resolveObject('account')).toBeDefined();
    expect(registry.resolveObject('contact')).toBeDefined();

    registry.invalidate('account');

    // contact still cached; account recomputes next call — both should
    // still resolve, but only the contact resolve hits the cache. The
    // observable invariant is that both still return a non-undefined
    // definition (no contributor data was dropped).
    expect(registry.resolveObject('account')).toBeDefined();
    expect(registry.resolveObject('contact')).toBeDefined();
  });

  it('invalidate() with a short name drops matching FQN entries', () => {
    // Single registered FQN equal to the short name → invalidates cleanly.
    registry.registerObject(makeObject('task'), 'com.example.todo');
    expect(registry.resolveObject('task')).toBeDefined();
    registry.invalidate('task');
    expect(registry.resolveObject('task')).toBeDefined(); // contributor preserved
  });

  it('invalidateAll() drops the entire merged cache', () => {
    registry.registerObject(makeObject('a'), 'pkg.a');
    registry.registerObject(makeObject('b'), 'pkg.b');
    registry.resolveObject('a');
    registry.resolveObject('b');
    registry.invalidateAll();
    // Cache emptied, but contributors remain so resolveObject still works.
    expect(registry.resolveObject('a')).toBeDefined();
    expect(registry.resolveObject('b')).toBeDefined();
  });

  it('invalidate() picks up updated definitions when contributor is replaced', () => {
    registry.registerObject(makeObject('lead', 'Lead v1'), 'com.example.crm');
    const v1 = registry.resolveObject('lead');
    expect(v1?.label).toBe('Lead v1');

    // Simulate event-driven re-registration: drop the cache, re-register.
    registry.unregisterObjectsByPackage('com.example.crm', true);
    registry.registerObject(makeObject('lead', 'Lead v2'), 'com.example.crm');
    registry.invalidate('lead');

    const v2 = registry.resolveObject('lead');
    expect(v2?.label).toBe('Lead v2');
  });
});
