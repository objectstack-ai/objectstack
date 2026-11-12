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

  describe('[contract review G1] an action is slotted by its identity, (package, object, name): two objects\' actions of one name never meet', () => {
    const bound = (packageId: string, label: string, objectName: string) => ({ ...shipped(packageId, label), objectName });

    it('[#32244] two packages\' same-named actions bound to two different objects are both kept, each read by its package; the bare read is the D3 refusal naming each package with its object (BASE: the one written last answered)', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha', 'alpha_item'));
      manager.registerInMemory('action', 'digest', bound(BETA, 'beta', 'beta_item'));
      expect(((await manager.list('action')) as any[]).map((item) => item.label)).toEqual(['alpha', 'beta']);
      expect(await manager.listNames('action')).toEqual(['digest']);
      expect(((await manager.get('action', 'digest', ALPHA)) as any)?.label).toBe('alpha');
      expect(((await manager.get('action', 'digest', BETA)) as any)?.label).toBe('beta');
      for (const read of [() => manager.get('action', 'digest'), () => manager.getDiagnosed('action', 'digest')]) {
        const err = await read().then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
        expect(err, 'the bare read refuses, never the one written last').toBeInstanceOf(PackageScopedNameRefusedError);
        expect([err!.code, err!.status, err!.refusal.reason, err!.refusal.callerPackageId])
          .toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment', null]);
        expect(err!.refusal.candidates).toEqual([
          { kind: 'package', packageId: ALPHA },
          { kind: 'package', packageId: BETA },
        ]);
        // Each package is named with the object it binds the name to.
        expect(err!.message).toContain(`package "${ALPHA}" binds it to object "alpha_item"`);
        expect(err!.message).toContain(`package "${BETA}" binds it to object "beta_item"`);
      }
    });

    it('[#32244] one package\'s action bound to an object beside another package\'s object-less one: the bare read is refused, naming the object-less one as such', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha', 'alpha_item'));
      manager.registerInMemory('action', 'digest', shipped(BETA, 'beta'));
      const err = await manager.get('action', 'digest').then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
      expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
      expect(err!.refusal.candidates.map((c: any) => c.packageId)).toEqual([ALPHA, BETA]);
      expect(err!.message).toContain(`package "${BETA}" binds it to no object`);
      expect(((await manager.get('action', 'digest', BETA)) as any)?.label, '?package= is unchanged').toBe('beta');
    });

    it('two packages\' same-named actions bound to ONE object are the two-holder case: the bare read is refused naming both', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha', 'shared_item'));
      manager.registerInMemory('action', 'digest', bound(BETA, 'beta', 'shared_item'));
      const err = await manager.get('action', 'digest').then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
      expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
      expect(err!.refusal.candidates).toEqual([
        { kind: 'package', packageId: ALPHA },
        { kind: 'package', packageId: BETA },
      ]);
      expect(((await manager.get('action', 'digest', BETA)) as any)?.label).toBe('beta');
    });

    it('one package binding one name to two objects keeps both (BASE: the later overwrote the earlier)', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      manager.registerInMemory('action', 'digest', bound(ALPHA, 'on one', 'one_item'));
      manager.registerInMemory('action', 'digest', bound(ALPHA, 'on two', 'two_item'));
      expect(((await manager.list('action')) as any[]).map((item) => item.label)).toEqual(['on one', 'on two']);
      expect(((await manager.get('action', 'digest', ALPHA)) as any)?.label).toBe('on two');
      // [#32244] CONTROL: one holder, so the bare read is not refused; it answers the one written last, as before.
      expect(((await manager.get('action', 'digest')) as any)?.label).toBe('on two');
      expect(((await manager.getDiagnosed('action', 'digest')).data as any)?.label).toBe('on two');
      manager.registerInMemory('action', 'digest', bound(ALPHA, 'on one again', 'one_item'));
      expect(((await manager.get('action', 'digest')) as any)?.label).toBe('on one again');
      await manager.unregister('action', 'digest');
      expect(await manager.exists('action', 'digest')).toBe(false);
    });

    it('a bound action beside a two-holder object-less name of the same name: the bare read is refused, since that identity is ambiguous', async () => {
      const manager = twoHolders();
      manager.registerInMemory('action', 'digest', bound('com.acme.gamma', 'gamma', 'gamma_item'));
      const err = await manager.get('action', 'digest').then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
      expect(((await manager.get('action', 'digest', 'com.acme.gamma')) as any)?.label).toBe('gamma');
    });
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
    // A connector: `flow` (#31696) and `webhook` (#31699 PR 2) joined the slotted set.
    manager.registerInMemory('connector', 'digest', { name: 'digest', _packageId: ALPHA });
    const later = { name: 'digest', _packageId: BETA };
    manager.registerInMemory('connector', 'digest', later);
    expect(await manager.get('connector', 'digest')).toBe(later);
    expect(await manager.get('connector', 'digest', ALPHA)).toBe(later);
    expect(await manager.list('connector')).toEqual([later]);
  });
});

