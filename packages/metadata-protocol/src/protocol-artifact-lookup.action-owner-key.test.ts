// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, #33456] The artifact an action's envelope is grafted from is
 * the one bound to the served item's own owner key: an action is keyed
 * `(package, object, name)`, so a package's artifact bound to another object
 * is another item and lends none. Naming no package, the holder is the ONE
 * package whose own artifact is bound there.
 *
 * BEFORE (the owner-key rule removed): every case marked FROM below answered
 * the first composite by name, ALPHA's `account` artifact, whatever object
 * the served item was bound to.
 *
 * The registry double keeps the two reads the lookup makes the way
 * objectql's `SchemaRegistry` answers them: `getArtifactItem` prefers the
 * named package's composite, else the first composite; `packageScopedHoldersOf`
 * lists every package holding a composite of the name.
 */

import { describe, expect, it } from 'vitest';
import { lookupArtifactItem } from './protocol-artifact-lookup.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';

const action = (packageId: string, objectName: string | undefined) => ({
    name: 'approve', type: 'script', ...(objectName ? { objectName } : {}),
    _packageId: packageId, _provenance: 'package',
});

/** The engine a lookup reads, its registry holding `items` as `<packageId>:approve` composites. */
const engineOf = (items: ReadonlyArray<ReturnType<typeof action>>) => {
    const composites = new Map(items.map((item) => [`${item._packageId}:approve`, item] as const));
    return {
        registry: {
            getArtifactItem(_type: string, name: string, packageId?: string) {
                if (name !== 'approve') return undefined;
                return (packageId ? composites.get(`${packageId}:approve`) : undefined) ?? composites.values().next().value;
            },
            packageScopedHoldersOf(_type: string, name: string) {
                return name === 'approve' ? [...composites.values()].map((item) => item._packageId) : [];
            },
        },
    };
};

const lookup = (
    items: ReadonlyArray<ReturnType<typeof action>>,
    args: { type?: string; packageId?: string; owner?: { object: string | undefined } },
) => lookupArtifactItem.call({ engine: engineOf(items) as never }, args.type ?? 'action', 'approve', args.packageId, undefined, args.owner) as
    ReturnType<typeof action> | undefined;

const holderOf = (artifact: ReturnType<typeof action> | undefined) =>
    artifact === undefined ? undefined : `${artifact._packageId}@${artifact.objectName ?? 'object-less'}`;

describe('[#33456] an action artifact lends its envelope only at the served item\'s own owner key (ADR-0150 D4)', () => {
    it('mirror shape: beside ALPHA on `account`, a package-less item on `contact` wears no artifact (FROM ALPHA\'s)', () => {
        expect(holderOf(lookup([action(A, 'account')], { owner: { object: 'contact' } }))).toBeUndefined();
    });

    it('single-holder cell: beside BETA on `contact`, a package-less item on `account` wears no artifact (FROM BETA\'s)', () => {
        expect(holderOf(lookup([action(B, 'contact')], { owner: { object: 'account' } }))).toBeUndefined();
    });

    it('ALPHA on `account`, BETA on `contact`: a package-less item on `contact` wears BETA\'s, the one holder there (FROM ALPHA\'s, the first composite)', () => {
        expect(holderOf(lookup([action(A, 'account'), action(B, 'contact')], { owner: { object: 'contact' } }))).toBe(`${B}@contact`);
    });

    it('object-less is its own owner key: ALPHA object-less lends nothing to an item on `contact`, nor ALPHA on `account` to an object-less item (FROM ALPHA\'s)', () => {
        expect(holderOf(lookup([action(A, undefined)], { owner: { object: 'contact' } }))).toBeUndefined();
        expect(holderOf(lookup([action(A, 'account')], { owner: { object: undefined } }))).toBeUndefined();
    });

    it('naming a package: that package\'s artifact only when it is bound to the owner key (FROM its artifact on another object)', () => {
        expect(holderOf(lookup([action(A, 'account')], { packageId: A, owner: { object: 'contact' } }))).toBeUndefined();
    });

    describe('CONTROLs (unchanged)', () => {
        it('one package on one object, the item on that object (its customization): that package\'s artifact', () => {
            expect(holderOf(lookup([action(A, 'account')], { owner: { object: 'account' } }))).toBe(`${A}@account`);
            expect(holderOf(lookup([action(A, 'account')], { packageId: A, owner: { object: 'account' } }))).toBe(`${A}@account`);
            expect(holderOf(lookup([action(A, undefined)], { owner: { object: undefined } }))).toBe(`${A}@object-less`);
        });

        it('two packages on one object: the first composite, as before (the bare read refuses that name before any envelope)', () => {
            expect(holderOf(lookup([action(A, 'account'), action(B, 'account')], { owner: { object: 'account' } }))).toBe(`${A}@account`);
        });

        it('no owner key, or a type other than `action`: by name, as before', () => {
            expect(holderOf(lookup([action(A, 'account')], {}))).toBe(`${A}@account`);
            expect(holderOf(lookup([action(A, 'account')], { type: 'flow', owner: { object: 'contact' } }))).toBe(`${A}@account`);
        });
    });
});
