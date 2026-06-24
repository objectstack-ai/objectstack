// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — ADR-0070 package-first authoring, exercised end-to-end
// through the real booted stack (not a mocked unit). The kernel must REJECT a
// runtime-only create that targets a read-only code/installed package with
// `writable_package_required` (D1/D2) instead of silently coercing it to a
// package-less orphan (the pre-ADR #2252 behavior). This is the contract the
// Studio + AI surfaces rely on as the backstop.
//
// Reverting D1 (the writable_package_required throw in saveMetaItem) turns this
// red — that is the point of the gate.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('dogfood: package-first authoring rejects runtime creates into read-only packages (ADR-0070 D1/D2)', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    stack = await bootStack(crmStack);
  });
  afterAll(async () => {
    await stack?.stop?.();
  });

  it('saveMetaItem(runtime-only) into a loaded code package throws writable_package_required', async () => {
    // The objectql engine records every booted code package in its manifest map;
    // any one of them is a read-only authoring target (isWritablePackage=false).
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const manifests = (ql?.manifests ?? ql?.engine?.manifests) as Map<string, unknown> | undefined;
    const codePkgId = manifests && typeof manifests.keys === 'function' ? [...manifests.keys()][0] : undefined;
    expect(codePkgId, 'expected at least one loaded code package in the booted stack').toBeTruthy();

    const protocol = await stack.kernel.getServiceAsync<any>('protocol');
    await expect(
      protocol.saveMetaItem({
        type: 'object',
        name: 'dogfood_pkgfirst_probe',
        item: { name: 'dogfood_pkgfirst_probe', label: 'Probe', fields: { name: { type: 'text', label: 'Name' } } },
        packageId: codePkgId,
        mode: 'draft',
      }),
    ).rejects.toMatchObject({ code: 'writable_package_required' });
  });

  it('the same create into a fresh writable base id is NOT rejected (control)', async () => {
    const protocol = await stack.kernel.getServiceAsync<any>('protocol');
    // A bare, unregistered project-base id is writable — the write must succeed.
    const res = await protocol.saveMetaItem({
      type: 'object',
      name: 'dogfood_pkgfirst_ok',
      item: { name: 'dogfood_pkgfirst_ok', label: 'OK', fields: { name: { type: 'text', label: 'Name' } } },
      packageId: 'app.dogfood_probe_base',
      mode: 'draft',
    });
    expect(res?.success ?? true).toBeTruthy();
  });
});
