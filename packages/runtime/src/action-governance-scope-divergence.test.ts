// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14423 (a) — the AGREEMENT, where this file used to pin the divergence.
 *
 * The two sites the card names:
 *  - the AUDIT, `runActionGovernanceInventory` (`packages/objectql/src/
 *    action-governance.ts`), whose metadata-plane sources are now
 *    `loadStandaloneActionsKeyed = () => meta.loadManyKeyed('action')` and the
 *    by-name rung `lookupMetadataAction` — both wired in
 *    `packages/objectql/src/plugin.ts` off `ctx.getService('metadata')`;
 *  - the ROUTER, `resolveRouteActionDeclaration` (`./action-execution.ts`),
 *    whose third rung is `meta.loadDiagnosed('action', name)` — resolved per
 *    request off `deps.resolveService(requestContext, 'metadata', envId)`.
 *
 * PR #14421 closed the registry rung. This file measured the remaining one and
 * reproduced it four ways; the measurement is now the fix's pin, case for
 * case, with the same harness. **C1 and C5 are unchanged controls** — they
 * were green before and must stay green, because a "fix" that simply stopped
 * the audit from speaking would satisfy every flipped case and nothing else.
 *
 * ## What changed, per mechanism
 *
 *  - **C2 / C6 — IDENTITY.** The audit enumerates the plane KEYED, so a body
 *    that does not name itself is a declaration under the key its store holds
 *    it by (#14205). It was dropped before, in both shipped loaders.
 *  - **C3 — AVAILABILITY.** The audit also asks the plane BY NAME, the
 *    router's own third rung, so a loader fault that a plural read swallows no
 *    longer converts a served handler into an accusation. Its counterpart in
 *    the manager is `MetadataManager.listNames` gaining `loadMany`'s
 *    per-loader fault parity — asserted here too, because that is where the
 *    asymmetry lived.
 *  - **C4 — a BOUNDARY, not a defect, and pinned as one.** See its case.
 *
 * ---------------------------------------------------------------------------
 * What is real and what is doubled
 * ---------------------------------------------------------------------------
 * Real: `runActionGovernanceInventory` and `collectEngineActionDeclarations`
 * (from `@objectstack/objectql`), `resolveRouteActionDeclaration` (this
 * package), `MetadataManager` (`@objectstack/metadata`), `DatabaseLoader`
 * (same), `ObjectKernel` + `PluginLoader` scoping (`@objectstack/core`).
 *
 * Doubled: the row store under `DatabaseLoader` (a `sys_metadata`-shaped
 * engine, the same double shape `meta-overlay-read-your-writes.test.ts`
 * uses), and `deps.resolveService`. The latter is a transcription of
 * `HttpDispatcher.resolveService`'s first branch, quoted here so a reviewer
 * can check it against `packages/runtime/src/http-dispatcher.ts` (the method
 * is private, so a test cannot call it):
 *
 *     if (scopeId && typeof this.defaultKernel.getServiceAsync === 'function') {
 *         const svc = await this.defaultKernel.getServiceAsync(name, scopeId);
 *         if (svc != null) return svc;
 *     }
 *
 * The audit's lookup is NOT transcribed: `ObjectKernel.getService(name)`
 * delegates straight to the `context.getService` that `plugin.ts` calls, so
 * C4 exercises the real accessor on both sides.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ObjectKernel, ServiceLifecycle } from '@objectstack/core';
import { MetadataManager, DatabaseLoader } from '@objectstack/metadata';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { NodeMetadataManager } from '@objectstack/metadata/node';
import type { MetadataLoader } from '@objectstack/metadata';
import { runActionGovernanceInventory, collectEngineActionDeclarations } from '@objectstack/objectql';
import { resolveRouteActionDeclaration, type ActionExecutionDeps } from './action-execution.js';

/** The name under test, and the handler key it is registered on. */
const ACTION = 'promote_lead';
const OBJECT_KEY = 'global'; // object-less action — `GLOBAL_ACTION_OBJECT_KEY`

