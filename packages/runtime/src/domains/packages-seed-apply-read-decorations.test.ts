// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15591 — the route-level seed apply could not consume the shipping
 * protocol's own read-back envelope.
 *
 * `POST /packages/:id/publish-drafts` reads each just-published `seed` body
 * back through `protocol.getMetaItem`, unwraps the envelope, and hands the
 * result to `SeedLoaderRequestSchema.safeParse`. `getMetaItem` exits through
 * `decorateMetadataItem`, which stamps `_diagnostics` on every body whose type
 * has a registered Zod schema — `seed` has one — and `SeedSchema` has been
 * CLOSED since #4001. So the door refused the platform's own output, minted
 * that refusal as a 422 and delivered it on a **200** as `seedApplied.error`:
 * zero rows loaded, and the author told their seed body failed spec validation
 * when nothing about it is wrong.
 *
 * ## Which side was wrong — settled by the contract, not by judgement
 *
 * The card left the direction open (strip at the consumer, or stop decorating
 * at the producer) and warned that the two underscore keys are not one
 * population. Measured on the real producer, they are not, and the spec says
 * so in both directions:
 *
 *  - `_diagnostics` IS a member of `METADATA_READ_DECORATIONS`
 *    (`spec/kernel/metadata-read-decorations.ts`), whose module states the rule
 *    this door was missing: each member "is DERIVED from the document on every
 *    read, so it belongs to the *response*, never to the document — a served
 *    body is therefore NOT a valid input to the schema that produced it until
 *    these are removed", and names "**any** re-parse of a served document" as
 *    the second class of consumer that must strip. The producer is correct; the
 *    consumer was missing a declared step.
 *  - `_packageId` is "deliberately NOT" a member — ADR-0010 envelope state,
 *    which "the closed metadata schemas allowlist … precisely so a served
 *    document keeps its provenance on re-parse". `SeedSchema` is one of those:
 *    it spreads `MetadataProtectionFields` on purpose. §1 measures both.
 *
 * ⇒ The repair is `stripReadDecorations`, the helper that list ships with —
 * the same call, for the same reason, that `rest-server.ts` makes before
 * parsing a served `dataset` ("A SERVED document is not a valid input to the
 * schema that produced it"), that `service-automation`'s cold-boot flow bind
 * makes, and that `saveMetaItem` makes before its verbatim persist. ⛔ NOT a
 * widened schema (no `.passthrough()`, no request-contract change), and ⛔ NOT
 * the blanket `startsWith('_')` strip `assemblePackageManifest` runs 300 lines
 * up: a portable manifest must SHED provenance, a re-parse must KEEP it, and
 * §3 is the bound that separates those two rules.
 *
 * ## How this file is composed, and which half is doubled
 *
 * The PUBLISH is real: the fixture stages a `state:'draft'` seed row and
 * promotes it with the shipping `publishPackageDrafts` on a real
 * `ObjectStackProtocolImplementation`. The READ-BACK is real: the same
 * protocol instance serves `getMetaItem` over the same engine, so the envelope
 * under test is the platform's own output and not a hand-written fixture. The
 * loader is the real `SeedLoaderService`.
 *
 * ONE thing is doubled, and only to reach the code under test at all: the
 * route-level apply runs *only* for protocols that do not self-apply seeds
 * inside `publishPackageDrafts` ("never run both, or an externalId-less seed
 * would double-insert"), and the shipping protocol DOES self-apply — measured
 * here, `publishPackageDrafts` answers `seedApplied` present. So the route is
 * driven through a facade that reports the published seed without that field:
 * the exact population this fallback documents itself as existing for, and a
 * DECLARED wire behaviour — `PublishPackageDraftsResponseSchema`'s own note
 * says the REST door "back-fills `seedApplied` for custom protocols that do not
 * self-apply". That declaration is why the fallback is repaired here rather
 * than deleted as dead code.
 *
 * ## Sections, and which are evidence vs. which are the bound
 *
 * §0 · positive control — the round trip really runs, and the REAL producer's
 *      read-back carries the decoration. GREEN before and after: without it,
 *      §2 going green could mean the decoration simply never arrived.
 * §1 · the contract reading that decides the direction, read from `spec`
 *      rather than restated. GREEN before and after — the instrument.
 * §2 · the defect — rows load, and the 200 carries no refusal. RED before.
 * §3 · the bound — the strip is the DECLARED list, so `_diagnostics` is gone
 *      from the body the loader receives and `_packageId` is still on it. RED
 *      before (nothing reaches the loader at all), and RED under the wrong
 *      repair (a blanket underscore strip), which is what it exists for.
 *
 * ⛔ No bare `toThrow()` anywhere here: this door does not throw, it REPORTS on
 * a 200, and the whole defect is what the report says.
 */

import { describe, expect, it, vi } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { METADATA_READ_DECORATIONS } from '@objectstack/spec/kernel';
import { SeedSchema } from '@objectstack/spec/data';
import { SeedLoaderService } from '../seed-loader.js';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.workspace';
const SEED = 'project_seed';

/** The seed body a publish stores and the read-back must return. */
const SEED_BODY = {
    object: 'project',
    externalId: 'name',
    mode: 'upsert',
    records: [{ name: 'Apollo', status: 'active' }, { name: 'Gemini', status: 'planned' }],
};

/** The one key the closed `SeedSchema` refuses on a served body. */
const DECORATION = '_diagnostics';

/** The one key it deliberately ACCEPTS on a served body (ADR-0010). */
const PROVENANCE = '_packageId';

// ---------------------------------------------------------------------------
// Engine double — a plain row store. Every write verb opens with the
// PRODUCER's own dispatch predicate (`check:engine-double-contract`), imported
// from `@objectstack/metadata-core` and never from `@objectstack/objectql`
// (that reverse edge is a cycle turbo refuses), so this double cannot accept a
// call the real ObjectQL engine would refuse.
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

function makeEngine() {
    const tables = new Map<string, Row[]>();
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
        async find(table: string, opts?: { where?: Record<string, unknown>, limit?: number }) {
            const rows = tableOf(table).filter((r) => matches(r, opts?.where));
            // The caller's bound, applied AFTER the filter and by PRESENCE
            // (`check:objectql-double-limit`): a double that silently ignores
            // `limit` answers more rows than the real engine would.
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
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

/**
 * Stage a draft seed, promote it with the REAL `publishPackageDrafts` on a real
 * protocol, then drive the route whose fallback reads it back through that same
 * protocol.
 *
 * `SeedLoaderService.prototype.load` is SPIED, not replaced — `callThrough` is
 * the default, so the shipping loader still runs and §3 gets an observation
 * channel onto the exact body the parse handed it.
 */
async function publishThenApply() {
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

    // Rows the publish's OWN self-apply loaded are not what this file measures;
    // the route-level apply below must stand on its own.
    engine.rowsOf('project').length = 0;

    /** The real read-back, recorded. */
    const getMetaItem = vi.fn(async (request: any) => await real.getMetaItem(request));

    const loadSpy = vi.spyOn(SeedLoaderService.prototype, 'load');

    const facade = {
        // ⛔ Deliberately reports NO `seedApplied`: the route-level apply runs
        // only for protocols that do not self-apply, and that branch is the
        // code under test.
        publishPackageDrafts: async () => ({
            success: true,
            outcome: 'published',
            publishedCount: 1,
            failedCount: 0,
            published: [{ type: 'seed', name: SEED, version: 'h' }],
            failed: [],
        }),
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
        auth: { api: { getSession: async () => ({ session: {} }) } },
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
    // Read the recorded calls BEFORE restoring: `mockRestore` resets the mock's
    // state, so a `loadSpy.mock.calls` read after it answers an empty array —
    // which §3 would report as "the loader was never called".
    const loadCalls = loadSpy.mock.calls.slice();
    loadSpy.mockRestore();
    return {
        engine,
        published,
        getMetaItem,
        body,
        seedApplied: body?.data?.seedApplied,
        /** The seed bodies the shipping loader actually received. */
        loadedSeeds: () => (loadCalls[0]?.[0] as any)?.seeds,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the positive control: the round trip runs, and the REAL producer
//      decorates. GREEN before AND after.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15591 · 0 · the shipping protocol really serves a decorated body', () => {
    it('promotes the draft and reads back an envelope carrying our own annotation', async () => {
        const { published, engine, getMetaItem } = await publishThenApply();

        // The publish is the shipping one, and it really promoted the draft.
        expect(published?.publishedCount).toBe(1);
        expect(engine.rowsOf('sys_metadata').some(
            (r: any) => r.type === 'seed' && r.name === SEED && r.state === 'active',
        )).toBe(true);

        // And it SELF-APPLIED — which is exactly why the fallback under test is
        // invisible in the shipping composition and why the facade above has to
        // withhold the field to reach it at all.
        expect(Object.prototype.hasOwnProperty.call(published, 'seedApplied')).toBe(true);

        // The read-back happened, against the real protocol, and the body it
        // served carries BOTH underscore keys — inside `.item`, which is the
        // branch the door's unwrap takes. Without this control, §2 turning
        // green would be indistinguishable from "the decoration never arrived".
        expect(getMetaItem).toHaveBeenCalled();
        const served: any = await getMetaItem.mock.results[0]?.value;
        expect(served?.item?.object).toBe('project');
        expect(served?.item?.records).toHaveLength(2);
        expect(served?.item).toHaveProperty(DECORATION);
        expect(served?.item).toHaveProperty(PROVENANCE, PKG);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — the contract reading that decided the direction, read from `spec`
//      rather than restated. GREEN before AND after: the instrument.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15591 · 1 · the two underscore keys are two populations, and spec says which', () => {
    it('`_diagnostics` is a DECLARED read decoration; `_packageId` deliberately is not', () => {
        expect(METADATA_READ_DECORATIONS).toContain(DECORATION);
        expect(METADATA_READ_DECORATIONS).not.toContain(PROVENANCE);
    });

    it('the closed seed schema refuses the decoration BY NAME and accepts the provenance', () => {
        // The refusal, with the key named: this is the `unrecognized_keys`
        // issue the door minted as a 422 onto a 200 response.
        const decorated: any = (SeedSchema as any).safeParse({ ...SEED_BODY, [DECORATION]: { valid: true } });
        expect(decorated.success).toBe(false);
        const issue = decorated.error.issues.find((i: any) => i.code === 'unrecognized_keys');
        expect(issue?.keys).toEqual([DECORATION]);

        // ⇒ and the control that makes that reading mean something: the OTHER
        // underscore key parses clean, because `SeedSchema` spreads
        // `MetadataProtectionFields` on purpose. A blanket underscore strip
        // would be dropping a key this schema declares.
        expect((SeedSchema as any).safeParse({ ...SEED_BODY, [PROVENANCE]: PKG }).success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — the defect. RED before the fix.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15591 · 2 · the platform can consume its own read-back envelope', () => {
    it('loads the rows instead of refusing the body it just served', async () => {
        const { seedApplied, engine } = await publishThenApply();

        expect(seedApplied?.success).toBe(true);
        expect(seedApplied?.inserted).toBe(2);
        expect(engine.rowsOf('project')).toHaveLength(2);
    });

    it('the 200 carries no refusal of the author\'s seed body', async () => {
        const { seedApplied, body } = await publishThenApply();

        // The pre-fix payload said the author's input failed spec validation.
        // Asserted on the TEXT, not on a vague "it changed": these are the
        // exact fragments `seedRequestValidationError` puts on the wire.
        expect(seedApplied?.error).toBeUndefined();
        expect(seedApplied?.issues).toBeUndefined();
        const wire = JSON.stringify(body) ?? '';
        expect(wire).not.toContain('unrecognized_keys');
        expect(wire).not.toContain('invalid_metadata');
        expect(wire).not.toContain('failed spec validation');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — the bound. The strip is the DECLARED list, not a blanket underscore
//      strip. RED before the fix, and RED under the wrong repair.
// ═══════════════════════════════════════════════════════════════════════════

describe('#15591 · 3 · the strip removes the decoration and keeps the provenance', () => {
    it('hands the loader a body with no `_diagnostics` and its `_packageId` intact', async () => {
        const { loadedSeeds } = await publishThenApply();

        const seeds = loadedSeeds();
        expect(seeds).toHaveLength(1);
        // Removed: our own read-time annotation, which is what the parse refused.
        expect(seeds[0]).not.toHaveProperty(DECORATION);
        // Kept: ADR-0010 envelope state the schema allowlists "precisely so a
        // served document keeps its provenance on re-parse". Reusing the export
        // path's blanket `startsWith('_')` strip would delete this, and that is
        // the reading this assertion exists to refuse.
        expect(seeds[0]).toHaveProperty(PROVENANCE, PKG);
    });
});
