// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34206, ADR-0156 D2] `SchemaRegistry#revision`: every public write moves it,
 * a read does not. The classification itself is exhaustive by type (a public
 * method without a row in `SCHEMA_REGISTRY_METHOD_KINDS` fails the type check);
 * these pins hold the runtime half: every row names a real method, the writes
 * are wrapped, and the reads a cached answer is built from leave it alone.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { SCHEMA_REGISTRY_METHOD_KINDS, installSchemaRegistryRevision, schemaRegistryRevisionOf } from './registry-revision.js';

function makeRegistry(): SchemaRegistry {
  const registry = new SchemaRegistry({ multiTenant: false });
  (registry as any).logLevel = 'silent';
  return registry;
}

const OBJECT = { name: 'rv_account', label: 'Account', fields: { name: { name: 'name', type: 'text' } } } as any;
const PKG = { id: 'com.rv.app', name: 'com.rv.app', version: '1.0.0', type: 'app', namespace: 'rv' } as any;

describe('[#34206] SchemaRegistry#revision', () => {
  it('every classified name is a method of the class, and every write is wrapped', () => {
    const proto = SchemaRegistry.prototype as unknown as Record<PropertyKey, unknown>;
    const keys = Reflect.ownKeys(SCHEMA_REGISTRY_METHOD_KINDS);
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      expect(typeof proto[key], String(key)).toBe('function');
      const kind = (SCHEMA_REGISTRY_METHOD_KINDS as Record<PropertyKey, string>)[key];
      expect(['read', 'write']).toContain(kind);
      expect((proto[key] as Function).name === 'countedWrite', String(key)).toBe(kind === 'write');
    }
  });

  it('starts at 0, and each write moves it', () => {
    const registry = makeRegistry();
    expect(registry.revision).toBe(0);
    const steps: Array<[string, () => unknown]> = [
      ['installPackage', () => registry.installPackage(PKG, 'code')],
      ['registerObject', () => registry.registerObject(OBJECT, PKG.id, 'rv', 'own')],
      ['registerItem', () => registry.registerItem('view', { name: 'rv_all', object: 'rv_account', type: 'grid' } as any, 'name', PKG.id)],
      ['registerApp', () => registry.registerApp({ name: 'rv_app', label: 'App' } as any, PKG.id)],
      ['disablePackage', () => registry.disablePackage(PKG.id)],
      ['enablePackage', () => registry.enablePackage(PKG.id)],
      ['unregisterItem', () => registry.unregisterItem('view', 'rv_all')],
      ['invalidateAll', () => registry.invalidateAll()],
      ['unregisterObject', () => registry.unregisterObject('rv_account', { force: true })],
    ];
    for (const [label, step] of steps) {
      const before = registry.revision;
      step();
      expect(registry.revision, label).toBeGreaterThan(before);
    }
  });

  it('a write that does not register an object still moves it, where `objectRevision` stays', () => {
    const registry = makeRegistry();
    registry.registerObject(OBJECT, '__test__');
    const objectRevision = registry.objectRevision;
    const before = registry.revision;
    registry.registerItem('view', { name: 'rv_all', object: 'rv_account', type: 'grid' } as any, 'name', '__test__');
    expect(registry.getItem('view', 'rv_all')).toBeDefined();
    expect(registry.objectRevision).toBe(objectRevision);
    expect(registry.revision).toBeGreaterThan(before);
  });

  it('a write that throws still moves it', () => {
    const registry = makeRegistry();
    const before = registry.revision;
    expect(() => registry.restoringOnRefusal(() => { throw new Error('refused for the test'); })).toThrow('refused for the test');
    expect(registry.revision).toBeGreaterThan(before);
  });

  it('control: the reads a served answer is built from leave it alone', () => {
    const registry = makeRegistry();
    registry.installPackage(PKG, 'code');
    registry.registerObject(OBJECT, PKG.id, 'rv', 'own');
    registry.registerItem('view', { name: 'rv_all', object: 'rv_account', type: 'grid' } as any, 'name', PKG.id);
    registry.registerApp({ name: 'rv_app', label: 'App' } as any, PKG.id);
    const before = registry.revision;
    // Non-vacuity: each read finds what it reads.
    expect(registry.getObject('rv_account')).toBeDefined();
    expect(registry.getAllObjects().some((o) => o.name === 'rv_account')).toBe(true);
    expect(registry.getItem('view', 'rv_all')).toBeDefined();
    expect(registry.listItems('view').length).toBe(1);
    expect(registry.getApp('rv_app')).toBeDefined();
    expect(registry.getAllApps().length).toBe(1);
    expect(registry.getPackage(PKG.id)).toBeDefined();
    expect(registry.isPackageDisabled(PKG.id)).toBe(false);
    registry.resolveItem('view', 'rv_all');
    registry.getObjectOwner('rv_account');
    expect(registry.revision).toBe(before);
  });

  it('each registry counts its own writes', () => {
    const a = makeRegistry();
    const b = makeRegistry();
    a.registerObject(OBJECT, '__test__');
    expect(a.revision).toBeGreaterThan(0);
    expect(b.revision).toBe(0);
    expect(schemaRegistryRevisionOf(a)).toBe(a.revision);
  });

  it('installing twice does not wrap twice', () => {
    const first = makeRegistry();
    const r0 = first.revision;
    first.invalidateAll();
    const perCall = first.revision - r0;
    installSchemaRegistryRevision(SchemaRegistry);
    const second = makeRegistry();
    second.invalidateAll();
    expect(second.revision).toBe(perCall);
  });
});
