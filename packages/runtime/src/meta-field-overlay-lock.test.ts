// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7743 — the `field` overlay lock, pinned at the LIVE ROUTE.
 *
 * The registry declares `field` with `allowOrgOverride: false`, and a field a
 * code package ships is an artifact. Yet
 * `PUT /api/v1/meta/field/showcase_task.title` answered **200**
 * `state:'active'`, and the row read back with `_diagnostics.valid=true` —
 * measured on a booted showcase, reproduced on `showcase_task.status`.
 *
 * ── Why this file is in `packages/runtime` and not next to the gate ────────
 *
 * This is the whole lesson of the card, and it is a test-PLACEMENT fact rather
 * than an oversight. `packages/objectql/src/overlay-precedence.test.ts` already
 * pins this denial with 27 passing cases — at the PROTOCOL level, calling
 * `saveMetaItem` directly. The reported symptom sailed straight past all 27,
 * because the live `field` route is not in its coverage: the gate is proven
 * where it is exercised and absent where it is used. A 28th assertion written
 * at that same layer would be green and blind in exactly the same way.
 *
 * So every case below drives the REAL `HttpDispatcher.handleMetadata`, the real
 * `ObjectStackProtocolImplementation`, and the real `SysMetadataRepository`,
 * and then reads the stored ROW. Nothing here stubs `saveMetaItem` — a double
 * cannot see this defect, because the defect is which write INTENT the protocol
 * derives before the repository ever sees the call.
 *
 * ── The registry double mirrors the real miss, deliberately ────────────────
 *
 * `SchemaRegistry.getArtifactItem('field', 'showcase_task.title')` returns
 * `undefined` on a real showcase: `field`'s `filePatterns` (`**\/*.field.ts`)
 * match nothing in any app, because fields are authored INSIDE the object. The
 * double below reproduces that faithfully — it serves the `object` artifact and
 * has no `field` collection at all. Making it answer a `field` item would erase
 * the defect in the harness and pin nothing.
 *
 * ── Both topologies, because they refuse at DIFFERENT sites ────────────────
 *
 * The refusal is reached through two doors and this file drives both:
 *
 *   • `environmentId: undefined` — the flagship showcase (a host config with
 *     instantiated plugins boots with no environmentId). `saveMetaItem`'s own
 *     `NOT_OVERRIDABLE` block is behind `environmentId !== undefined` and is
 *     SKIPPED here, so the enforcement site is `SysMetadataRepository`'s
 *     `assertAllowed`, whose `intent` the protocol picks from
 *     `isArtifactBacked`. This is the topology the bug was reported on.
 *   • `environmentId: 'env_1'` — an environment kernel, where `saveMetaItem`'s
 *     own gate fires first.
 *
 * Both answer `403` / `NOT_OVERRIDABLE` (ADR-0112: a refusal is pinned by its
 * code AND its status, never by "it threw").
 *
 * ── Reverse verification, direction predicted BEFORE running ───────────────
 *
 * Taking the fix back out (`git checkout origin/main -- ../metadata-protocol/src/protocol.ts`
 * AND REBUILDING it — `packages/runtime` resolves `@objectstack/metadata-protocol`
 * through its `dist`, and stack traces are source-mapped back to `src`, so a
 * source-only revert measures nothing while looking like it measured something)
 * must turn the refusal cases RED and leave every control GREEN.
 *
 * Predicted 3 red / 7 green; measured 3 red / 7 green.
 *
 *   with the fix              without it (origin/main)
 *   ----------------------    -----------------------------------------------
 *   field override    403     200, row persisted                       → RED
 *   …on `status`      403     200, row persisted                       → RED
 *   …env kernel       403     200, row persisted                       → RED
 *   brand-new field   200     200, unchanged                           → GREEN
 *   field of a runtime-created object                                  → GREEN
 *   object override   403     403, unchanged                           → GREEN
 *   view override     200     200, unchanged                           → GREEN
 *   dashboard         200     200, unchanged                           → GREEN
 *   job               403     403, unchanged                           → GREEN
 *   plural spelling   200     200, unchanged (KNOWN GAP #7894)         → GREEN
 *
 * The greens are NOT slack. Four of them are the negative direction the card
 * demanded: `object` / `view` / `dashboard` / `job` were measured as ALREADY
 * CORRECT in the same QA run, so a fix that tightened any of them is over-reach
 * and must fail here. Two are the legitimate `field` write:
 * `allowRuntimeCreate: true` is real, and a fix that refused every `field` PUT
 * would pass a one-directional test while breaking the feature. The last is a
 * hole this card does NOT close and refuses to hide — see below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpDispatcherResult } from './http-dispatcher.js';

