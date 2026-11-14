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
import { packageScopedRefusalOf, refuseActionHeldByPackages, rethrowPackageScopedRefusal } from './protocol-meta-item-reads.js';

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

describe('[review 6781770671 S5] refuseActionHeldByPackages — the object-less judge\'s refusal merged in', () => {
    const C = 'com.acme.gamma';
    const hostHolding = (objects: Record<string, string | undefined>) => ({
        engine: { registry: {
            packageScopedHoldersOf: () => Object.keys(objects),
            getPackageScopedItem: (_t: string, name: string, id: string) => ({ name, ...(objects[id] ? { objectName: objects[id] } : {}) }),
        } },
    }) as never;
    const caught = (run: () => void): any => { try { run(); } catch (error) { return error; } return undefined; };

    it('two object-less packages and a third bound to an object: one refusal naming all three', () => {
        const narrower = new PackageScopedNameRefusedError(refusalNaming(A, B));
        const refused = caught(() => refuseActionHeldByPackages(hostHolding({ [A]: undefined, [B]: undefined, [C]: 'account' }), 'approve', narrower));
        expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
        expect(refused.refusal.candidates.map((c: any) => c.packageId)).toEqual([A, B, C]);
        expect(refused.message).toContain(`package "${C}" binds it to object "account"`);
    });

    it('a holder the narrower judge names that is not a package (the platform\'s) is kept', () => {
        const base = {
            status: 'refused' as const, reason: 'ambiguous-in-environment' as const, type: 'action' as const, name: 'approve',
            callerPackageId: null, candidates: [{ kind: 'package' as const, packageId: A }, { kind: 'platform' as const }],
        };
        const narrower = new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
        const refused = caught(() => refuseActionHeldByPackages(hostHolding({ [A]: undefined, [C]: 'account' }), 'approve', narrower));
        expect(refused.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: C }, { kind: 'platform' }]);
    });

    it('CONTROL — fewer than two packages: the narrower refusal is thrown as it was; with none, nothing is thrown', () => {
        const narrower = new PackageScopedNameRefusedError(refusalNaming(A));
        expect(caught(() => refuseActionHeldByPackages(hostHolding({ [A]: undefined }), 'approve', narrower))).toBe(narrower);
        expect(caught(() => refuseActionHeldByPackages(hostHolding({ [A]: 'account' }), 'approve'))).toBeUndefined();
    });
});
