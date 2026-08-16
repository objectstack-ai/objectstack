// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9009] The ADR-0010 lock gate folds its OWN type key — the class closed at
 * the producer, not one entry point at a time.
 *
 * ---------------------------------------------------------------------------
 * The seam
 * ---------------------------------------------------------------------------
 * `getEffectiveLock` has two limbs and they did not read `type` the same way:
 *
 *   artifact limb   `lookupArtifactItem` → `PLURAL_TO_SINGULAR[type] ?? type`,
 *                   then the raw spelling as a second lookup. FOLDED.
 *   overlay limb    `engine.findOne('sys_metadata', { where: { type, … } })`.
 *                   RAW — and `SysMetadataRepository.whereFor` emits the
 *                   CANONICAL spelling with no at-rest fallback, so the stored
 *                   active row lives under a `type` this query never asked for.
 *
 * A miss on that query falls through to `lock: 'none'`, which is not a neutral
 * placeholder: it is the verdict "the author declared no protection" (#5706),
 * and `evaluateLockForWrite` / `evaluateLockForDelete` turn it straight into
 * "allow". So an `_lock` was addressable AROUND by spelling the type
 * differently, and the gate answered "unlocked" with complete confidence.
 *
 * #8769 closed that on `publishMetaItem` and #8819 on `rollbackMetaItem`, each
 * by folding ITS OWN request — and `rollbackMetaItem`'s comment said so, then
 * promised a card for the producer that was never filed. This is that fold.
 *
 * ---------------------------------------------------------------------------
 * Why these tests call the gate directly, and why that is the honest level
 * ---------------------------------------------------------------------------
 * Every live caller folds first — measured before the fix was written:
 * `saveMetaItem`, `deleteMetaItem`, `rollbackMetaItem` and `publishMetaItem`
 * all run `canonicalizeMetaRequestType` at their top, and `publishPackageDrafts`
 * folds `d.type` with `canonicalMetaType` before `promoteDraftForPublish`. There
 * is therefore NO wire request that reaches the gate unfolded: a plural is
 * refused at the boundary by `metaUrlSpellingRefusal` (400) long before it gets
 * here. Driving this through a route would measure the boundary fold a second
 * time and say nothing at all about the producer.
 *
 * The subject is the gate's own contract — "callers must fold", an invariant
 * that lived in no type, no signature and no assertion — so the gate is where
 * these tests address it. That is the same reachability discipline #8820
 * landed on: trace to each caller's PRODUCER, and put the guard where the
 * invariant is, not where today's traffic happens to enter.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red. Restoring the two raw `type` reads
 * (`lookupArtifactItem(type, name)` and `where: { type, … }`) must turn the
 * folding cases red and leave every control green:
 *
 *   plural, manifest-PRESENT (`views`)        full/overlay → 'none'    → RED
 *   the overlay query's own `where.type`      'view' → 'views'         → RED
 *   plural, manifest-ABSENT (`translations`)  full/overlay → 'none'    → RED
 *   write refusal envelope on a plural        403 → null (allowed)     → RED
 *   delete gate on a plural                   500 loud → null (allowed)→ RED
 *   canonical spelling, locked                unchanged                → GREEN
 *   canonical spelling, genuine miss          unchanged                → GREEN
 *   ARTIFACT lock under a plural              unchanged                → GREEN
 *   canonical, locked delete                  unchanged                → GREEN
 *
 * The third green is the one that carries an argument rather than a count: the
 * artifact limb already folded, so it was never the hole — and a "fix" that
 * changed its answer would be changing something that was already right.
 *
 * Predicted 5 red / 4 green; measured 5 red / 4 green, each red for its
 * predicted reason rather than merely in the predicted count —
 * `expected 'none' to be 'full'` twice (the two plural classes, one per map),
 * `expected { type: 'views', … } to match object { type: 'view', … }` (the
 * query itself), `expected null not to be null` (no refusal was produced at
 * all) and `expected a rejection, but the call resolved with null` (the delete
 * gate admitted it). Quoted in the PR body as taken.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * An overlay row exactly as `SysMetadataRepository` stores it: keyed by the
 * CANONICAL `type`, never by whatever spelling a caller used.
 */
function overlayRow(type: string, name: string, lock: string) {
    return {
        id: `row-${type}-${name}`,
        type,
        name,
        state: 'active',
        organization_id: null,
        package_id: null,
        checksum: 'sha256:stored-head',
        metadata: JSON.stringify({ name, _lock: lock, _lockReason: 'governed by ops' }),
    };
}

type Harness = {
    engine: any;
    /** Every `sys_metadata` where-clause the gate issued, in order. */
    overlayQueries: Array<Record<string, unknown>>;
};

/**
 * A store that answers ONLY the key it actually holds — which is the whole
 * point. A double that matched on `name` alone would resolve the row under any
 * spelling and erase the defect in the harness (#7743: a gate is proven where
 * it is exercised and absent where it is used).
 *
 * `registryItems` is keyed `'type/name'` for the same reason: the artifact limb
 * must be measurable as having resolved under one spelling and not another.
 */
function harness(opts: {
    rows?: Array<{ type: string; name: string; lock: string }>;
    registryItems?: Record<string, unknown>;
}): Harness {
    const rows = (opts.rows ?? []).map((r) => overlayRow(r.type, r.name, r.lock));
    const items = opts.registryItems ?? {};
    const overlayQueries: Array<Record<string, unknown>> = [];

    const engine: any = {
        registry: {
            getObject: () => undefined,
            getItem: (type: string, name: string) => items[`${type}/${name}`],
            listItems: () => [],
            applyNavContributions: (x: unknown) => x,
            isPackageDisabled: () => false,
            getObjectOwner: () => undefined,
        },
        findOne: vi.fn(async (object: string, query: any) => {
            if (object !== 'sys_metadata') return null;
            const where = (query?.where ?? {}) as Record<string, unknown>;
            overlayQueries.push(where);
            return rows.find((r) =>
                r.type === where['type']
                && r.name === where['name']
                && r.state === where['state']) ?? null;
        }),
        find: vi.fn(async () => []),
        insert: vi.fn(async (_object: string, values: any) => ({ id: 'inserted', ...values })),
        count: vi.fn(async () => 0),
        execute: vi.fn(async () => ({})),
        getObjectSchema: vi.fn(async () => undefined),
    };
    return { engine, overlayQueries };
}

/** Tenant scope — the control plane (`environmentId` undefined) skips the gate. */
function protocolFor(h: Harness) {
    return new ObjectStackProtocolImplementation(h.engine, undefined, 'env_1') as any;
}

/** Capture a rejection without letting a resolve pass silently. */
async function rejection(run: () => Promise<unknown>): Promise<any> {
    let caught: any;
    let resolved: unknown;
    let didResolve = false;
    try {
        resolved = await run();
        didResolve = true;
    } catch (e) {
        caught = e;
    }
    expect(
        didResolve,
        `expected a rejection, but the call resolved with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return caught;
}

describe('[#9009] getEffectiveLock resolves the overlay row under the canonical type', () => {
    it('finds the lock when handed a manifest-PRESENT plural (`views`)', async () => {
        const h = harness({ rows: [{ type: 'view', name: 'v1', lock: 'full' }] });

        const state = await protocolFor(h).getEffectiveLock('views', 'v1', null);

        // The regression, verbatim: this used to answer `'none'` — "the author
        // declared no protection" — for a row that declares `_lock: 'full'`.
        expect(state.lock).toBe('full');
        expect(state.lockSource).toBe('overlay');
        expect(state.lockReason).toBe('governed by ops');
    });

    it('addresses `sys_metadata` by the canonical key, not the caller spelling', async () => {
        const h = harness({ rows: [{ type: 'view', name: 'v1', lock: 'full' }] });

        await protocolFor(h).getEffectiveLock('views', 'v1', null);

        // The direct measurement of the fold: what the query ASKED FOR, rather
        // than what it happened to get back.
        expect(h.overlayQueries).toHaveLength(1);
        expect(h.overlayQueries[0]).toMatchObject({
            type: 'view',
            name: 'v1',
            state: 'active',
            organization_id: null,
        });
    });

    it('finds the lock for a manifest-ABSENT plural (`translations`) too', async () => {
        // The class `PLURAL_TO_SINGULAR` structurally cannot cover: `field`,
        // `seed`, `external_catalog` and `translation` are not stack
        // collections, so the manifest map omits them and a fold written
        // against THAT map would leave exactly these four unfolded — the
        // "tolerant AND INCOMPLETE" shape #8908 rejected. `canonicalMetaType`
        // reads the URL map, which carries them.
        const h = harness({ rows: [{ type: 'translation', name: 't1', lock: 'full' }] });

        const state = await protocolFor(h).getEffectiveLock('translations', 't1', null);

        expect(state.lock).toBe('full');
        expect(state.lockSource).toBe('overlay');
        expect(h.overlayQueries[0]).toMatchObject({ type: 'translation', name: 't1' });
    });

    it('the canonical spelling is unchanged — the control the fold must not move', async () => {
        const h = harness({ rows: [{ type: 'view', name: 'v1', lock: 'full' }] });

        const state = await protocolFor(h).getEffectiveLock('view', 'v1', null);

        expect(state.lock).toBe('full');
        expect(state.lockSource).toBe('overlay');
        expect(h.overlayQueries[0]).toMatchObject({ type: 'view' });
    });

    it('a genuine miss still answers `none` — folding must not refuse everything', async () => {
        // Without this, "the gate is fail-closed" would be satisfiable by a gate
        // that locks every item in the deployment.
        const h = harness({ rows: [{ type: 'view', name: 'v1', lock: 'full' }] });

        const state = await protocolFor(h).getEffectiveLock('view', 'v_unlocked', null);

        expect(state.lock).toBe('none');
        expect(state.lockSource).toBeUndefined();
    });

    it('the ARTIFACT limb was never the hole — and still answers the same', async () => {
        // Green BEFORE and AFTER, deliberately. `lookupArtifactItem` already
        // folded through the manifest map and then retried the raw spelling, so
        // a packaged `_lock` resolved under a plural all along. Pinning it keeps
        // the fix from being credited with something that was already right —
        // and pins the ASYMMETRY that made the two limbs able to disagree.
        const h = harness({
            registryItems: {
                'view/v_pkg': { name: 'v_pkg', _packageId: 'pkg-a', _lock: 'full', _lockReason: 'shipped locked' },
            },
        });

        const state = await protocolFor(h).getEffectiveLock('views', 'v_pkg', null);

        expect(state.lock).toBe('full');
        expect(state.lockSource).toBe('artifact');
        // The overlay limb is never reached when the artifact wins.
        expect(h.overlayQueries).toHaveLength(0);
    });
});

describe('[#9009] the write gate refuses an unfolded caller instead of admitting it', () => {
    it('answers the ADR-0112 `ITEM_LOCKED` envelope for a plural-addressed write', async () => {
        const h = harness({ rows: [{ type: 'view', name: 'v1', lock: 'full' }] });

        const refusal = await protocolFor(h).lockWriteRefusal({
            type: 'views', name: 'v1', operation: 'save',
        });

        // Pre-fix this was `null` — no refusal at all, and the save proceeded.
        expect(refusal).not.toBeNull();
        expect((refusal.err as any).code).toBe('ITEM_LOCKED');
        expect((refusal.err as any).status).toBe(403);
        expect((refusal.err as any).lock).toBe('full');
        expect(refusal.audit.outcome).toBe('denied');
    });

    it('the delete gate now fails LOUDLY on an unfolded caller, not silently open', async () => {
        // What the fold does to the one gate that writes its audit row where the
        // verdict is reached: `getEffectiveLock` finds the lock, and the refusal
        // is then reported under the CALLER's spelling — which
        // `recordMetadataAudit` refuses outright (#8908's assert, deliberately
        // NOT softened by folding the ledger key here as well).
        //
        // So the unfolded caller gets a 500 it cannot miss, where before the fix
        // it got `null` and the delete went through. Both are refusals of the
        // delete; only one of them is visible.
        const h = harness({ rows: [{ type: 'view', name: 'v1', lock: 'full' }] });

        const caught = await rejection(() => protocolFor(h).assertLockAllowsDelete({
            type: 'views', name: 'v1',
        }));

        expect(caught?.code).toBe('AUDIT_TYPE_NOT_CANONICAL');
        expect(caught?.status).toBe(500);
    });

    it('a canonical, locked delete is refused exactly as before', async () => {
        const h = harness({ rows: [{ type: 'view', name: 'v1', lock: 'full' }] });

        const err = await protocolFor(h).assertLockAllowsDelete({ type: 'view', name: 'v1' });

        expect((err as any)?.code).toBe('ITEM_LOCKED');
        expect((err as any)?.status).toBe(403);
    });
});
