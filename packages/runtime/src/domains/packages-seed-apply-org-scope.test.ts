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
 * §0 · positive control — the ladder is REACHED and the path WORKS. Without
 *      it "nothing reddened" is indistinguishable from "nothing ran".
 * §1 · the identity — every partition this read touches is env-wide, with a
 *      control proving the harness CAN see an org partition. GREEN before and
 *      after the collapse: this is the ablation's instrument, not its result.
 * §2 · the collapse — the active organization no longer changes how many
 *      reads the publish path issues. RED before the fix.
 * §3 · the payload — a failed read-back is reported ONCE, not twice. RED
 *      before the fix, and the one thing the deletion demonstrably changes.
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
    /** Read back a name no publish ever stored — the MISS path, where rung 2 runs. */
    seedName?: string;
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
                published: [{ type: 'seed', name: opts.seedName ?? SEED, version: 'h' }],
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

/** The `sys_metadata` predicates issued for `type:'seed'`, in order. */
const seedReads = (engine: any): Array<Record<string, unknown>> =>
    engine.metaReads.filter((w: any) => w.type === 'seed');

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the positive control: the ladder is REACHED, on a path that works
// ═══════════════════════════════════════════════════════════════════════════

describe('#15068 · 0 · the publish-then-read path really runs', () => {
    it('promotes the draft, reads the body back and loads the rows', async () => {
        const { published, seedApplied, engine, getMetaItem } = await publishThenRead({
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

        // And the rows landed. `0 rows loaded` is the outage this ladder was
        // written for; this assertion is what would catch it coming back.
        expect(seedApplied?.success).toBe(true);
        expect(seedApplied?.inserted).toBe(2);
        expect(engine.rowsOf('project').map((r: any) => r.name).sort())
            .toEqual(['Apollo', 'Gemini']);
    });

    it('the session organization really reaches this request', async () => {
        const { publishRequest } = await publishThenRead({ activeOrganizationId: ORG });

        // `applyPublishedSeeds` receives the SAME binding this route handed
        // `publishPackageDrafts` — one `resolveActiveOrganizationId` call
        // serves both. So an org here is what put the ladder on its two-rung
        // branch: without this control, every measurement below could be of
        // the one-rung branch and would prove nothing.
        expect(publishRequest()?.organizationId).toBe(ORG);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — the identity: the two rungs cannot choose. GREEN before AND after.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15068 · 1 · the org-first rung resolves to the env-wide read', () => {
    it('`seed` is non-overridable, so the read gate drops the organization', () => {
        // The registry fact the whole card rests on, read from the registry
        // rather than restated.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'seed')?.allowOrgOverride)
            .toBe(false);
        expect(organizationIdForMetaRead('seed', ORG)).toBeUndefined();
        // ⇒ and the control that makes that reading mean something: the same
        // predicate DOES carry an organization for an overridable type.
        expect(organizationIdForMetaRead('view', ORG)).toBe(ORG);
    });

    it('every partition the seed read-back touches is env-wide', async () => {
        const { engine } = await publishThenRead({ activeOrganizationId: ORG });

        const partitions = [...new Set(seedReads(engine).map((w) => w.organization_id ?? null))];
        expect(partitions).toEqual([null]);
    });

    it('[CONTROL] the same harness DOES see an org partition for an overridable type', async () => {
        // Anti-vacuity. If the engine could not observe an org-scoped read at
        // all, the assertion above would be green for the wrong reason.
        const engine = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
        await protocol.getMetaItem({ type: 'view', name: 'anything', organizationId: ORG });

        const partitions = [...new Set(
            engine.metaReads.filter((w: any) => w.type === 'view').map((w: any) => w.organization_id ?? null),
        )];
        expect(partitions).toContain(ORG);
    });

    it('a read that finds nothing issues byte-identical predicates', async () => {
        // The MISS path — the only branch on which more than one attempt ever
        // ran. Whatever number of predicates the publish path issues for a
        // seed it cannot find, they are all the SAME predicate: nothing here
        // can resolve a different row than anything else here.
        const { engine } = await publishThenRead({
            activeOrganizationId: ORG,
            seedName: 'no_such_seed',
        });

        const reads = seedReads(engine).map((w) => JSON.stringify(w));
        expect(reads.length).toBeGreaterThan(0);
        expect([...new Set(reads)]).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — the collapse. RED before the fix (2 reads vs 1), GREEN after.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15068 · 2 · the active organization no longer costs a round-trip', () => {
    it('issues exactly one read-back per published seed, org or no org', async () => {
        const withOrg = await publishThenRead({
            activeOrganizationId: ORG, seedName: 'no_such_seed',
        });
        const withoutOrg = await publishThenRead({ seedName: 'no_such_seed' });

        expect(withOrg.readBackArgs).toHaveLength(1);
        expect(withOrg.readBackArgs).toHaveLength(withoutOrg.readBackArgs.length);
    });

    it('does not hand the read verb an organization it is contractually going to drop', async () => {
        const { readBackArgs } = await publishThenRead({
            activeOrganizationId: ORG, seedName: 'no_such_seed',
        });

        // Not cosmetic: an `organizationId` on a non-overridable read is the
        // shape #15063 and #14908 exist to stop reading as meaningful.
        expect(readBackArgs[0]).toEqual({ type: 'seed', name: 'no_such_seed' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — the payload. The one observable the deletion changes.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A self-correcting refusal of the shape `SysMetadataRepository` raises. It
 * DECLARED itself 4xx (ADR-0112), which is what makes its sentence quotable
 * to the author at all — the bound `packages-seed-apply-disclosure.test.ts`
 * owns. Asserted here on `code` AND `status`, never a bare `toThrow()`: this
 * door does not throw, it REPORTS.
 */
const DECLARED_REFUSAL = () => {
    const e: any = new Error(`[item_locked] seed "${SEED}" is locked by another publish`);
    e.code = 'ITEM_LOCKED';
    e.status = 403;
    return e;
};

describe('#15068 · 3 · a failed read-back is reported once, not twice', () => {
    it('quotes a declared 4xx refusal exactly once with an org active', async () => {
        const refusal = DECLARED_REFUSAL();
        expect(refusal.code).toBe('ITEM_LOCKED');
        expect(refusal.status).toBe(403);

        const { seedApplied } = await publishThenRead({
            activeOrganizationId: ORG,
            readBackError: DECLARED_REFUSAL,
        });

        // `seedApplied.errors[]` rides on a 200 as DATA. Running the same
        // failed read twice put the same sentence on it twice — an author
        // reading two identical lines has no way to tell that from two
        // distinct failures.
        const quoted = (seedApplied?.errors ?? []).filter(
            (e: unknown) => String(e) === `read ${SEED}: ${refusal.message}`,
        );
        expect(quoted).toHaveLength(1);
        expect(seedApplied?.success).toBe(false);
        expect(seedApplied?.error).toBe('seed apply: no readable seed bodies');
    });
});