// ---------------------------------------------------------------------------
// Specimens
// ---------------------------------------------------------------------------

/**
 * The packaged object. `_packageId` is what marks it a code artifact — the
 * same stamp `applyProtection` writes on the artifact load path, and the one
 * `getArtifactItem` tests for.
 */
const PACKAGED_OBJECT = {
    name: 'showcase_task',
    label: 'Task',
    fields: {
        title: { type: 'text', label: 'Title', required: true },
        status: { type: 'select', label: 'Status' },
    },
    _packageId: 'com.example.showcase',
};

/** A runtime-authored object — no `_packageId`, so nothing it carries is an artifact. */
const RUNTIME_OBJECT = {
    name: 'runtime_thing',
    label: 'Runtime Thing',
    fields: { note: { type: 'text', label: 'Note' } },
};

const VIEW = {
    name: 'showcase_task.in_progress',
    label: 'In Progress',
    object: 'showcase_task',
    columns: [{ field: 'title', label: 'Title' }],
    _packageId: 'com.example.showcase',
};

const DASHBOARD = {
    name: 'system_overview',
    label: 'System Overview',
    widgets: [],
    _packageId: 'com.example.showcase',
};

const JOB = {
    name: 'showcase_health_sweep',
    label: 'Nightly Health Sweep',
    handler: 'showcase.healthSweep',
    _packageId: 'com.example.showcase',
};

// ---------------------------------------------------------------------------
// Harness — a `sys_metadata`-shaped store the REAL repository writes into.
// ---------------------------------------------------------------------------

interface Row {
    id: string;
    [k: string]: unknown;
}

/**
 * Match one row against a `where` clause, honouring the operators these paths
 * lower.
 *
 * ⚠️ `$or` is CONJOINED with its sibling keys, never early-returned: a
 * `return branches.some(...)` discards every other key in the same clause and
 * silently widens the match (#7846 / #7620). The loop `continue`s instead, so
 * `{ $or: [...], state: 'active' }` requires both.
 */
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
                const isNull = value === null || value === undefined;
                if (isNull !== (op.$null === true)) return false;
                continue;
            }
            if ('$in' in op) {
                if (!(op.$in as unknown[]).includes(value)) return false;
                continue;
            }
            // Any other operator clause is not exercised by these paths.
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
    const tableOf = (name: string) => {
        let t = tables.get(name);
        if (!t) { t = []; tables.set(name, t); }
        return t;
    };

    /**
     * The artifact side of the registry. Keyed by type, and there is
     * deliberately NO `field` collection — that absence IS the defect's
     * precondition, and it is what a real `SchemaRegistry` presents on a real
     * showcase.
     */
    const artifacts = new Map<string, Map<string, unknown>>([
        ['object', new Map<string, unknown>([[PACKAGED_OBJECT.name, PACKAGED_OBJECT]])],
        ['view', new Map<string, unknown>([[VIEW.name, VIEW]])],
        ['dashboard', new Map<string, unknown>([[DASHBOARD.name, DASHBOARD]])],
        ['job', new Map<string, unknown>([[JOB.name, JOB]])],
    ]);
    /** Runtime-registered (unstamped) items — never artifact-backed. */
    const runtimeItems = new Map<string, Map<string, unknown>>([
        ['object', new Map<string, unknown>([[RUNTIME_OBJECT.name, RUNTIME_OBJECT]])],
    ]);

    const engine: any = {
        registry: {
            listItems: (type: string) => [
                ...Array.from(artifacts.get(type)?.values() ?? []),
                ...Array.from(runtimeItems.get(type)?.values() ?? []),
            ],
            getItem: (type: string, name: string) =>
                artifacts.get(type)?.get(name) ?? runtimeItems.get(type)?.get(name),
            // Mirrors the real `SchemaRegistry.getArtifactItem`: only
            // package-stamped items, and nothing at all under `field`.
            getArtifactItem: (type: string, name: string) => artifacts.get(type)?.get(name),
            getObject: (name: string) =>
                artifacts.get('object')?.get(name) ?? runtimeItems.get('object')?.get(name),
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
            registerItem: (type: string, name: string, item: unknown) => {
                let byName = runtimeItems.get(type);
                if (!byName) { byName = new Map(); runtimeItems.set(type, byName); }
                byName.set(name, item);
            },
            registerObject: () => {},
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            return tableOf(table).filter((r) => matches(r, opts?.where));
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            return tableOf(table).find((r) => matches(r, opts?.where)) ?? null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row: Row = { id: (data.id as string) ?? `r_${nextId}`, ...data };
            tableOf(table).push(row);
            return row;
        },
        // [#5619] Both write verbs open with the PRODUCER's own dispatch
        // predicate, so this double cannot accept a call the real ObjectQL
        // engine would refuse (`check:engine-double-contract`). Imported from
        // `@objectstack/metadata-core`, never `@objectstack/objectql` — that
        // reverse edge is a cycle turbo refuses.
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
        metaRows: () => tableOf('sys_metadata'),
    };
    return engine;
}

