// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31699, ADR-0150 child B; #31527 B-shape item 1] `email_template` is stored
 * per `(package, name)` in `MetadataManager`'s in-memory store, in the same
 * change that lets two packages of two namespaces each hold one template name
 * (`NAMESPACE_SCOPED_BARE_NAME_TYPES`). Keyed by bare name, the second
 * package's `registerInMemory('email_template', NAME, …)` overwrote the
 * first's, and `get` answered the survivor whatever package the read named.
 * The items are stamped the way the boot registrar stamps them (`_packageId`).
 */

import { describe, it, expect, vi } from 'vitest';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { MetadataManager } from './metadata-manager.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from './package-slotted-store.js';

vi.mock('@objectstack/core', async (orig) => ({
  ...((await orig()) as object),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const ALPHA = 'com.alpha.app';
const BETA = 'com.beta.app';
const NAME = 'welcome';

const shipped = (packageId: string, subject: string) => ({
  name: NAME,
  locale: 'en-US',
  subject,
  bodyHtml: `<p>${subject}</p>`,
  _packageId: packageId,
  _provenance: 'package',
});

function twoHolders(): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  manager.registerInMemory('email_template', NAME, shipped(ALPHA, 'alpha'));
  manager.registerInMemory('email_template', NAME, shipped(BETA, 'beta'));
  return manager;
}

describe('[#31699] the in-memory email_template store keeps one slot per (package, name) (ADR-0150 D4)', () => {
  it('the type is in the slotted set beside api', () => {
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('email_template')).toBe(true);
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('api')).toBe(true);
  });

  it('two packages\' same-named templates both stay in the store (BASE: the later write overwrote the earlier)', async () => {
    const manager = twoHolders();
    expect(((await manager.list('email_template')) as any[]).map((i) => i.subject)).toEqual(['alpha', 'beta']);
    expect(await manager.listNames('email_template')).toEqual([NAME]);
  });

  it('a read naming a package answers that package\'s template, both faces alike; a package holding none answers nothing', async () => {
    const manager = twoHolders();
    expect(((await manager.get('email_template', NAME, ALPHA)) as any)?.subject).toBe('alpha');
    expect(((await manager.get('email_template', NAME, BETA)) as any)?.subject).toBe('beta');
    expect(((await manager.getDiagnosed('email_template', NAME, BETA)).data as any)?.subject).toBe('beta');
    expect(await manager.get('email_template', NAME, 'com.gamma.app'), 'never another package\'s template').toBeUndefined();
  });

  it('a read naming no package of the two-holder name is the D3 refusal naming both, never one of them picked', async () => {
    const manager = twoHolders();
    for (const read of [() => manager.get('email_template', NAME), () => manager.getDiagnosed('email_template', NAME)]) {
      const err = await read().then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
      expect(err, 'the read refuses').toBeInstanceOf(PackageScopedNameRefusedError);
      expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
      expect(err!.refusal.candidates).toEqual([
        { kind: 'package', packageId: ALPHA },
        { kind: 'package', packageId: BETA },
      ]);
    }
  });

  it('CONTROL — one holder: every read answers the one template registered, as the bare-name map did', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    const item = shipped(ALPHA, 'alpha');
    manager.registerInMemory('email_template', NAME, item);
    expect(await manager.get('email_template', NAME)).toBe(item);
    expect(await manager.get('email_template', NAME, ALPHA)).toBe(item);
    expect(await manager.list('email_template')).toEqual([item]);
  });

  it('CONTROL — a type outside the slotted set keeps one item per name: the later package\'s write replaces the earlier', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('view', NAME, { name: NAME, _packageId: ALPHA });
    const later = { name: NAME, _packageId: BETA };
    manager.registerInMemory('view', NAME, later);
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('view')).toBe(false);
    expect(await manager.get('view', NAME)).toBe(later);
    expect(await manager.list('view')).toEqual([later]);
  });
});
