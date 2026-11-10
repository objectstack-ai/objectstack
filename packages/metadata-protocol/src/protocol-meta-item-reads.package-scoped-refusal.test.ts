// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32244, ADR-0150 D3] The by-name reads' catches around the MetadataService
 * read ask ONE recogniser whether what they caught is a package-scoped
 * refusal, and rethrow it; anything else falls through as before.
 */

import { describe, it, expect } from 'vitest';
// Paid at collection, not inside a case's clock (check:test-source-alias): the
// module under test reaches it dynamically.
import '@objectstack/lint';
import { PackageScopedNameRefusedError, packageScopedRefusalMessage, type PackageScopedRefusal } from '@objectstack/core';
import { packageScopedRefusalOf, rethrowPackageScopedRefusal } from './protocol-meta-item-reads.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';

const refusalNaming = (...packageIds: string[]): PackageScopedRefusal => {
    const base = {
        status: 'refused' as const, reason: 'ambiguous-in-environment' as const, type: 'action' as const,
        name: 'approve', callerPackageId: null, candidates: packageIds.map((packageId) => ({ kind: 'package' as const, packageId })),
    };
    return { ...base, message: packageScopedRefusalMessage(base) };
};
const hostWith = (disabled: string[] = []) => ({
    engine: { registry: { packageScopedHoldersOf: () => [], getPackageScopedItem: () => undefined, isPackageDisabled: (id: string) => disabled.includes(id) } },
}) as never;

describe('packageScopedRefusalOf — the one recogniser', () => {
    it('recognises the class, and the shape a copied class carries', () => {
        const refusal = refusalNaming(A, B);
        expect(packageScopedRefusalOf(new PackageScopedNameRefusedError(refusal))).toBe(refusal);
        const copied = Object.assign(new Error(refusal.message), { code: 'RESOURCE_CONFLICT', status: 409, refusal });
        expect(packageScopedRefusalOf(copied)).toBe(refusal);
    });

    it('anything else is no refusal: an outage, a conflict with no refusal, a refusal-less shape', () => {
        expect(packageScopedRefusalOf(new Error('ECONNREFUSED'))).toBeUndefined();
        expect(packageScopedRefusalOf(Object.assign(new Error('x'), { code: 'RESOURCE_CONFLICT' }))).toBeUndefined();
        expect(packageScopedRefusalOf(Object.assign(new Error('x'), { code: 'RESOURCE_CONFLICT', refusal: { status: 'resolved' } }))).toBeUndefined();
        expect(packageScopedRefusalOf(undefined)).toBeUndefined();
    });
});

describe('rethrowPackageScopedRefusal — the catch\'s answer', () => {
    it('rethrows a refusal, and lets anything else fall through', () => {
        const refused = new PackageScopedNameRefusedError(refusalNaming(A, B));
        expect(() => rethrowPackageScopedRefusal(hostWith(), 'action', refused)).toThrow(refused);
        expect(() => rethrowPackageScopedRefusal(hostWith(), 'agent', refused)).toThrow(refused);
        expect(() => rethrowPackageScopedRefusal(hostWith(), 'action', new Error('MetadataService not available'))).not.toThrow();
    });

    it('an action refusal naming fewer than two enabled packages falls through: a disabled package holds nothing', () => {
        const refused = new PackageScopedNameRefusedError(refusalNaming(A, B));
        expect(() => rethrowPackageScopedRefusal(hostWith([B]), 'action', refused)).not.toThrow();
        // Not for another type: its readers count every holder.
        expect(() => rethrowPackageScopedRefusal(hostWith([B]), 'api', refused)).toThrow(refused);
    });
});