function makeDispatcher(protocol: unknown, engine: any) {
    const services: Record<string, unknown> = {
        protocol,
        objectql: { registry: engine.registry },
        auth: { api: { getSession: async () => ({ session: {} }) } },
    };
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    return new HttpDispatcher(kernel);
}

/**
 * An authorized request context. The anonymous-deny gate (#3963) is
 * unconditional and, since #7019, the dispatcher's `/meta` PUT also requires
 * `manage_metadata` (ADR-0066 D1). Without it every PUT 403s before the
 * overlay decision is reached — and each case here would pass for the wrong
 * reason, with the same status code the refusal cases assert.
 */
const ctx = (): any => ({
    request: { headers: {} },
    environmentId: 'env_1',
    executionContext: { userId: 'usr_1', systemPermissions: ['manage_metadata'] },
});

/**
 * `environmentId: undefined` is the SHOWCASE topology and the default here:
 * it is where the bug was reported, and the one where `saveMetaItem`'s own
 * `NOT_OVERRIDABLE` block is skipped entirely.
 */
function makeStack(environmentId?: string) {
    const engine = makeEngine();
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId);
    return { engine, protocol, dispatcher: makeDispatcher(protocol, engine) };
}

const metaRow = (engine: any, type: string, name: string) =>
    engine.metaRows().find((r: any) => r.type === type && r.name === name && r.state === 'active');

function responseOf(result: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
    const response = result.response;
    if (!response) throw new Error('the dispatcher handled the route but returned no response');
    return response;
}

/** ADR-0112 — a refusal is identified by its code AND its status, never by "it threw". */
function expectNotOverridable(response: NonNullable<HttpDispatcherResult['response']>) {
    expect(response.status).toBe(403);
    expect(response.body?.error?.code).toBe('NOT_OVERRIDABLE');
}