/**
 * A `sys_metadata`-shaped READ-ONLY engine over a fixed row array.
 *
 * Read-only on purpose: `DatabaseLoader`'s read paths call `find` / `findOne`
 * / `count` and nothing else (`ensureSchema` returns immediately on the
 * `engine` branch), so a double that also declared `update` / `delete` would
 * be declaring dispatch surface this fixture never exercises.
 *
 * The WHERE matcher REFUSES what it does not implement rather than reading a
 * combinator as a field name — the conforming shape `check:where-matcher`
 * exists to keep: `{ $or: [...] }` must not silently match nothing.
 */
function readEngine(rows: Array<Record<string, unknown>>) {
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`readEngine: unsupported WHERE combinator '${k}'`);
            if (v !== null && typeof v === 'object') throw new Error(`readEngine: unsupported WHERE operator on '${k}'`);
            return r[k] === v;
        });
    return {
        async find(table: string, q: any) {
            const hits = rows.filter((r) => matches(r, q?.where ?? {}));
            // The caller's bound, applied AFTER the filter and by PRESENCE —
            // `check:objectql-double-limit`'s conforming shape. A double that
            // ignores `limit` answers more rows than the real engine would,
            // which is how a paging defect stays green in a suite.
            void table;
            return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        async findOne(table: string, q: any) {
            // `check:engine-double-contract`: a fake whose findOne is looser
            // than `ObjectQL.findOne` is how a dead route ships with a green
            // suite. Route the predicate through the shared assertion.
            assertEngineFindOnePredicate(table, q);
            return rows.find((r) => matches(r, q?.where ?? {})) ?? null;
        },
        async count(_table: string, q: any) {
            return rows.filter((r) => matches(r, q?.where ?? {})).length;
        },
    };
}

/**
 * The same engine with its LIST read down — a separate double rather than a
 * flag on {@link readEngine}, deliberately. An injected `failFind` hook makes
 * the base double undrivable by `check:objectql-double-limit`'s control probe
 * (the probe substitutes a stub for the hook, the double calls it, and the
 * candidate files as UNJUDGED debt instead of being graded). Overriding `find`
 * on the base leaves `findOne` — the verb `check:engine-double-contract` pins
 * — reading the base's implementation, which is what that gate's third-spelling
 * note requires of an override.
 */
function listDownEngine(rows: Array<Record<string, unknown>>) {
    return {
        ...readEngine(rows),
        async find() {
            throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
        },
    };
}

/** A `sys_metadata` row: identity in the `name` COLUMN, body in `metadata`. */
function row(name: string, body: Record<string, unknown>) {
    return {
        id: `md_${name}`,
        name,
        type: 'action',
        namespace: 'default',
        scope: 'platform',
        state: 'active',
        version: 1,
        metadata: JSON.stringify(body),
    };
}

/** A real `MetadataManager` over a real `DatabaseLoader` over `rows`. */
function planeOver(rows: Array<Record<string, unknown>>, engine: unknown = readEngine(rows)) {
    const mgr = new MetadataManager({});
    mgr.registerLoader(new DatabaseLoader({
        engine: engine as any,
        trackHistory: false,
        cache: { enabled: false },
    } as any) as unknown as MetadataLoader);
    return mgr;
}

/** Silent logger + the warnings the audit emitted, for reading back. */
function recorder() {
    const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    return {
        warnings,
        logger: {
            warn: (message: string, meta?: Record<string, unknown>) => { warnings.push({ message, meta }); },
            debug: () => {},
        },
    };
}

/** Did the audit accuse `ACTION` of being a handler with no declaration? */
function auditAccused(warnings: Array<{ message: string; meta?: Record<string, unknown> }>): boolean {
    return warnings.some((w) =>
        w.message.includes('registered handlers with NO declaration') &&
        ((w.meta?.handlers as string[]) ?? []).includes(`${OBJECT_KEY}:${ACTION}`));
}

