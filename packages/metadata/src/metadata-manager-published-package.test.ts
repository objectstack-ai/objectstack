// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32183, contract review M4] `MetadataManager.getPublished` takes the
// package a read addresses, read as `get` reads it: a type stored per
// `(package, name)` answers that package's copy. Both `/published` doors pass
// it for a name a disabled package also holds, so the store's own two-holder
// refusal never names a package the registry does not serve. Without one the
// read is unchanged.

import { describe, it, expect } from 'vitest';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { MetadataManager } from './metadata-manager.js';

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';

/** A package's agent and dashboard, as the artifact door registers them (the `_packageId` stamp). */
const agent = (packageId: string, label: string) => ({ name: 'helper', label, role: 'assistant', instructions: label, _packageId: packageId });
const dashboard = (packageId: string, label: string) => ({ name: 'board', label, widgets: [], _packageId: packageId });

function twoHolders(): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  for (const [id, label] of [[ALPHA, 'alpha'], [BETA, 'beta']] as const) {
    manager.registerInMemory('agent', 'helper', agent(id, label));
    manager.registerInMemory('dashboard', 'board', dashboard(id, label));
  }
  return manager;
}

describe('[#32183] getPublished reads at the package it is given', () => {
  it('a type stored per (package, name): the package\'s own copy; a package holding no slot gets nothing', async () => {
    const manager = twoHolders();
    expect(((await manager.getPublished('agent', 'helper', ALPHA)) as any)?.label).toBe('alpha');
    expect(((await manager.getPublished('agent', 'helper', BETA)) as any)?.label).toBe('beta');
    expect(await manager.getPublished('agent', 'helper', 'com.acme.gamma')).toBeUndefined();
  });

  it('CONTROL: naming no package, the two-holder name is still refused 409 naming both', async () => {
    const manager = twoHolders();
    const err = await manager.getPublished('agent', 'helper').then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect(err!.refusal.candidates.map((candidate: any) => candidate.packageId)).toEqual([ALPHA, BETA]);
  });

  it('a type stored by name alone keeps the body registered last, with or without a package', async () => {
    const manager = twoHolders();
    for (const packageId of [undefined, ALPHA, BETA]) {
      expect(((await manager.getPublished('dashboard', 'board', packageId)) as any)?._packageId, String(packageId)).toBe(BETA);
    }
  });
});
