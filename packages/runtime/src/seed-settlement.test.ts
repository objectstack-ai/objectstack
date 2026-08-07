// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { declareSeedSource, readSeedSettlement } from './seed-settlement.js';

/**
 * #4795 — the settlement tally behind the `seed-settlement` contract.
 *
 * The consumer that matters is the ADR-0104 fresh-datastore attestation, which
 * asks one question at `kernel:ready`: "has every seed source this boot knows
 * about finished writing?" Everything below is that question's edge cases.
 */
describe('seed settlement tally (#4795)', () => {
    /** Minimal kernel-ish context: a service map with register/get. */
    function makeCtx() {
        const services = new Map<string, unknown>();
        return {
            registerService(name: string, svc: unknown) {
                if (services.has(name)) throw new Error(`service '${name}' already registered`);
                services.set(name, svc);
            },
            getService(name: string) {
                if (!services.has(name)) throw new Error(`service '${name}' not registered`);
                return services.get(name);
            },
        };
    }

    it('reports nothing until a source is declared', () => {
        expect(readSeedSettlement(makeCtx())).toBeUndefined();
    });

    it('a declared source is pending and in flight; settling clears it', () => {
        const ctx = makeCtx();
        const source = declareSeedSource(ctx);

        expect(readSeedSettlement(ctx)).toEqual({ pending: 1, inFlight: 1, suppressed: [] });

        source.settle();

        expect(readSeedSettlement(ctx)).toEqual({ pending: 0, inFlight: 0, suppressed: [] });
    });

    /**
     * The posture ruled on #4795: a suppressed source stays pending for the
     * life of the boot, which is what tells the attestation to stand down
     * rather than certify rows this boot never wrote.
     */
    it.each(['multi-tenant-replay', 'skip-seed-data'] as const)(
        'a source suppressed as %s stays pending and names its reason',
        (reason) => {
            const ctx = makeCtx();

            declareSeedSource(ctx).suppress(reason);

            expect(readSeedSettlement(ctx)).toEqual({
                pending: 1,
                inFlight: 0,
                suppressed: [reason],
            });
        },
    );

    /**
     * #3453's trap, in this tally's terms: `registerService` throws on a
     * duplicate name, so a second config app must extend the tracker the first
     * one registered instead of clobbering it or losing itself in a `catch`.
     */
    it('a second source extends the first source tally rather than replacing it', () => {
        const ctx = makeCtx();
        const a = declareSeedSource(ctx);
        const b = declareSeedSource(ctx);

        expect(readSeedSettlement(ctx)?.pending).toBe(2);

        a.settle();
        expect(readSeedSettlement(ctx)?.pending).toBe(1);

        b.settle();
        expect(readSeedSettlement(ctx)?.pending).toBe(0);
    });

    it('mixes in-flight and suppressed sources in one tally', () => {
        const ctx = makeCtx();
        declareSeedSource(ctx); // still writing
        declareSeedSource(ctx).suppress('multi-tenant-replay');

        expect(readSeedSettlement(ctx)).toEqual({
            pending: 2,
            inFlight: 1,
            suppressed: ['multi-tenant-replay'],
        });
    });

    /**
     * Both handle methods are terminal. Without this a double-settle (the
     * in-budget path racing a background continuation) would drive the tally
     * negative and read as "everything landed" while a source was still
     * writing — the exact false-clear this module exists to prevent.
     */
    it('settle and suppress are idempotent and terminal', () => {
        const ctx = makeCtx();
        const a = declareSeedSource(ctx);
        const b = declareSeedSource(ctx);

        a.settle();
        a.settle();
        a.suppress('skip-seed-data'); // after settling: ignored

        expect(readSeedSettlement(ctx)).toEqual({ pending: 1, inFlight: 1, suppressed: [] });

        b.suppress('skip-seed-data');
        b.settle(); // after suppressing: ignored

        expect(readSeedSettlement(ctx)).toEqual({
            pending: 1,
            inFlight: 0,
            suppressed: ['skip-seed-data'],
        });
    });

    it('hands back a copy, so a consumer cannot edit the tally it read', () => {
        const ctx = makeCtx();
        declareSeedSource(ctx).suppress('multi-tenant-replay');

        const snap = readSeedSettlement(ctx)!;
        (snap.suppressed as string[]).push('skip-seed-data');

        expect(readSeedSettlement(ctx)?.suppressed).toEqual(['multi-tenant-replay']);
    });

    /**
     * Best-effort like the rest of the seed wiring: a context that cannot carry
     * services gets an inert handle and the consumer simply finds no service,
     * which reads as "no seed pipeline" — the pre-#4795 behaviour, never a
     * boot failure.
     */
    it('never throws on a context that cannot register services', () => {
        expect(() => declareSeedSource({}).settle()).not.toThrow();
        expect(() => declareSeedSource(undefined).suppress('skip-seed-data')).not.toThrow();
        expect(readSeedSettlement({})).toBeUndefined();
    });

    it('reads through a bare kernel handle as well as a plugin context', () => {
        const kernel = makeCtx();
        const ctx = { kernel };

        declareSeedSource(ctx);

        expect(readSeedSettlement(ctx)?.pending).toBe(1);
        expect(readSeedSettlement(kernel)?.pending).toBe(1);
    });
});