describe('#7743 — PUT /meta/field/<object>.<field> honours the registry overlay lock', () => {
    beforeEach(() => {
        // The protocol logs degradation lines on these paths; they are not the
        // subject and must not drown the run.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    // ── THE DEFECT — an artifact-backed field may not be overlaid ─────────

    it('refuses an override of a field a code package ships, and persists nothing', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/field/showcase_task.title', ctx(), 'PUT',
            { name: 'title', label: 'Tampered', type: 'text' },
        ));

        expectNotOverridable(res);
        // "Refused, not refused after writing" — the property the card was
        // filed about. A 403 with a row behind it is the same defect wearing a
        // different status code.
        expect(metaRow(engine, 'field', 'showcase_task.title')).toBeUndefined();
    });

    it('refuses it on a second field of the same object (the card reproduced on `status`)', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/field/showcase_task.status', ctx(), 'PUT',
            { name: 'status', label: 'Tampered', type: 'text' },
        ));

        expectNotOverridable(res);
        expect(metaRow(engine, 'field', 'showcase_task.status')).toBeUndefined();
    });

    it('refuses it on an ENVIRONMENT kernel too, where a different gate is the one that fires', async () => {
        // Same verdict, different site: with `environmentId` set, `saveMetaItem`'s
        // own artifact-backed block throws before the repository is reached.
        // Keying authorization off a row-scoping key is what #5086 removed from
        // the tier below; the answer must not depend on topology here either.
        const { engine, dispatcher } = makeStack('env_1');

        const res = responseOf(await dispatcher.handleMetadata(
            '/field/showcase_task.title', ctx(), 'PUT',
            { name: 'title', label: 'Tampered', type: 'text' },
        ));

        expectNotOverridable(res);
        expect(metaRow(engine, 'field', 'showcase_task.title')).toBeUndefined();
    });

    // ── THE FEATURE — `allowRuntimeCreate: true` is real and must survive ──

    it('CONTROL — a brand-new field on a packaged object is still CREATED (allowRuntimeCreate)', async () => {
        // The registry declares two orthogonal tiers and this card closes only
        // the overlay one. A fix that refused every `field` PUT would pass all
        // four cases above and silently retire runtime field authoring.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/field/showcase_task.zz_new_probe', ctx(), 'PUT',
            { name: 'zz_new_probe', label: 'Probe', type: 'text' },
        ));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'field', 'showcase_task.zz_new_probe')).toBeDefined();
    });

    it('CONTROL — a field of a RUNTIME-created object is not artifact-backed, so it stays writable', async () => {
        // The boundary the predicate must draw: the object exists, but no
        // package ships it, so neither does it ship the field. Resolving the
        // parent through the artifact-only lookup is what keeps this true — a
        // plain-key registry entry must not be able to manufacture an artifact.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/field/runtime_thing.note', ctx(), 'PUT',
            { name: 'note', label: 'Renamed', type: 'text' },
        ));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'field', 'runtime_thing.note')).toBeDefined();
    });

    // ── THE NEGATIVE DIRECTION — the four types measured as ALREADY CORRECT ─
    //
    // The QA run found `object` / `view` / `dashboard` / `job` behaving
    // correctly in the same session that found the `field` hole. Tightening any
    // of them is over-reach, and these cases are where that shows up.

    it('CONTROL — `object` is still refused, exactly as before', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            `/object/${PACKAGED_OBJECT.name}`, ctx(), 'PUT',
            { ...PACKAGED_OBJECT, label: 'Tampered Object' },
        ));

        expectNotOverridable(res);
        expect(metaRow(engine, 'object', PACKAGED_OBJECT.name)).toBeUndefined();
    });

    it('CONTROL — `view` is still ACCEPTED (allowOrgOverride: true)', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            `/view/${VIEW.name}`, ctx(), 'PUT', { ...VIEW, label: 'Tampered' },
        ));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'view', VIEW.name)).toBeDefined();
    });

    it('CONTROL — `dashboard` is still ACCEPTED (allowOrgOverride: true)', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            `/dashboard/${DASHBOARD.name}`, ctx(), 'PUT', { ...DASHBOARD, label: 'Tampered' },
        ));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'dashboard', DASHBOARD.name)).toBeDefined();
    });

    it('CONTROL — `job` is still refused as code-only, with its own sentence', async () => {
        // `job` is the OTHER tier (`allowRuntimeCreate: false` AND
        // `allowOrgOverride: false`), refused by #5086's block before this
        // card's predicate is consulted at all. Same code, different reason —
        // pinned so a change to one tier cannot quietly move the other.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            `/job/${JOB.name}`, ctx(), 'PUT', { ...JOB, label: 'Tampered' },
        ));

        expectNotOverridable(res);
        expect(res.body?.error?.message).toMatch(/code-only/);
        expect(metaRow(engine, 'job', JOB.name)).toBeUndefined();
    });

    // ── A HOLE THIS CARD DOES NOT CLOSE, pinned so it cannot go quiet ─────

    it('KNOWN GAP #7894 — the PLURAL url spelling still walks around this lock', async () => {
        // ⚠️ This case asserts a DEFECT, deliberately. It was written expecting
        // 403, measured 200, and confirmed against the live showcase: with the
        // fix in place, `/meta/field/showcase_task.title` is refused while
        // `/meta/fields/showcase_task.title` is accepted and persists a row.
        //
        // The cause is one layer up and is NOT `field`-specific.
        // `canonicalMetaType` (#4432) folds plural→singular through
        // `PLURAL_TO_SINGULAR`, which is the MANIFEST COLLECTION map — and it
        // has no `fields` key (nor `seeds`, `external_catalogs`,
        // `translations`). An unmapped spelling is therefore read as an
        // unregistered PLUGIN type, which every gate treats as permissive by
        // construction: `assertAllowed` returns early on
        // `!STATIC_REGISTRY_TYPES.has('fields')`, and `orgScopedWriteRefusal`
        // says so in as many words. Each of those is correct for a type that
        // really is plugin-registered; `'fields'` just is not one.
        //
        // ⛔ The one-word fix — teaching `isNestedArtifactField` to accept
        // `'fields'` — is the WRONG shape and was rejected: it is a
        // spelling-tolerant lookup below the boundary (the exact pattern
        // #4432's own doc comment rejects) and would still mint the row under a
        // second namespace, `type='fields'`. The remedy belongs at the boundary
        // map and spans four types, so it is #7894's, not this card's.
        //
        // When #7894 lands this test goes RED. That is its job: flip it to
        // `expectNotOverridable(res)` and delete the row assertion.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/fields/showcase_task.title', ctx(), 'PUT',
            { name: 'title', label: 'Tampered', type: 'text' },
        ));

        expect(res.status).toBe(200);
        // The mechanism, not just the status: the row lands under the PLURAL
        // type key — a second namespace for the same item.
        expect(metaRow(engine, 'fields', 'showcase_task.title')).toBeDefined();
        // …and the singular namespace stays clean, which is why the singular
        // route's own refusal above is not weakened by this gap.
        expect(metaRow(engine, 'field', 'showcase_task.title')).toBeUndefined();
    });
});
