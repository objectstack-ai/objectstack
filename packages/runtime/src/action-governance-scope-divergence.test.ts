// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14423 (a) — MEASUREMENT, not a fix. Can `meta.loadMany('action')` omit a
 * name that `meta.load` / `loadDiagnosed` serves?
 *
 * The two sites the card names:
 *  - the AUDIT, `runActionGovernanceInventory` (`packages/objectql/src/
 *    action-governance.ts`), whose metadata-plane source is
 *    `loadStandaloneActions = () => meta.loadMany('action')` — wired in
 *    `packages/objectql/src/plugin.ts` off `ctx.getService('metadata')`;
 *  - the ROUTER, `resolveRouteActionDeclaration` (`./action-execution.ts`),
 *    whose third rung is `meta.loadDiagnosed('action', name)` — resolved per
 *    request off `deps.resolveService(requestContext, 'metadata', envId)`.
 *
 * PR #14421 closed the registry rung. This file measures the remaining one.
 * ⛔ It pins a CURRENT DIVERGENCE; it does not assert a fixed behaviour, and
 * nothing here is a behaviour change. Should (a) ever be fixed, these
 * expectations are the ones that must be REWRITTEN, not defended.
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
function readEngine(rows: Array<Record<string, unknown>>, opts: { failFind?: () => Error } = {}) {
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`readEngine: unsupported WHERE combinator '${k}'`);
            if (v !== null && typeof v === 'object') throw new Error(`readEngine: unsupported WHERE operator on '${k}'`);
            return r[k] === v;
        });
    return {
        async find(_table: string, q: any) {
            if (opts.failFind) throw opts.failFind();
            return rows.filter((r) => matches(r, q?.where ?? {}));
        },
        async findOne(_table: string, q: any) {
            return rows.find((r) => matches(r, q?.where ?? {})) ?? null;
        },
        async count(_table: string, q: any) {
            return rows.filter((r) => matches(r, q?.where ?? {})).length;
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
function planeOver(rows: Array<Record<string, unknown>>, opts: { failFind?: () => Error } = {}) {
    const mgr = new MetadataManager({});
    mgr.registerLoader(new DatabaseLoader({
        engine: readEngine(rows, opts) as any,
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
 */
async function runAudit(meta: any) {
    const { warnings, logger } = recorder();
    const loadMany = meta?.loadMany;
    const loadStandaloneActions = meta && typeof loadMany === 'function'
        ? () => loadMany.call(meta, 'action')
        : undefined;
    await runActionGovernanceInventory({
        registered: [{ objectName: OBJECT_KEY, actionName: ACTION }],
        objects: [],
        loadStandaloneActions,
        lookupRegistryAction: () => undefined, // rung 2 holds nothing — #14421's rung is not the one under test
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

describe('#14423 (a) — can `loadMany` omit a name `load` serves?', () => {
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
     * deliberately not folded in. `loadMany` returns bodies only. So the name
     * is served by `load` and is NOT ENUMERABLE from `loadMany`'s answer.
     */
    it('C2 — row keyed by the `name` COLUMN, body carries none: `load` serves it, the audit cannot name it', async () => {
        const meta = planeOver([row(ACTION, { type: 'script', target: ACTION })]); // body has NO `name`

        const enumerated = await meta.loadMany<any>('action');
        const byName = await meta.loadDiagnosed<any>('action', ACTION);

        expect(byName.data).toBeTruthy();                       // load SERVES the name
        expect(enumerated).toHaveLength(1);                     // loadMany returns the body
        expect(enumerated.map((a: any) => a?.name)).toEqual([undefined]); // ...unnamed

        // The audit keys declarations by `action.name` and drops a nameless one.
        const declarations = await collectEngineActionDeclarations([], () => meta.loadMany<any>('action'));
        expect(declarations).toHaveLength(0);

        // The plane KNOWS the name — the keyed enumeration serves it. It is
        // `loadMany`, the UNKEYED plural read the audit was wired to, that
        // cannot carry it. (⛔ Naming the remedy is not shipping it: rewiring
        // `loadStandaloneActions` is a behaviour change and out of scope here.)
        expect(await meta.listNames('action')).toContain(ACTION);

        const audit = await runAudit(meta);
        const router = await runRouter(meta);

        expect(router.action).toBeTruthy();  // router: the declaration EXISTS
        expect(audit.accused).toBe(true);    // audit: "registered handler with NO declaration"
    });

    /**
     * C3 — the plural read fails while the by-name read answers. This is the
     * card's literal question on ONE service instance: `MetadataManager.
     * loadMany` catches a loader's plural failure, logs it via
     * `reportLoaderReadFailure` and CONTINUES ("every list served from now on
     * is a PARTIAL set presented as a complete one" — its own words), while
     * `loadDiagnosed` walks `loader.load` and is served.
     */
    it('C3 — plural read throws, by-name read answers: `loadMany` omits the name `load` serves', async () => {
        const rows = [row(ACTION, { name: ACTION, type: 'script', target: ACTION })];
        const meta = planeOver(rows, {
            failFind: () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }),
        });

        const enumerated = await meta.loadMany<any>('action');
        const byName = await meta.loadDiagnosed<any>('action', ACTION);

        expect(enumerated).toEqual([]);          // enumeration: the name is ABSENT
        expect(byName.data?.name).toBe(ACTION);  // by name: SERVED
        expect(byName.degraded).toBe(false);     // and not even reported degraded

        const audit = await runAudit(meta);
        const router = await runRouter(meta);

        expect(router.action?.name).toBe(ACTION);
        expect(audit.accused).toBe(true);
    });

    /**
     * C4 — the shape the card names: an env-scoped kernel where enumeration
     * and by-name reads answer from DIFFERENT SCOPES.
     *
     * `metadata` is registered `SCOPED`, so `PluginLoader.getService` mints one
     * instance per `scopeId`. The audit's accessor
     * (`ObjectKernel.getService` → `context.getService`) reads only the static
     * `services` map and `PluginLoader.getServiceInstance`, and the latter
     * reads `serviceInstances` — never `scopedServices`. So the audit's lookup
     * cannot see a scoped instance at all, and `plugin.ts` swallows the throw
     * into `loadStandaloneActions === undefined`. The router's lookup, given
     * the request's `envId`, gets the env's own plane.
     */
    it('C4 — env-scoped `metadata`: the audit\'s lookup and the router\'s answer from different scopes', async () => {
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

        // The audit's lookup — `ctx.getService('metadata')` in plugin.ts, inside its try/catch.
        let auditMeta: any;
        let auditLookupError: string | undefined;
        try { auditMeta = kernel.getService('metadata'); }
        catch (e: any) { auditLookupError = e?.message ?? String(e); }

        // The router's lookup — the dispatcher's scoped branch, with the request's envId.
        const routerMeta = await kernel.getServiceAsync<MetadataManager>('metadata', 'env_a');

        expect(auditLookupError).toBeTruthy();          // the audit gets NO metadata plane at all
        expect(auditMeta).toBeUndefined();
        expect(routerMeta).toBeInstanceOf(MetadataManager);
        expect((await routerMeta.loadDiagnosed<any>('action', ACTION)).data?.name).toBe(ACTION);

        const audit = await runAudit(auditMeta);
        const router = await runRouter(async (scopeId?: string) =>
            scopeId ? kernel.getServiceAsync('metadata', scopeId) : undefined, 'env_a');

        expect(router.action?.name).toBe(ACTION);  // the router dispatches it
        expect(audit.accused).toBe(true);          // the audit calls it undeclared
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
     * from `loadMany` — and `collectEngineActionDeclarations` requires
     * `typeof action.name === 'string'`, so the audit never sees it.
     *
     * This is C2's mechanism in the OTHER shipped loader, which is what makes it
     * a rule rather than a `DatabaseLoader` quirk: #14205's finding (identity is
     * the key the store holds an item under, not `body.name`) reaches both.
     */
    it('C6 — real filesystem plane, body carries no `name`: `load` serves it, `loadMany` returns it unnamed, the audit cannot name it', async () => {
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

            const declarations = await collectEngineActionDeclarations([], () => meta.loadMany<any>('action'));
            expect(declarations).toHaveLength(0);

            const audit = await runAudit(meta);
            const router = await runRouter(meta);

            expect(router.action).toBeTruthy();  // router: the declaration EXISTS
            expect(audit.accused).toBe(true);    // audit: "registered handler with NO declaration"
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
