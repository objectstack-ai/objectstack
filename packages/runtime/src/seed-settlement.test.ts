// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { declareSeedSource, readSeedSettlement, recordOrganizationReplay } from './seed-settlement.js';
import { SEED_SETTLEMENT_SERVICE, type ISeedSettlementService } from '@objectstack/spec/contracts';

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

/**
 * #23354 — which rows the seed wrote, through the same contract.
 *
 * The seed-ownership claims hand over only the unowned rows the seed landed on
 * (ADR-0138 D1: a guest's or a form's unowned row keeps no owner), so the host
 * publishes the loader's `landedIds` and the claims read them back through
 * `seededRecordIds`. Two readings: the boot sources of this process, and the
 * most recent per-organization replay.
 */
describe('seeded record ids (#23354)', () => {
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
    /** The consumer's view: the registered service, read through the spec contract. */
    const service = (ctx: ReturnType<typeof makeCtx>) =>
        ctx.getService(SEED_SETTLEMENT_SERVICE) as ISeedSettlementService;

    it('a source publishes its rows before it settles, so a reader inside app:seeded sees them', () => {
        const ctx = makeCtx();
        const source = declareSeedSource(ctx);

        expect(service(ctx).seededRecordIds!('crm_case')).toEqual([]);
        source.publishLanded([
            { object: 'crm_case', landedIds: ['c1', 'c2'] },
            { object: 'crm_team', landedIds: ['t1'] },
        ]);
        // Published, still in flight: the reading does not wait for the settle.
        expect(readSeedSettlement(ctx)?.inFlight).toBe(1);
        expect(service(ctx).seededRecordIds!('crm_case')).toEqual(['c1', 'c2']);
        source.settle();
        expect(service(ctx).seededRecordIds!('crm_case')).toEqual(['c1', 'c2']);
        expect(service(ctx).seededRecordIds!('crm_team')).toEqual(['t1']);
        expect(service(ctx).seededRecordIds!('crm_unseeded')).toEqual([]);
    });

    it('every boot source adds to one reading, and an id appears once', () => {
        const ctx = makeCtx();
        const a = declareSeedSource(ctx);
        const b = declareSeedSource(ctx);

        a.publishLanded([{ object: 'crm_case', landedIds: ['c1'] }]);
        // Two datasets on one object, and a second pass over the same rows.
        b.publishLanded([{ object: 'crm_case', landedIds: ['c2'] }, { object: 'crm_case', landedIds: ['c1'] }]);

        expect([...service(ctx).seededRecordIds!('crm_case')].sort()).toEqual(['c1', 'c2']);
    });

    it('a per-organization replay is its own reading — the boot reading never answers for an organization', () => {
        const ctx = makeCtx();
        declareSeedSource(ctx).publishLanded([{ object: 'crm_case', landedIds: ['boot_1'] }]);

        recordOrganizationReplay(ctx, 'org_a', [{ object: 'crm_case', landedIds: ['a_1', 'a_2'] }]);

        expect(service(ctx).seededRecordIds!('crm_case', 'org_a')).toEqual(['a_1', 'a_2']);
        expect(service(ctx).seededRecordIds!('crm_case')).toEqual(['boot_1']);
        expect(service(ctx).seededRecordIds!('crm_case', 'org_b')).toEqual([]);
    });

    /**
     * The bound is the design, not an accident: an organization is replayed
     * once, when it is created, and a process creating thousands must not hold
     * every replay's rows. The owner bind that reads it runs in the same call
     * that created the organization.
     */
    it('only the most recent per-organization replay is kept', () => {
        const ctx = makeCtx();
        declareSeedSource(ctx).suppress('multi-tenant-replay');

        recordOrganizationReplay(ctx, 'org_a', [{ object: 'crm_case', landedIds: ['a_1'] }]);
        recordOrganizationReplay(ctx, 'org_b', [{ object: 'crm_case', landedIds: ['b_1'] }]);

        expect(service(ctx).seededRecordIds!('crm_case', 'org_a')).toEqual([]);
        expect(service(ctx).seededRecordIds!('crm_case', 'org_b')).toEqual(['b_1']);

        // A second replay of the same organization replaces, never accumulates.
        recordOrganizationReplay(ctx, 'org_b', [{ object: 'crm_case', landedIds: ['b_2'] }]);
        expect(service(ctx).seededRecordIds!('crm_case', 'org_b')).toEqual(['b_2']);
    });

    it('hands back a copy, so a consumer cannot edit the reading', () => {
        const ctx = makeCtx();
        declareSeedSource(ctx).publishLanded([{ object: 'crm_case', landedIds: ['c1'] }]);

        (service(ctx).seededRecordIds!('crm_case') as string[]).push('forged');

        expect(service(ctx).seededRecordIds!('crm_case')).toEqual(['c1']);
    });

    it('ignores a result with no landed ids, and never throws without a tracker', () => {
        const ctx = makeCtx();
        declareSeedSource(ctx).publishLanded([{ object: 'crm_case' }, { object: 'crm_team', landedIds: [] }]);

        expect(service(ctx).seededRecordIds!('crm_case')).toEqual([]);
        expect(() => recordOrganizationReplay({}, 'org_a', [{ object: 'crm_case', landedIds: ['x'] }])).not.toThrow();
        expect(() => declareSeedSource({}).publishLanded([{ object: 'crm_case', landedIds: ['x'] }])).not.toThrow();
    });
});