/**
 * [#32365, ADR-0150 D3] The bare read of an action name with a package-less
 * item beside package holders: the environment's own item answers first
 * beside ONE package, whatever object each binds the name to; beside two it
 * is named in the refusal, which names every candidate.
 *
 * BASE (main 89d815c5): beside one package, the slot written last answered
 * (the package's action when it was written after the environment's); beside
 * two, the refusal named the two packages only.
 */
describe('[#32365] the bare action read weighs the environment\'s own item', () => {
  const at = (packageId: string | undefined, label: string, objectName?: string) => ({
    name: 'digest', label, type: 'script', target: `${label}_impl`,
    ...(objectName ? { objectName } : {}), ...(packageId ? { _packageId: packageId } : {}),
  });
  const refusalOf = (manager: MetadataManager) =>
    manager.get('action', 'digest').then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);

  it('the environment\'s item on one object beside one package\'s on another answers the bare read, in either write order', async () => {
    for (const order of [['env', 'alpha'], ['alpha', 'env']]) {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      for (const which of order) {
        manager.registerInMemory('action', 'digest', which === 'env' ? at(undefined, 'env', 'contact') : at(ALPHA, 'alpha', 'account'));
      }
      expect(((await manager.get('action', 'digest')) as any)?.label, `written ${order.join(' then ')}`).toBe('env');
      expect(((await manager.get('action', 'digest', ALPHA)) as any)?.label, 'a read naming A answers A\'s own slot first').toBe('alpha');
    }
  });

  it('beside two packages on two objects, the refusal names both packages AND the environment', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', at(ALPHA, 'alpha', 'account'));
    manager.registerInMemory('action', 'digest', at(BETA, 'beta', 'contact'));
    manager.registerInMemory('action', 'digest', at(undefined, 'env', 'lead'));
    const err = await refusalOf(manager);
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(err!.refusal.candidates).toEqual([
      { kind: 'package', packageId: ALPHA }, { kind: 'package', packageId: BETA }, { kind: 'environment' },
    ]);
    expect(err!.message).toContain('The environment\'s own item binds it to object "lead"');
  });

  it('beside two packages on the one same key (object-less), the refusal names the environment too', async () => {
    const manager = twoHolders();
    manager.registerInMemory('action', 'digest', at(undefined, 'env'));
    const err = await refusalOf(manager);
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(err!.refusal.candidates).toEqual([
      { kind: 'package', packageId: ALPHA }, { kind: 'package', packageId: BETA }, { kind: 'environment' },
    ]);
    expect(((await manager.get('action', 'digest', BETA)) as any)?.label).toBe('beta');
  });

  it('[contract review F1] beside two packages on ONE object, with the environment\'s item on another object: the refusal names the environment too', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', at(ALPHA, 'alpha', 'account'));
    manager.registerInMemory('action', 'digest', at(BETA, 'beta', 'account'));
    manager.registerInMemory('action', 'digest', at(undefined, 'env', 'lead'));
    const err = await refusalOf(manager);
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(err!.refusal.candidates).toEqual([
      { kind: 'package', packageId: ALPHA }, { kind: 'package', packageId: BETA }, { kind: 'environment' },
    ]);
    expect(err!.message).toContain('The environment\'s own item binds it to object "lead"');
  });

  it('CONTROL — a package-less item on the one package\'s own key is that package\'s customization (D4): the bare read answers it, as before', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', at(ALPHA, 'alpha', 'account'));
    manager.registerInMemory('action', 'digest', at(undefined, 'custom', 'account'));
    expect(((await manager.get('action', 'digest')) as any)?.label).toBe('custom');
  });
});

