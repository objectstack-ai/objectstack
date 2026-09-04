// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15068 — the publish-then-read path under `applyPublishedSeeds`, and the
 * proof that its org-then-env ladder cannot choose between its two rungs.
 *
 * ## What the ladder was, and why deleting it needed a measurement
 *
 * `POST /packages/:id/publish-drafts` reads each just-published `seed` body
 * back before handing it to `SeedLoaderService`. That read ran twice:
 *
 * ```
 * const attempts = organizationId
 *     ? [{ type: 'seed', name, organizationId }, { type: 'seed', name }]
 *     : [{ type: 'seed', name }];
 * ```
 *
 * The comment above it said "try the active org first, then fall back to an
 * env-wide read … resolving the wrong scope here is what silently produced
 * `0 rows loaded`". So the ladder was written for a real outage, and ⛔ a
 * registry reading alone was not licence to delete it. The deletion is
 * licensed by §1 below instead: the two rungs issue the SAME query.
 *
 * ## The mechanism, in one line
 *
 * `getMetaItem` opens with `organizationIdForMetaRead(request.type,
 * request.organizationId)` (#14908, the singular twin of #14683's plural
 * gate) and spends that binding — never `request.organizationId` — on every
 * read below it. `seed` declares `allowOrgOverride: false`
 * (`metadata-plugin.zod.ts`), so the predicate answers `undefined` whatever
 * organization arrives. ⇒ `{ type:'seed', name, organizationId }` and
 * `{ type:'seed', name }` differ in a field the callee provably drops.
 *
 * ⛔ The repair is NOT to restore org-awareness to this read. An org-scoped
 * `seed` row is the unhydratable phantom `reportUnhydratableOrgScopedRows`
 * exists to warn about — the same argument the `app` flip one function up
 * carries since #15063.
 *
 * ## How this file is composed, and which half is doubled
 *
 * The PUBLISH is real: §-fixture stages a `state:'draft'` seed row and
 * promotes it with the shipping `publishPackageDrafts`, over the shipping
 * `ObjectStackProtocolImplementation`. The READ-BACK is real: the same
 * protocol instance serves `getMetaItem`, over the same engine, reading the
 * row that publish just wrote. The loader is the real `SeedLoaderService`.
 *
 * ONE thing is doubled, and only to reach the code under test at all: the
 * route-level apply runs *only* for protocols that do not self-apply seeds
 * inside `publishPackageDrafts` ("never run both, or an externalId-less seed
 * would double-insert"). So the second call presents a `publishPackageDrafts`
 * that reports the published seed without a `seedApplied` field — the exact
 * population this fallback documents itself as existing for. It also records
 * the request it received, which is §0's positive control that the session's
 * organization really reached this request.
 *
 * ## Sections, and which are evidence vs. which are the bound
 *
 * §0 · positive control — the ladder is REACHED and the read resolves the row
 *      the publish just wrote. Without it "nothing reddened" is
 *      indistinguishable from "nothing ran".
 * §1 · the identity — both rungs, run against one store, ask the engine the
 *      same predicates and serve the same answer, with a control proving the
 *      comparison CAN separate them (`view`). GREEN before and after the
 *      collapse: this section is the ablation's instrument, not its result.
 * §2 · the collapse — the read verb is no longer handed an organization the
 *      gate drops, and one failing read is one read. RED before the fix.
 * §3 · the payload — a failed read-back is reported ONCE, not twice. RED
 *      before the fix, and the one observable the deletion changes.
 *
 * ⭐ Measured here and NOT claimed by the card: `getMetaItem` answers a
 * wrapper with no `item` rather than a falsy value for a name it cannot
 * resolve, so `if (item) break` fires on the first attempt even on a MISS
 * (§1 [MECHANISM]). The second rung therefore only ever executed on the THROW
 * branch — where it repeated the identical failing read and appended the same
 * sentence to a client-facing payload twice (§3).
 */

import { describe, expect, it, vi } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    organizationIdForMetaRead,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { HttpDispatcher } from '../http-dispatcher.js';

const ORG = 'org_acme';
const PKG = 'com.workspace';
const SEED = 'project_seed';

/** The seed body a publish stores and the read-back must return. */
const SEED_BODY = {
    object: 'project',
    externalId: 'name',
    mode: 'upsert',
    records: [{ name: 'Apollo', status: 'active' }, { name: 'Gemini', status: 'planned' }],
};

// ---------------------------------------------------------------------------
// Engine double — a row store that RECORDS every `sys_metadata` predicate.
// ---------------------------------------------------------------------------

interface Row { id: string; [k: string]: unknown }

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
        if (cond === undefined) continue;
        if (key === '$or') {
            const branches = cond as Array<Record<string, unknown>>;
            if (!branches.some((b) => matches(row, b))) return false;
            continue;
        }
        const value = row[key];
        if (cond !== null && typeof cond === 'object') {
            const op = cond as Record<string, unknown>;
            if ('$null' in op) {
                if ((value === null || value === undefined) !== (op.$null === true)) return false;
                continue;
            }
            if ('$in' in op) {
                if (!(op.$in as unknown[]).includes(value)) return false;
                continue;
            }
            continue;
        }
        if (cond === null) {
            if (value !== null && value !== undefined) return false;
            continue;
        }
        if (value !== cond) return false;
    }
    return true;
}

