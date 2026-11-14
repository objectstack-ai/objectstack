// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4/D5] Which row slot the history and rollback doors address
 * (`historySlotOf`), judged against a fake host so each arm is pinned on its
 * own: the served row's slot for `?package=P` (P's own, or the package-less
 * row the read falls back to, whether or not P ships the name), the bare
 * plain read's refusal counting holders in code, `?package=` refused on a
 * type not stored per package, and whether the addressed slot holds a row.
 */

import { describe, expect, it } from 'vitest';
import { PackageScopedNameRefusedError, packageScopedRefusalMessage } from '@objectstack/core';
import { historySlotOf } from './protocol-history-slots.js';

interface FakeOptions {
    candidates?: string[];
    unbound?: boolean;
    /** The row `findServedOverlayRow` serves for `?package=`; `undefined` serves none. */
    served?: { package_id?: string | null } | undefined;
    shippers?: string[];
    /** What the registry's `resolveItem` does for a bare read. */
    resolve?: () => unknown;
}

function fakeHost(options: FakeOptions) {
    return {
        engine: {
            registry: {
                readsByPackage: () => true,
                resolveItem: options.resolve ?? (() => ({ status: 'resolved' })),
            },
        },
        packagelessAddress: async () => ({
            candidates: options.candidates ?? [],
            unbound: options.unbound ?? false,
        }),
        findServedOverlayRow: async () => (options.served === undefined ? undefined : { row: options.served }),
        shippedArtifactsOf: () => (options.shippers ?? []).map((id) => ({ _packageId: id })),
    } as any;
}

function twoShipperRefusal(): PackageScopedNameRefusedError {
    const base = {
        status: 'refused' as const,
        reason: 'ambiguous-in-environment' as const,
        type: 'flow' as any,
        name: 'n',
        callerPackageId: null,
        candidates: [
            { kind: 'package' as const, packageId: 'com.a' },
            { kind: 'package' as const, packageId: 'com.b' },
        ],
    };
    return new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
}

describe('historySlotOf: ?package=P addresses the slot of the row a read naming P serves', () => {
    it('P ships the name and the read falls back to the package-less row: the environment slot', async () => {
        const slot = await historySlotOf(
            fakeHost({ unbound: true, served: { package_id: null }, shippers: ['com.a'] }),
            { type: 'flow', name: 'n', packageId: 'com.a' },
        );
        expect(slot).toEqual({ owner: { packageId: null, sole: true }, addressed: true, held: true });
    });

    it('P does not ship the name and the read falls back to the package-less row: the environment slot', async () => {
        const slot = await historySlotOf(
            fakeHost({ unbound: true, served: { package_id: null }, shippers: [] }),
            { type: 'flow', name: 'n', packageId: 'com.a' },
        );
        expect(slot).toEqual({ owner: { packageId: null, sole: true }, addressed: true, held: true });
    });

    it("P's own row: P's slot, not sole beside the package-less row", async () => {
        const slot = await historySlotOf(
            fakeHost({ candidates: ['com.a'], unbound: true, served: { package_id: 'com.a' } }),
            { type: 'flow', name: 'n', packageId: 'com.a' },
        );
        expect(slot).toEqual({ owner: { packageId: 'com.a', sole: false }, addressed: true, held: true });
    });

    it('P ships the name and holds no row while another package does: P\'s own empty slot', async () => {
        const slot = await historySlotOf(
            fakeHost({ candidates: ['com.b'], served: undefined, shippers: ['com.a', 'com.b'] }),
            { type: 'flow', name: 'n', packageId: 'com.a' },
        );
        expect(slot).toEqual({ owner: { packageId: 'com.a', sole: false }, addressed: true, held: false });
    });

    it('no row of the name is stored at all: P\'s slot, held by nothing', async () => {
        const slot = await historySlotOf(
            fakeHost({ served: undefined }),
            { type: 'flow', name: 'n', packageId: 'com.nope' },
        );
        expect(slot).toEqual({ owner: { packageId: 'com.nope', sole: true }, addressed: true, held: false });
    });

    it('a package that neither holds nor ships the name, while another holds it: refused not-held-by-qualifier', async () => {
        const refused = await historySlotOf(
            fakeHost({ candidates: ['com.b'], served: undefined, shippers: ['com.b'] }),
            { type: 'flow', name: 'n', packageId: 'com.a' },
        ).catch((error) => error);
        expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
        expect(refused.refusal.reason).toBe('not-held-by-qualifier');
        expect(refused.refusal.candidates).toEqual([{ kind: 'package', packageId: 'com.b' }]);
    });
});

describe('historySlotOf: naming no package', () => {
    it('two row slots: refused ambiguous-in-environment naming both', async () => {
        const refused = await historySlotOf(
            fakeHost({ candidates: ['com.a'], unbound: true }),
            { type: 'flow', name: 'n' },
        ).catch((error) => error);
        expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
        expect(refused.refusal.reason).toBe('ambiguous-in-environment');
        expect(refused.refusal.candidates).toEqual([
            { kind: 'package', packageId: 'com.a' },
            { kind: 'environment' },
        ]);
    });

    it('one row slot the bare plain read refuses (a second holder in code): the read\'s own refusal', async () => {
        const thrown = twoShipperRefusal();
        const refused = await historySlotOf(
            fakeHost({ candidates: ['com.a'], resolve: () => { throw thrown; } }),
            { type: 'flow', name: 'n' },
        ).catch((error) => error);
        expect(refused).toBe(thrown);
    });

    it('a resolver failure that is not a package-scoped refusal leaves the door to its row slots', async () => {
        const slot = await historySlotOf(
            fakeHost({ candidates: ['com.a'], resolve: () => { throw new Error('not found'); } }),
            { type: 'flow', name: 'n' },
        );
        expect(slot).toEqual({ owner: { packageId: 'com.a', sole: true }, addressed: false, held: true });
    });

    it('CONTROL: one row slot the bare read serves answers that slot as sole', async () => {
        const slot = await historySlotOf(fakeHost({ unbound: true }), { type: 'flow', name: 'n' });
        expect(slot).toEqual({ owner: { packageId: null, sole: true }, addressed: false, held: true });
    });

    it('CONTROL: no row slot answers nothing (the door answers as before)', async () => {
        expect(await historySlotOf(fakeHost({}), { type: 'flow', name: 'n' })).toBeUndefined();
    });
});

describe('historySlotOf: a type not stored per package', () => {
    it('?package= is refused 400 VALIDATION_ERROR on param "package"', async () => {
        const refused = await historySlotOf(fakeHost({}), { type: 'view', name: 'n', packageId: 'com.a' })
            .catch((error) => error);
        expect(refused).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'package' });
    });

    it('CONTROL: named bare it answers nothing', async () => {
        expect(await historySlotOf(fakeHost({}), { type: 'view', name: 'n' })).toBeUndefined();
    });
});