/**
 * Run the audit exactly as `ObjectQLPlugin.runGovernanceInventory` does, with
 * ONE handler registered and NO object-embedded declaration and NO registry
 * item — so the metadata plane is the only source that can clear it.
 *
 * [#14423] Transcribed from the plugin's wiring after the fix, including its
 * fallbacks: the keyed plural read when the plane offers one, the unkeyed one
 * otherwise, and the by-name rung preferring `loadDiagnosed` over `load`
 * exactly as `resolveRouteActionDeclaration` does. Keeping the branches rather
 * than hard-wiring the happy path is deliberate — C4 hands this `undefined`,
 * and a helper that assumed a plane would throw where the plugin degrades.
 */
async function runAudit(meta: any) {
    const { warnings, logger } = recorder();
    const loadMany = meta?.loadMany;
    const loadManyKeyed = meta?.loadManyKeyed;
    const loadDiagnosed = meta?.loadDiagnosed;
    const load = meta?.load;
    await runActionGovernanceInventory({
        registered: [{ objectName: OBJECT_KEY, actionName: ACTION }],
        objects: [],
        loadStandaloneActions: meta && typeof loadMany === 'function'
            ? () => loadMany.call(meta, 'action')
            : undefined,
        loadStandaloneActionsKeyed: meta && typeof loadManyKeyed === 'function'
            ? () => loadManyKeyed.call(meta, 'action')
            : undefined,
        lookupRegistryAction: () => undefined, // rung 2 holds nothing — #14421's rung is not the one under test
        lookupMetadataAction: meta && typeof loadDiagnosed === 'function'
            ? async (name: string) => (await loadDiagnosed.call(meta, 'action', name))?.data
            : (meta && typeof load === 'function' ? (name: string) => load.call(meta, 'action', name) : undefined),
        logger,
    });
    return { accused: auditAccused(warnings), warnings };
}

/** Run the router's declaration resolution against `meta`, by name. */
async function runRouter(meta: any, envId?: string) {
    const deps = {
        // Transcription of `HttpDispatcher.resolveService`'s scoped branch — see header.
        resolveService: async (_ctx: any, name: string, scopeId?: string) =>
            (name === 'metadata' ? (typeof meta === 'function' ? await meta(scopeId) : meta) : undefined),
        getObjectQL: async () => null,
    } as unknown as ActionExecutionDeps;
    return resolveRouteActionDeclaration(deps, {} as any, {
        ql: { registry: { getItem: () => undefined } }, // rung 1+2 hold nothing
        objectName: OBJECT_KEY,
        actionName: ACTION,
        envId,
    });
}