/**
 * ⛔ Every write verb opens with the PRODUCER's own dispatch predicate
 * (`check:engine-double-contract`) so this double cannot accept a call the
 * real ObjectQL engine would refuse — imported from `@objectstack/metadata-core`,
 * never from `@objectstack/objectql` (that reverse edge is a cycle turbo refuses).
 */
function makeEngine() {
    const tables = new Map<string, Row[]>();
    /** Every `sys_metadata` WHERE the read path issued — the observation channel. */
    const metaReads: Array<Record<string, unknown>> = [];
    let nextId = 0;
    const tableOf = (name: string): Row[] => {
        let t = tables.get(name);
        if (!t) { t = []; tables.set(name, t); }
        return t;
    };
    const engine: any = {
        registry: {
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            getAllPackages: () => [],
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
            registerItem: () => undefined,
            registerObject: () => undefined,
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata') metaReads.push({ ...(opts?.where ?? {}) });
            return tableOf(table).filter((r) => matches(r, opts?.where));
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata') metaReads.push({ ...(opts?.where ?? {}) });
            return tableOf(table).find((r) => matches(r, opts?.where)) ?? null;
        },
        async insert(table: string, data: any) {
            const one = (d: Record<string, unknown>): Row => {
                nextId += 1;
                const row: Row = { id: (d.id as string) ?? `r_${nextId}`, ...d };
                tableOf(table).push(row);
                return row;
            };
            return Array.isArray(data) ? data.map(one) : one(data);
        },
        async update(table: string, data: Record<string, unknown>, opts?: { where?: Record<string, unknown> }) {
            const dispatch = assertEngineUpdateDispatch(data as any, opts as any);
            const rows = tableOf(table);
            const target = dispatch.kind === 'by-id'
                ? rows.find((r) => r.id === dispatch.id)
                : rows.find((r) => matches(r, opts?.where));
            if (target) Object.assign(target, data);
            return target ?? null;
        },
        async delete(table: string, opts?: { where?: Record<string, unknown> }) {
            const dispatch = assertEngineDeleteDispatch(opts as any);
            const rows = tableOf(table);
            const keep = dispatch.kind === 'by-id'
                ? rows.filter((r) => r.id !== dispatch.id)
                : rows.filter((r) => !matches(r, opts?.where));
            const deleted = rows.length - keep.length;
            tables.set(table, keep);
            return { deleted };
        },
        async count(table: string, opts?: { where?: Record<string, unknown> }) {
            return tableOf(table).filter((r) => matches(r, opts?.where)).length;
        },
        async aggregate() { return []; },
        async execute() { return undefined; },
        rowsOf: tableOf,
        metaReads,
    };
    return engine;
}