/**
 * [#32352, ADR-0150 D3/D4] A removal of an action counts its holders by
 * PACKAGE over every slot of the name — the object-less one and each
 * object-bound one — as the by-name read (#32244) and `DatabaseLoader`'s row
 * key `(package, name)` count them.
 *
 * BASE (main 89d815c5): a removal naming a package took only its object-less
 * slot, so its bound action stayed in the registry and kept answering `get`
 * and `list`; a removal naming none counted only the object-less slot's
 * holders, so a name two packages bind (one object or two) was not refused and
 * every package's slot was taken.
 */
describe('[#32352] removing an action counts its holders by package over every slot of the name (ADR-0150 D3/D4)', () => {
  const bound = (packageId: string, label: string, objectName: string) => ({ ...shipped(packageId, label), objectName });
  const labels = async (manager: MetadataManager) => ((await manager.list('action')) as any[]).map((item) => item.label);
  const refusalOf = (manager: MetadataManager) =>
    manager.unregister('action', 'digest').then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);

  it('a removal naming a package takes its object-bound slot too, and keeps the other package\'s (BASE: the bound slot stayed and was served)', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha', 'alpha_item'));
    manager.registerInMemory('action', 'digest', bound(BETA, 'beta', 'beta_item'));
    await manager.unregister('action', 'digest', { packageId: ALPHA });
    expect(await manager.get('action', 'digest', ALPHA), 'the removed package\'s action is gone').toBeUndefined();
    expect(await labels(manager)).toEqual(['beta']);
    expect(((await manager.get('action', 'digest')) as any)?.label, 'one holder left: the bare read serves it').toBe('beta');
  });

  it('a removal naming a package takes every slot it holds of the name — object-less and each object — in one call', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha on one', 'one_item'));
    manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha on two', 'two_item'));
    manager.registerInMemory('action', 'digest', shipped(ALPHA, 'alpha'));
    manager.registerInMemory('action', 'digest', shipped(BETA, 'beta'));
    await manager.unregister('action', 'digest', { packageId: ALPHA });
    expect(await labels(manager)).toEqual(['beta']);
  });

  it.each([
    ['on ONE object', 'shared_item', 'shared_item'],
    ['on two different objects', 'alpha_item', 'beta_item'],
  ])('a removal naming none of a name two packages bind %s is the D3 refusal (409) naming each package with its object; nothing is removed (BASE: both were taken)', async (_shape, alphaObject, betaObject) => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha', alphaObject));
    manager.registerInMemory('action', 'digest', bound(BETA, 'beta', betaObject));
    const err = await refusalOf(manager);
    expect(err, 'the removal refuses').toBeInstanceOf(PackageScopedNameRefusedError);
    expect([err!.code, err!.status, err!.refusal.reason, err!.refusal.callerPackageId])
      .toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment', null]);
    expect(err!.refusal.candidates).toEqual([
      { kind: 'package', packageId: ALPHA },
      { kind: 'package', packageId: BETA },
    ]);
    // The sentence's first owner is capitalized when it opens it (one object).
    expect(err!.message.toLowerCase()).toContain(`package "${ALPHA}" binds it to object "${alphaObject}"`);
    expect(err!.message.toLowerCase()).toContain(`package "${BETA}" binds it to object "${betaObject}"`);
    expect(await labels(manager)).toEqual(['alpha', 'beta']);
  });

  it('a removal naming none of a name one package binds and another holds object-less is refused, naming the object-less one as such', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', bound(ALPHA, 'alpha', 'alpha_item'));
    manager.registerInMemory('action', 'digest', shipped(BETA, 'beta'));
    const err = await refusalOf(manager);
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(err!.refusal.candidates.map((candidate: any) => candidate.packageId)).toEqual([ALPHA, BETA]);
    expect(err!.message).toContain(`package "${BETA}" binds it to no object`);
    expect(await labels(manager)).toEqual(['alpha', 'beta']);
  });

  it('CONTROL — two packages\' object-less name: the refusal and its message are unchanged (no object sentence)', async () => {
    const err = await refusalOf(twoHolders());
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(err!.refusal.candidates.map((candidate: any) => candidate.packageId)).toEqual([ALPHA, BETA]);
    expect(err!.message).not.toContain('binds it to');
  });

  it('CONTROL — one package binding the name to two objects is one holder: a removal naming none takes both', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('action', 'digest', bound(ALPHA, 'on one', 'one_item'));
    manager.registerInMemory('action', 'digest', bound(ALPHA, 'on two', 'two_item'));
    await manager.unregister('action', 'digest');
    expect(await labels(manager)).toEqual([]);
  });
});