describe('#14423 (a) — the audit and the router now answer from one identity and one source set', () => {
    /**
     * C1 — CONTROL. One plane, one scope, a row whose `name` COLUMN and whose
     * body `name` agree. If the harness cannot show AGREEMENT here, nothing it
     * says about disagreement is worth reading.
     */
    it('C1 control — same plane, name column == body.name: both reads answer, audit and router AGREE', async () => {
        const meta = planeOver([row(ACTION, { name: ACTION, type: 'script', target: ACTION })]);

        const enumerated = await meta.loadMany<any>('action');
        const byName = await meta.loadDiagnosed<any>('action', ACTION);

        expect(enumerated.map((a: any) => a?.name)).toEqual([ACTION]);
        expect(byName.data?.name).toBe(ACTION);

        const audit = await runAudit(meta);
        const router = await runRouter(meta);

        expect(router.action?.name).toBe(ACTION);   // router resolves it
        expect(audit.accused).toBe(false);          // and the audit agrees it is declared
    });

    /**
     * C2 — the row-key / body-name shape (#14205's `MetadataKeyedItem`
     * defect, measured there for `view`). `DatabaseLoader.load` filters on the
     * `name` COLUMN and returns `rowToData(row)` — the BODY, with the column
     * deliberately not folded in. `loadMany` returns bodies only, so the name
     * is served by `load` and is NOT ENUMERABLE from `loadMany`'s answer.
     *
     * That much is unchanged and still asserted: `loadMany`'s published shape
     * does not move. What changed is which read the audit is defined on.
     */
    it('C2 — row keyed by the `name` COLUMN, body carries none: the KEYED read names it, and audit and router AGREE', async () => {
        const meta = planeOver([row(ACTION, { type: 'script', target: ACTION })]); // body has NO `name`

        const enumerated = await meta.loadMany<any>('action');
        const byName = await meta.loadDiagnosed<any>('action', ACTION);

        expect(byName.data).toBeTruthy();                       // load SERVES the name
        expect(enumerated).toHaveLength(1);                     // loadMany returns the body
        expect(enumerated.map((a: any) => a?.name)).toEqual([undefined]); // ...unnamed, still

        // BEFORE: keyed by `action.name`, a nameless row is not a declaration.
        const unkeyed = await collectEngineActionDeclarations([], () => meta.loadMany<any>('action'));
        expect(unkeyed).toHaveLength(0);

        // AFTER: the plane KNOWS the name, and the audit now asks for it.
        expect(await meta.listNames('action')).toContain(ACTION);
        expect((await meta.loadManyKeyed<any>('action')).map((e) => e.name)).toEqual([ACTION]);
        const keyed = await collectEngineActionDeclarations(
            [], undefined, () => meta.loadManyKeyed<any>('action'));
        expect(keyed).toEqual([{ action: { type: 'script', target: ACTION }, objectName: OBJECT_KEY, storeKey: ACTION }]);

        const audit = await runAudit(meta);
        const router = await runRouter(meta);

        expect(router.action).toBeTruthy();  // router: the declaration EXISTS
        expect(audit.accused).toBe(false);   // audit: and so does the audit, now
    });

    /**
     * C3 — the plural read fails while the by-name read answers. This is the
     * card's literal question on ONE service instance: `MetadataManager.
     * loadMany` catches a loader's plural failure, logs it via
     * `reportLoaderReadFailure` and CONTINUES ("every list served from now on
     * is a PARTIAL set presented as a complete one" — its own words), while
     * `loadDiagnosed` walks `loader.load` and is served.
     *
     * The plural read is STILL short — that is the seam's documented posture
     * and no keying can change it. What closes C3 is the audit reading the
     * same by-name rung the router does, so the two cannot disagree about a
     * name one of them was served.
     *
     * The manager-side half of the same defect is asserted here as well:
     * `listNames` used to THROW out of this configuration while `loadMany`
     * swallowed it — one loader fault, two different facts, decided only by
     * which method the caller reached for.
     */
    it('C3 — plural read throws, by-name read answers: the audit asks by name too, and AGREES', async () => {
        const rows = [row(ACTION, { name: ACTION, type: 'script', target: ACTION })];
        const meta = planeOver(rows, listDownEngine(rows));

        const enumerated = await meta.loadMany<any>('action');
        const byName = await meta.loadDiagnosed<any>('action', ACTION);

        expect(enumerated).toEqual([]);          // enumeration: the name is ABSENT
        expect(byName.data?.name).toBe(ACTION);  // by name: SERVED
        expect(byName.degraded).toBe(false);     // and not even reported degraded

        // The keyed enumeration is short for the same reason — keying is not a
        // cure for an unreachable loader, and does not claim to be.
        expect(await meta.loadManyKeyed<any>('action')).toEqual([]);
        // [#14423 item 1] ...and the sibling enumeration no longer THROWS where
        // its two siblings merely came back short.
        await expect(meta.listNames('action')).resolves.toEqual([]);

        const audit = await runAudit(meta);
        const router = await runRouter(meta);

        expect(router.action?.name).toBe(ACTION);
        expect(audit.accused).toBe(false);
    });

    /**
     * C4 — a BOUNDARY, not a defect, and pinned as one.
     *
     * `metadata` is registered `SCOPED`, so `PluginLoader.getService` mints one
     * instance per `scopeId`. The audit's accessor
     * (`ObjectKernel.getService` → `context.getService`) reads only the static
     * `services` map and `PluginLoader.getServiceInstance`, and the latter
     * reads `serviceInstances` — never `scopedServices`. So the audit's lookup
     * cannot see a scoped instance at all, and `plugin.ts` swallows the throw
     * into "no metadata plane at all". The router's lookup, given the
     * request's `envId`, gets the env's own plane.
     *
     * ## Why this stays accused, and why that is CORRECT
     *
     * The divergence here is upstream of every read this card touched: the
     * throw happens at `ctx.getService('metadata')`, before `loadManyKeyed`,
     * `loadDiagnosed` or anything else could run. Keying an enumeration
     * cannot help a caller that never obtained the object to enumerate, and
     * neither can a by-name rung. A boot-time audit runs OUTSIDE any request
     * scope by construction; reaching a request-scoped instance from there is
     * a different change with its own product decision, tracked on its own
     * card. ⛔ Do NOT "fix" this by weakening what the audit claims.
     *
     * And it is not reachable today: no shipped composition registers
     * `metadata` as SCOPED — `packages/metadata/src/plugin.ts` registers a
     * static instance — which is what C5 exercises directly.
     *
     * So the assertions below pin the BOUNDARY: the accusation, AND the fact
     * that its cause is the service lookup rather than any disagreement
     * between two reads of one plane. Pinning the cause is the point — an
     * accusation asserted alone would keep passing if the reads regressed.
     */
    it('C4 — BOUNDARY: env-scoped `metadata` is unreachable from a boot-time audit, before any read runs', async () => {
        const kernel = new ObjectKernel({});
        const perEnv = new Map<string, MetadataManager>();
        kernel.registerServiceFactory(
            'metadata',
            (_ctx: any, scopeId?: string) => {
                const key = scopeId ?? '<unscoped>';
                if (!perEnv.has(key)) {
                    // Only `env_a` has the declaration; every other scope is empty.
                    perEnv.set(key, planeOver(key === 'env_a'
                        ? [row(ACTION, { name: ACTION, type: 'script', target: ACTION })]
                        : []));
                }
                return perEnv.get(key)!;
            },
            ServiceLifecycle.SCOPED,
        );

        // The audit's lookup — `ctx.getService('metadata')` in plugin.ts, inside its
        // try/catch. Typed with the slot's CONTRACT, not `any`: the audit reads
        // `meta.loadMany` off whatever this returns, and erasing the result is
        // exactly the shape `check:slot-lookup` refuses (#4251).
        let auditMeta: IMetadataService | undefined;
        let auditLookupError: string | undefined;
        try { auditMeta = kernel.getService<IMetadataService>('metadata'); }
        catch (e: unknown) { auditLookupError = e instanceof Error ? e.message : String(e); }

        // The router's lookup — the dispatcher's scoped branch, with the request's envId.
        const routerMeta = await kernel.getServiceAsync<MetadataManager>('metadata', 'env_a');

        // The CAUSE, pinned: the lookup itself fails, so no read method is
        // ever reached. This is what makes C4 a boundary rather than a fifth
        // read asymmetry.
        expect(auditLookupError).toMatch(/async/i);     // `Service 'metadata' is async - use await`
        expect(auditMeta).toBeUndefined();              // the audit gets NO metadata plane at all
        expect(routerMeta).toBeInstanceOf(MetadataManager);
        expect((await routerMeta.loadDiagnosed<any>('action', ACTION)).data?.name).toBe(ACTION);
        // Every read this card added is healthy on the plane the audit cannot
        // hold — so the divergence is provably NOT in the reads.
        expect((await routerMeta.loadManyKeyed<any>('action')).map((e) => e.name)).toEqual([ACTION]);

        const audit = await runAudit(auditMeta);
        const router = await runRouter(async (scopeId?: string) =>
            scopeId ? kernel.getServiceAsync('metadata', scopeId) : undefined, 'env_a');

        expect(router.action?.name).toBe(ACTION);  // the router dispatches it
        expect(audit.accused).toBe(true);          // and the boot-time audit cannot see the scope
    });

    /**
     * C5 — the honest negative. With `metadata` a SINGLETON and one scope,
     * every configuration above collapses: both reads hit the same instance,
     * the same loader set and the same `baseFilter`, so nothing diverges.
     * `DatabaseLoader.baseFilter` applies `organization_id` identically to
     * `load` and `loadMany`, and `environmentId` is accepted-but-ignored
     * (ADR-0008 §0) — there is no env dimension INSIDE a plane to diverge on.
     */
    it('C5 — singleton `metadata`, one scope: both lookups return the SAME instance, no divergence', async () => {
        const kernel = new ObjectKernel({});
        const plane = planeOver([row(ACTION, { name: ACTION, type: 'script', target: ACTION })]);
        kernel.registerServiceFactory('metadata', () => plane, ServiceLifecycle.SINGLETON);

        const routerMeta = await kernel.getServiceAsync<MetadataManager>('metadata', 'env_a');
        const auditMeta = kernel.getService<MetadataManager>('metadata');

        expect(routerMeta).toBe(plane);
        expect(auditMeta).toBe(plane);            // the scopeId is ignored — one instance

        const audit = await runAudit(auditMeta);
        const router = await runRouter(auditMeta, 'env_a');

        expect(router.action?.name).toBe(ACTION);
        expect(audit.accused).toBe(false);        // both sources agree
    });

    /**
     * C6 — the SHIPPED single-plane composition, no failure injection and no
     * scoping: a real `NodeMetadataManager` over a real `FilesystemLoader`,
     * which is what the in-process `os dev` boot runs.
     *
     * `FilesystemLoader.load` resolves a name by COMPOSING a path
     * (`findFile` -> `ROOT/action/<name>.json`), so identity is path-derived;
     * `loadMany` globs the directory and returns BODIES. A flat file whose body
     * carries no `name` is therefore served by `load` and comes back unnamed
     * from `loadMany` — and keyed by `body.name` the audit never saw it.
     *
     * This is C2's mechanism in the OTHER shipped loader, which is what makes it
     * a rule rather than a `DatabaseLoader` quirk: #14205's finding (identity is
     * the key the store holds an item under, not `body.name`) reaches both.
     * It is also the case that reproduces on the shipped `os dev` composition
     * — real `NodeMetadataManager`, real `FilesystemLoader`, no injection and
     * no scoping — which is why the fix is judged here and not only on C2.
     */
    it('C6 — real filesystem plane, body carries no `name`: the KEYED read names it, and audit and router AGREE', async () => {
        const root = await mkdtemp(join(tmpdir(), 'os-14423-'));
        try {
            await mkdir(join(root, 'action'), { recursive: true });
            // Identity lives in the FILE NAME; the body deliberately has none.
            await writeFile(join(root, 'action', `${ACTION}.json`),
                JSON.stringify({ type: 'script', target: ACTION }), 'utf8');

            const meta = new NodeMetadataManager({ rootDir: root } as any);

            const enumerated = await meta.loadMany<any>('action');
            const byName = await meta.loadDiagnosed<any>('action', ACTION);

            expect(byName.data).toBeTruthy();                                // load SERVES the name
            expect(byName.degraded).toBe(false);                             // and reports nothing wrong
            expect(enumerated).toHaveLength(1);
            expect(enumerated.map((a: any) => a?.name)).toEqual([undefined]); // ...unnamed
            expect(await meta.listNames('action')).toContain(ACTION);        // the KEYED read has it

            // BEFORE / AFTER on one plane, same as C2.
            expect(await collectEngineActionDeclarations([], () => meta.loadMany<any>('action'))).toHaveLength(0);
            expect(await collectEngineActionDeclarations(
                [], undefined, () => meta.loadManyKeyed<any>('action'))).toEqual([
                { action: { type: 'script', target: ACTION }, objectName: OBJECT_KEY, storeKey: ACTION },
            ]);

            const audit = await runAudit(meta);
            const router = await runRouter(meta);

            expect(router.action).toBeTruthy();  // router: the declaration EXISTS
            expect(audit.accused).toBe(false);   // audit: and so does the audit, now
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