/** An authenticated package admin — the route's anonymous-deny + capability floor. */
const PKG_ADMIN = (): any => ({
    request: { headers: {} },
    environmentId: 'env_1',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
});

interface DriveOptions {
    /** Session's active organization; `undefined` drives the one-rung branch. */
    activeOrganizationId?: string;
    /** Injection: the read-back throws this instead of answering. */
    readBackError?: () => Error;
}

/**
 * Stage a draft seed, promote it with the REAL `publishPackageDrafts`, then
 * drive the route whose fallback reads it back.
 */
async function publishThenRead(opts: DriveOptions = {}) {
    const engine = makeEngine();
    engine.rowsOf('sys_metadata').push({
        id: 'row_seed_draft',
        type: 'seed',
        name: SEED,
        organization_id: null,
        package_id: PKG,
        state: 'draft',
        metadata: JSON.stringify(SEED_BODY),
    });

    const real = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;

    // ── The real publish. Draft → active, through the shipping primitive. ──
    const published = await real.publishPackageDrafts({ packageId: PKG });

    // Anything the publish itself loaded is not what this file measures; the
    // read-back below must stand on its own.
    engine.rowsOf('project').length = 0;
    engine.metaReads.length = 0;

    /** Every request the read-back verb received, in order. */
    const readBackArgs: Array<Record<string, unknown>> = [];
    const getMetaItem = vi.fn(async (request: any) => {
        readBackArgs.push({ ...request });
        if (opts.readBackError) throw opts.readBackError();
        return await real.getMetaItem(request);
    });

    /** What `publishPackageDrafts` was asked for — §0's organization control. */
    let publishRequest: any;
    const facade = {
        // ⛔ Deliberately reports NO `seedApplied`: the route-level apply runs
        // only for protocols that do not self-apply, and that branch is the
        // code under test.
        publishPackageDrafts: async (request: any) => {
            publishRequest = request;
            return {
                success: true,
                outcome: 'published',
                publishedCount: 1,
                failedCount: 0,
                published: [{ type: 'seed', name: SEED, version: 'h' }],
                failed: [],
            };
        },
        getMetaItem,
    };

    const services: Record<string, unknown> = {
        protocol: facade,
        objectql: engine,
        metadata: {
            getObject: async () => ({
                name: 'project',
                fields: { name: { type: 'text' }, status: { type: 'select' } },
            }),
        },
        auth: {
            api: {
                getSession: async () => (opts.activeOrganizationId
                    ? { session: { activeOrganizationId: opts.activeOrganizationId } }
                    : { session: {} }),
            },
        },
    };
    const kernel: any = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    };

    const result = await new HttpDispatcher(kernel).handlePackages(
        `/${PKG}/publish-drafts`, 'POST', {}, {}, PKG_ADMIN(),
    );
    expect(result.response?.status).toBe(200);
    const body: any = (result.response as any)?.body;
    return {
        engine,
        published,
        publishRequest: () => publishRequest,
        readBackArgs,
        getMetaItem,
        body,
        seedApplied: body?.data?.seedApplied,
    };
}

/**
 * A self-correcting refusal of the shape `SysMetadataRepository` raises. It
 * DECLARED itself 4xx (ADR-0112), which is what makes its sentence quotable to
 * the author at all — the bound `packages-seed-apply-disclosure.test.ts` owns.
 */
const DECLARED_REFUSAL = () => {
    const e: any = new Error(`[item_locked] seed "${SEED}" is locked by another publish`);
    e.code = 'ITEM_LOCKED';
    e.status = 403;
    return e;
};

/** A store holding the published seed row, env-wide, exactly as publish leaves it. */
function seededStore() {
    const engine = makeEngine();
    engine.rowsOf('sys_metadata').push({
        id: 'row_seed_active',
        type: 'seed',
        name: SEED,
        organization_id: null,
        package_id: PKG,
        state: 'active',
        metadata: JSON.stringify(SEED_BODY),
    });
    return engine;
}

