// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#31697, epic B-shape item 1 (#31527 comment 6766935846)] `action` is a
// package-slotted store type. Its object-less name is one per namespace
// (objectql's `NAMESPACE_SCOPED_BARE_NAME_TYPES`), so two packages of two
// namespaces may each hold one; the metadata service's in-memory store keeps
// each package's item in its own `(package, name)` slot instead of letting the
// package registered last overwrite the other before any reader resolves the
// name. The rules are `package-slotted-store.ts`'s, written once for `api`
// (#32069); this file pins that `action` is under them.

import { describe, it, expect } from 'vitest';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { MetadataManager } from './metadata-manager.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from './package-slotted-store.js';

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';

/** A package's object-less action item, as the artifact door registers it (the registry's `_packageId` stamp). */
const shipped = (packageId: string, label: string) => ({
  name: 'digest', label, type: 'script', target: `${label}_impl`, _packageId: packageId,
});

function twoHolders(): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  manager.registerInMemory('action', 'digest', shipped(ALPHA, 'alpha'));
  manager.registerInMemory('action', 'digest', shipped(BETA, 'beta'));
  return manager;
}

describe('[#31697] the in-memory action store keeps one slot per (package, name) (ADR-0150 D3/D4)', () => {
  it('`action` is a slotted store type beside `api`', () => {
    expect([...PACKAGE_SLOTTED_STORE_TYPES].sort()).toEqual(expect.arrayContaining(['action', 'api']));
  });

  it('two packages\' same-named object-less action items both stay in the store (BASE: the package registered last overwrote the other)', async () => {
    const manager = twoHolders();
    expect(((await manager.list('action')) as any[]).map((item) => item.label)).toEqual(['alpha', 'beta']);
    expect(await manager.listNames('action')).toEqual(['digest']);
    expect(await manager.exists('action', 'digest')).toBe(true);
  });

  it('a read naming a package gets that package\'s item, both faces alike; a package holding no slot gets nothing', async () => {
    const manager = twoHolders();
    expect(((await manager.get('action', 'digest', ALPHA)) as any)?.label).toBe('alpha');
    expect(((await manager.get('action', 'digest', BETA)) as any)?.label).toBe('beta');
    expect(((await manager.getDiagnosed('action', 'digest', ALPHA)).data as any)?.label).toBe('alpha');
    expect(((await manager.get('actions', 'digest', BETA)) as any)?.label, 'the plural spelling reads the same slot').toBe('beta');
    expect(await manager.get('action', 'digest', 'com.acme.gamma'), 'never another package\'s item').toBeUndefined();
  });

  it('a bare read of the two-holder name is the D3 refusal (409) naming both, never one of them picked', async () => {
    const manager = twoHolders();
    for (const read of [() => manager.get('action', 'digest'), () => manager.getDiagnosed('action', 'digest')]) {
      const err = await read().then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
      expect(err, 'the read refuses').toBeInstanceOf(PackageScopedNameRefusedError);
      expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
      expect(err!.refusal.candidates).toEqual([
        { kind: 'package', packageId: ALPHA },
        { kind: 'package', packageId: BETA },
      ]);
    }
  });

  it('CONTROL — one package\'s action is answered to every read, the very object registered', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    const item = shipped(ALPHA, 'alpha');
    manager.registerInMemory('action', 'digest', item);
    expect(await manager.get('action', 'digest')).toBe(item);
    expect(await manager.get('action', 'digest', ALPHA)).toBe(item);
    expect(await manager.list('action')).toEqual([item]);
  });

  it('CONTROL — a type outside the slotted set is unchanged: the later write replaces the earlier', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('flow', 'digest', { name: 'digest', _packageId: ALPHA });
    const later = { name: 'digest', _packageId: BETA };
    manager.registerInMemory('flow', 'digest', later);
    expect(await manager.get('flow', 'digest')).toBe(later);
    expect(await manager.get('flow', 'digest', ALPHA)).toBe(later);
    expect(await manager.list('flow')).toEqual([later]);
  });
});