/** The `sys_metadata` predicates issued for `type:'seed'`, in order. */
const seedReads = (engine: any): Array<Record<string, unknown>> =>
    engine.metaReads.filter((w: any) => w.type === 'seed');

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the positive control: the ladder is REACHED, on a path that works
// ═══════════════════════════════════════════════════════════════════════════

describe('#15068 · 0 · the publish-then-read path really runs', () => {
    it('promotes the draft and reads the just-published body back out of the store', async () => {
        const { published, engine, getMetaItem } = await publishThenRead({
            activeOrganizationId: ORG,
        });

        // The publish is the shipping one, and it really promoted the draft.
        expect(published?.publishedCount).toBe(1);
        expect(engine.rowsOf('sys_metadata').some(
            (r: any) => r.type === 'seed' && r.name === SEED && r.state === 'active',
        )).toBe(true);

        // The read-back reached `sys_metadata` — not a registry cache, not a
        // double. Without this, §1's "every partition was env-wide" could be
        // satisfied by zero partitions.
        expect(getMetaItem).toHaveBeenCalled();
        expect(seedReads(engine).length).toBeGreaterThan(0);

        // And it resolved the row the publish just wrote. `0 rows loaded` is
        // the outage the ladder was written for, and THIS is the layer that
        // outage lives at: the body coming back, from the right partition.
        const served: any = await getMetaItem.mock.results[0]?.value;
        expect(served?.item?.object).toBe('project');
        expect(served?.item?.records).toHaveLength(2);
    });

    it('the session organization really reaches this request', async () => {
        const { publishRequest } = await publishThenRead({ activeOrganizationId: ORG });

        // `applyPublishedSeeds` receives the SAME binding this route handed
        // `publishPackageDrafts` — one `resolveActiveOrganizationId` call
        // serves both. So an org here is what put the ladder on its two-rung
        // branch: without this control every measurement below could be of the
        // one-rung branch and would prove nothing.
        expect(publishRequest()?.organizationId).toBe(ORG);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — the identity. GREEN before AND after the collapse: this section is the
//      ablation's instrument, not its result.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15068 · 1 · the two rungs resolve to one read', () => {
    it('`seed` is non-overridable, so the read gate drops the organization', () => {
        // The registry fact the card rests on, read from the registry rather
        // than restated.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'seed')?.allowOrgOverride)
            .toBe(false);
        expect(organizationIdForMetaRead('seed', ORG)).toBeUndefined();
        // ⇒ and the control that makes that reading mean something: the same
        // predicate DOES carry an organization for an overridable type.
        expect(organizationIdForMetaRead('view', ORG)).toBe(ORG);
    });

    it('the two rungs issue the same predicates and serve the same answer', async () => {
        // The measurement the deletion rests on, taken at the verb itself:
        // run BOTH rungs against one store and compare what the engine was
        // asked and what came back. Done for the HIT and the MISS, the only
        // two branches the loop distinguishes.
        for (const name of [SEED, 'no_such_seed']) {
            const engine = seededStore();
            const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;

            const orgFirst = await protocol.getMetaItem({ type: 'seed', name, organizationId: ORG });
            const orgFirstReads = engine.metaReads.splice(0);
            const envWide = await protocol.getMetaItem({ type: 'seed', name });
            const envWideReads = engine.metaReads.splice(0);

            expect(orgFirstReads.length, name).toBeGreaterThan(0);
            expect(JSON.stringify(orgFirstReads), name).toBe(JSON.stringify(envWideReads));
            expect(JSON.stringify(orgFirst), name).toBe(JSON.stringify(envWide));
        }
    });

    it('[CONTROL] the same comparison DOES separate the two rungs for an overridable type', async () => {
        // Anti-vacuity, and the reason the assertion above is a reading rather
        // than a tautology: on `view` — `allowOrgOverride: true` — the org-first
        // rung reads a partition the env-wide rung never touches.
        const engine = seededStore();
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;

        await protocol.getMetaItem({ type: 'view', name: 'anything', organizationId: ORG });
        const orgFirstReads = engine.metaReads.splice(0);
        await protocol.getMetaItem({ type: 'view', name: 'anything' });
        const envWideReads = engine.metaReads.splice(0);

        expect(JSON.stringify(orgFirstReads)).not.toBe(JSON.stringify(envWideReads));
        expect(orgFirstReads.map((w: any) => w.organization_id)).toContain(ORG);
    });

    it('every partition the publish path touches for a seed is env-wide', async () => {
        const { engine } = await publishThenRead({ activeOrganizationId: ORG });

        expect([...new Set(seedReads(engine).map((w) => w.organization_id ?? null))])
            .toEqual([null]);
    });

    it('[MECHANISM] a read that resolves nothing still answers a wrapper, so rung 2 is not even reached', async () => {
        // Measured, and it is why the ladder is deader than the card claims:
        // `getMetaItem` answers an envelope (`{ type, name, lock, editable, … }`)
        // with no `item` rather than a falsy value, so `if (item) break` fires
        // on the FIRST attempt even for a name nothing resolves. The only
        // branch on which the second attempt ever executed is the THROW branch
        // — where it repeats the identical failing read (§3).
        //
        // GREEN before and after the collapse. It is a bound on what the
        // deletion can possibly have changed, not evidence that it changed it.
        const engine = seededStore();
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
        const miss = await protocol.getMetaItem({ type: 'seed', name: 'no_such_seed' });

        expect(miss).toBeTruthy();
        expect(miss.item).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — the collapse. RED before the fix, GREEN after.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15068 · 2 · the publish path stops spending an organization the gate drops', () => {
    it('hands the read verb exactly the request the gate will act on', async () => {
        const { readBackArgs } = await publishThenRead({ activeOrganizationId: ORG });

        // Not cosmetic: an `organizationId` on a non-overridable read is the
        // shape #14908 and #15063 exist to stop anyone reading as meaningful.
        expect(readBackArgs).toEqual([{ type: 'seed', name: SEED }]);
    });

    it('issues one read-back per seed even when the read fails', async () => {
        const withOrg = await publishThenRead({
            activeOrganizationId: ORG, readBackError: DECLARED_REFUSAL,
        });
        const withoutOrg = await publishThenRead({ readBackError: DECLARED_REFUSAL });

        // The throw branch is the one place the second rung ever ran. One
        // failing read, reported once — and the same count with or without an
        // active organization, which is the whole content of "the rung was
        // dead".
        expect(withOrg.readBackArgs).toHaveLength(1);
        expect(withOrg.readBackArgs.length).toBe(withoutOrg.readBackArgs.length);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — the payload. The one observable the deletion changes.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15068 · 3 · a failed read-back is reported once, not twice', () => {
    it('quotes a declared 4xx refusal exactly once with an org active', async () => {
        const refusal = DECLARED_REFUSAL();
        // ADR-0112 — the declaration that makes the sentence quotable to the
        // author at all, asserted on `code` AND `status`. ⛔ Never a bare
        // `toThrow()`: this door does not throw, it REPORTS, and the whole
        // assertion is about what the report says.
        expect(refusal.code).toBe('ITEM_LOCKED');
        expect(refusal.status).toBe(403);

        const { seedApplied } = await publishThenRead({
            activeOrganizationId: ORG, readBackError: DECLARED_REFUSAL,
        });

        // `seedApplied.errors[]` rides on a 200 as DATA. Running the same
        // failed read twice put the same sentence on it twice, and an author
        // reading two identical lines has no way to tell that from two
        // distinct failures.
        expect(seedApplied?.errors?.filter(
            (e: unknown) => String(e) === `read ${SEED}: ${refusal.message}`,
        )).toHaveLength(1);
        expect(seedApplied?.success).toBe(false);
        expect(seedApplied?.error).toBe('seed apply: no readable seed bodies');
    });
});
