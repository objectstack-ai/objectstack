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
 *   brand-new field   403     200, row persisted (#7893)               → RED
 *   field of a runtime-created object — same, 403 (#7893)              → RED
 *   object override   403     403, unchanged                           → GREEN
 *   view override     200     200, unchanged                           → GREEN
 *   dashboard         200     200, unchanged                           → GREEN
 *   job               403     403, unchanged                           → GREEN
 *   plural spelling   403     200, row under type='fields' (#7894)     → RED
 *   object route creates AND composes (#7893 control)                  → GREEN
 *
 * Two rows INVERTED after #7743, and each inversion is this file's anti-vacuity
 * proof rather than a rewrite of history:
 *
 *   • the plural spelling, when #7894 landed. It used to assert the defect
 *     (200, plus a row under the plural key) and carried instructions to flip
 *     it; because the old case had really measured that 200, the new 403 cannot
 *     be passing by never reaching the boundary.
 *   • the two brand-new-field rows, when #7893 landed. They used to assert
 *     `200` under the banner "THE FEATURE — `allowRuntimeCreate: true` is real
 *     and must survive", and the maintainer ruled on 2026-08-12 that the
 *     feature was never real: the write persisted a standalone row that no read
 *     path ever composed into its parent object. Same argument applies — those
 *     cases demonstrably reached the write door, because they measured its 200.
 *     See the #7893 block for the full record.
 *
 * The greens are NOT slack. Four of them are the negative direction #7743
 * demanded: `object` / `view` / `dashboard` / `job` were measured as ALREADY
 * CORRECT in the same QA run, so a fix that tightened any of them is over-reach
 * and must fail here. The last is #7893's positive control — the OBJECT route
 * still creates a field AND reads it back, which is what makes the retirement a
 * redirect rather than a lost capability.
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
    // [#8310] The runtime object door requires an authored OWD — without it
    // the 422 lint door answers first and the NOT_OVERRIDABLE control below
    // would be refused for the wrong reason. [#4716] Same discipline for the
    // five gating object rules that crossed that door: the select declares
    // `options` so `validateFunctionalCompleteness` stays silent and the 403
    // keeps being the sentence under test.
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title', required: true },
        status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
    },
    _packageId: 'com.example.showcase',
};

/** A runtime-authored object — no `_packageId`, so nothing it carries is an artifact. */
const RUNTIME_OBJECT = {
    name: 'runtime_thing',
    label: 'Runtime Thing',
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: { note: { type: 'text', label: 'Note' } },
};

const VIEW = {
    name: 'showcase_task.in_progress',
    label: 'In Progress',
    object: 'showcase_task',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
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
            // [#7893] Signature mirrors the PRODUCER's call, not a convenient
            // shape: the real `SchemaRegistry.registerItem` takes
            // `(type, item, keyStrategy, ownerId?)` — the ITEM second — and
            // `applyObjectRegistryMutation` calls it as
            // `registerItem(type, item, 'name')`.
            //
            // ⚠️ This double previously declared `(type, name, item)`. Nothing
            // failed: the call still "succeeded", storing the item object as the
            // KEY and the string `'name'` as the VALUE, so the seeded entry was
            // never replaced and every read served the stale body. A write-through
            // that silently no-ops is exactly what an object-route control must be
            // able to see, so the arity is pinned to the producer's here.
            registerItem: (type: string, item: any, keyStrategy?: string, _ownerId?: string) => {
                const key = keyStrategy === 'object'
                    ? (item?.object as string)
                    : (item?.name as string);
                if (!key) return;
                let byName = runtimeItems.get(type);
                if (!byName) { byName = new Map(); runtimeItems.set(type, byName); }
                byName.set(key, item);
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

    // ── #7893 — THE FEATURE THAT WASN'T: the create tier is RETIRED ────────
    //
    // This block REPLACES two cases pinned under the banner "THE FEATURE —
    // `allowRuntimeCreate: true` is real and must survive". Those pins were
    // doing exactly their job: #7743 wrote them so that a later fix could not
    // quietly retire runtime field authoring, and they predicted in their own
    // comment that "a fix that refused every `field` PUT" would be the way this
    // file went wrong. That prediction was correct about the MECHANISM and
    // wrong about the PREMISE they shared — that there was a create door here
    // worth protecting.
    //
    // There was not. Measured end-to-end through this same harness (#7893):
    // `PUT /field/showcase_task.zz_probe` answered 200 `state=active` and
    // persisted a row, and `GET /object/showcase_task` then listed
    // `fields: ['title','status']` — the field ABSENT, forever. `field` is the
    // one declared type with no standalone existence: the write minted a
    // separate row keyed `('field','<object>.<name>')` and nothing composes
    // fragment rows into their parent. The door opened onto nothing.
    //
    // Maintainer ruled REMOVE on 2026-08-12 (ADR-0049 enforce-or-remove), so
    // the retirement is deliberate and on the record here, the way #5488
    // retired `api`'s door in the change that flipped it.
    //
    // ⚠️ Adding a field at runtime is NOT lost — it moved to the route that
    // actually composes. `object` keeps `allowRuntimeCreate: true`, so the
    // remedy in the refusal body (`PUT /meta/object/:object` with the new field
    // in `fields`) is a live capability, pinned by the CONTROL below.

    it('#7893 — a brand-new field is REFUSED as code-only, naming the object route', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/field/showcase_task.zz_new_probe', ctx(), 'PUT',
            { name: 'zz_new_probe', label: 'Probe', type: 'text' },
        ));

        // ADR-0112 — code AND status, never "it threw". `NOT_CREATABLE` rather
        // than `NOT_OVERRIDABLE`: no package ships `zz_new_probe`, so this is a
        // CREATE, and it is the create tier this card closed.
        expect(res.status).toBe(403);
        expect(res.body?.error?.code).toBe('NOT_CREATABLE');
        // The prescription is the whole point of the refusal: a 403 that does
        // not say where to go leaves the author exactly as stuck as the 200 did.
        expect(res.body?.error?.message).toMatch(/code-only/);
        expect(res.body?.error?.message).toContain('PUT /api/v1/meta/object/:object');
        // ⚠️ It must NOT read `field`'s own `filePatterns` back — `**/*.field.ts`
        // matches nothing in any app, so prescribing it would name a route that
        // has never worked.
        expect(res.body?.error?.message).not.toContain('*.field.ts');
        // Nothing persisted: refused BEFORE the row is minted, so no new inert
        // row can be created from today on.
        expect(metaRow(engine, 'field', 'showcase_task.zz_new_probe')).toBeUndefined();
    });

    it('#7893 — a field of a RUNTIME-created object is refused too: the tier is the type, not the parent', async () => {
        // #7743 kept this one writable because the parent is not artifact-backed,
        // so the write was a CREATE rather than an overlay. That reasoning was
        // about which TIER applies; the create tier itself is now closed, so the
        // answer flips here as well. Pinned separately because it is the case
        // that would silently survive if someone gated on the parent's
        // provenance instead of on the type's registry entry.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/field/runtime_thing.note', ctx(), 'PUT',
            { name: 'note', label: 'Renamed', type: 'text' },
        ));

        expect(res.status).toBe(403);
        expect(res.body?.error?.code).toBe('NOT_CREATABLE');
        expect(metaRow(engine, 'field', 'runtime_thing.note')).toBeUndefined();
    });

    it('#7893 POSITIVE CONTROL — the OBJECT route still creates, and still composes', async () => {
        // The capability the retirement redirects to must be live, or the
        // refusal's prescription is itself false compliance. `object` carries
        // the IDENTICAL flag pair `field` used to (`supportsOverlay: false,
        // allowRuntimeCreate: true`) — which is also what falsifies the card's
        // stated root cause, that the read skip came from `supportsOverlay`.
        // Same flags, opposite outcome ⇒ the flag was never the cause.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/object/runtime_thing', ctx(), 'PUT',
            { ...RUNTIME_OBJECT, fields: { ...RUNTIME_OBJECT.fields, extra: { type: 'text', label: 'Extra' } } },
        ));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'object', 'runtime_thing')).toBeDefined();

        // …and the field is READ BACK, which is the half `field` never had.
        const read = responseOf(await dispatcher.handleMetadata('/object/runtime_thing', ctx(), 'GET'));
        const fields = Object.keys((read.body as any)?.data?.item?.fields ?? {});
        expect(fields, 'the object route composes what the field route never did').toContain('extra');
        // ANTI-VACUITY — the declared field is present in the same read, so an
        // empty/dead read cannot be what makes the assertion above pass. This
        // arm caught a false pass during #7893's investigation, where the body
        // was read at `body.item` (undefined) instead of `body.data.item`.
        expect(fields).toContain('note');
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

    // ── #7894 — THE HOLE ABOVE, NOW CLOSED ────────────────────────────────
    //
    // This block replaces a case that deliberately asserted the DEFECT
    // (`expect(res.status).toBe(200)` plus a row under `type='fields'`) and
    // instructed its successor to "flip it to `expectNotOverridable(res)` and
    // delete the row assertion". That inversion is this file's anti-vacuity
    // proof and it costs nothing to state: the harness demonstrably REACHED
    // this boundary before the fix, because it measured the 200 here. A fresh
    // test asserting 403 could pass by never arriving; this one cannot.

    it('#7894 — the PLURAL url spelling folds onto the same lock', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/fields/showcase_task.title', ctx(), 'PUT',
            { name: 'title', label: 'Tampered', type: 'text' },
        ));

        // Measurement 1. Note it converges on the SINGULAR route's answer
        // rather than producing a refusal that names the spelling `fields`:
        // folding is what closes this, so `/meta/fields/…` is now the same
        // request as `/meta/field/…` and earns the same verdict. Plural REST
        // paths are the documented legitimate spelling (`/meta/actions` folds
        // and must keep folding), so refusing this one specifically would give
        // `field` a URL contract unlike every other type's.
        expectNotOverridable(res);
        // Measurement 3, the mechanism rather than the status: NO second
        // namespace is minted. This is the assertion the old case inverted.
        expect(metaRow(engine, 'fields', 'showcase_task.title')).toBeUndefined();
        expect(metaRow(engine, 'field', 'showcase_task.title')).toBeUndefined();
    });

    it('#7894 x #7893 — the plural spelling folds onto the CREATE lock too, not just the overlay one', async () => {
        // ⚠️ The case above folds a plural OVERRIDE (`showcase_task.title` is
        // a field the package ships), so it is pinned on #7743's overlay tier
        // and answers NOT_OVERRIDABLE. It therefore says nothing about the
        // tier THIS card closed, and measurably so: reverting
        // `allowRuntimeCreate` to `true` leaves the case above GREEN while the
        // two create cases go red. Two independent gates reachable through the
        // same URL fold, and only one of them had a plural pin.
        //
        // This is that missing half — plural + brand-new name, so the fold
        // lands on the CREATE lock. Without it, a future change to
        // PLURAL_TO_SINGULAR could reopen `PUT /meta/fields/<o>.<n>` as a
        // create door while every existing pin here stayed green.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/fields/showcase_task.zz_plural_probe', ctx(), 'PUT',
            { name: 'zz_plural_probe', label: 'Probe', type: 'text' },
        ));

        // ADR-0112 — code AND status. NOT_CREATABLE, not NOT_OVERRIDABLE:
        // nothing ships `zz_plural_probe`, so the fold arrives at the create
        // tier and earns the retirement's own refusal, prescription included.
        expect(res.status).toBe(403);
        expect(res.body?.error?.code).toBe('NOT_CREATABLE');
        expect(res.body?.error?.message).toContain('PUT /api/v1/meta/object/:object');
        // Neither namespace is minted — the plural spelling cannot be used to
        // route around the retirement into a second inert row.
        expect(metaRow(engine, 'fields', 'showcase_task.zz_plural_probe')).toBeUndefined();
        expect(metaRow(engine, 'field', 'showcase_task.zz_plural_probe')).toBeUndefined();
    });

    it('#7894 — the other three unmapped types answer as their singular does', async () => {
        // `seed` / `external_catalog` / `translation` were unmapped alongside
        // `field`. The assertion is deliberately body-AGNOSTIC: what the card is
        // about is that the plural URL stops being a SEPARATE door, so the test
        // is "both spellings reach the same verdict, and only the singular
        // namespace can ever be minted" — not a hardcoded status per type.
        //
        // Worth recording, because it is the fold made visible: `seeds` with
        // this body answers 422, because it is now judged by the real
        // `SeedSchema` (which requires `object`/`records`). Before the fix it
        // answered 200 — an unmapped spelling has no schema to be judged by, so
        // it sailed past validation as well as past authorization.
        for (const [plural, singular] of [
            ['seeds', 'seed'],
            ['translations', 'translation'],
            ['external_catalogs', 'external_catalog'],
        ] as const) {
            const body = { name: 'thing_x', label: 'X' };

            const viaPlural = makeStack();
            const pluralRes = responseOf(await viaPlural.dispatcher.handleMetadata(
                `/${plural}/thing_x`, ctx(), 'PUT', body,
            ));

            const viaSingular = makeStack();
            const singularRes = responseOf(await viaSingular.dispatcher.handleMetadata(
                `/${singular}/thing_x`, ctx(), 'PUT', body,
            ));

            expect(pluralRes.status, `${plural} must answer exactly as ${singular} does`)
                .toBe(singularRes.status);
            // …and whatever the verdict, no second namespace is ever minted.
            expect(metaRow(viaPlural.engine, plural, 'thing_x'), `${plural} must not mint a namespace`)
                .toBeUndefined();
        }
    });

    // ── POSITIVE CONTROL — plugin registration must still work ────────────
    //
    // Every gate #7894 names is CORRECT behaviour for a genuinely
    // plugin-registered runtime type. A refusal that also caught those would be
    // a worse defect than the bypass it closed, so this is pinned, not assumed.

    it('#7894 POSITIVE CONTROL — a plugin-registered runtime type is still permitted', async () => {
        const { engine, dispatcher } = makeStack();

        // `theme` has no `DEFAULT_METADATA_TYPE_REGISTRY` entry at all.
        const singular = responseOf(await dispatcher.handleMetadata(
            '/theme/midnight', ctx(), 'PUT', { name: 'midnight', label: 'Midnight' },
        ));
        expect(singular.status).toBe(200);
        expect(metaRow(engine, 'theme', 'midnight')).toBeDefined();

        // …and via its plural spelling, which the URL map carries from the
        // manifest map's limb — still one namespace, the singular one.
        const plural = responseOf(await dispatcher.handleMetadata(
            '/themes/twilight', ctx(), 'PUT', { name: 'twilight', label: 'Twilight' },
        ));
        expect(plural.status).toBe(200);
        expect(metaRow(engine, 'theme', 'twilight')).toBeDefined();
        expect(metaRow(engine, 'themes', 'twilight')).toBeUndefined();
    });

    it('#7894 POSITIVE CONTROL — the #7894 refusal still cannot reach a never-heard-of kind (#8421 CHANGED the boundary)', async () => {
        // The strongest form: a name in NO map and NO registry. This control's
        // OWN claim is unchanged and still holds by construction — #7894's
        // refusal only triggers when a spelling's singular is a type the
        // platform itself DECLARES, and `my_plugin_kind` is a misspelling of
        // nothing, so `metaUrlSpellingRefusal` cannot fire on it whatever else
        // the boundary does.
        //
        // ⚠️ [#8421, maintainer ruling 2026-08-15] What DID change is the
        // boundary's verdict, and this case says so rather than leaving a
        // reader to infer it. The name used to be MINTED, because "not a
        // declared type" was read as "a kind some plugin declared". The ruling
        // — verbatim, untranslated: 暂时不考虑让插件申明新的元数据类型 — retired
        // that reading, so `saveMetaItem` now consults a SECOND verdict
        // (`unrecognisedMetaTypeRefusal`) and refuses a name in neither half of
        // the static contract. `暂时` is a current posture, not a permanent
        // closure: see `getMetaTypes()`'s synthesis comment in
        // `@objectstack/metadata-protocol` for the full record.
        //
        // The discriminating control for that narrowing is the case directly
        // ABOVE, which must stay green: `theme` has no registry entry either
        // and is still minted, because it IS in the static contract. If a
        // change ever breaks both, the narrowing stopped being narrow.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/my_plugin_kind/widget_a', ctx(), 'PUT', { name: 'widget_a', label: 'Widget A' },
        ));

        // ADR-0112 — code AND status, never "it threw".
        expect(res.status).toBe(400);
        expect(res.body?.error?.code).toBe('INVALID_REQUEST');
        // It is the not-a-type-at-all verdict, NOT #7894's misspelling verdict:
        // it names the type and offers no replacement spelling, because there
        // is no declared type this could have been reaching for.
        expect(res.body?.error?.message).toContain("'my_plugin_kind' is not a metadata type");
        expect(res.body?.error?.message).not.toContain('did you mean');
        // …and the namespace this card is named for is never minted.
        expect(metaRow(engine, 'my_plugin_kind', 'widget_a')).toBeUndefined();
    });

    // ── The refusal limb — an unrecognised spelling of a DECLARED type ────

    it('#7894 — an unrecognised plural of a declared type is refused, not forwarded', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/capabilitys/some_cap', ctx(), 'PUT', { name: 'some_cap', label: 'Some Cap' },
        ));

        // ADR-0112 — code AND status, never "it threw".
        expect(res.status).toBe(400);
        expect(res.body?.error?.code).toBe('INVALID_REQUEST');
        // It names the offending spelling AND the canonical one.
        expect(res.body?.error?.message).toContain('capabilitys');
        expect(res.body?.error?.message).toContain('capability');
        // Never answers 200, so no namespace is minted under the typo.
        expect(metaRow(engine, 'capabilitys', 'some_cap')).toBeUndefined();
        expect(metaRow(engine, 'capability', 'some_cap')).toBeUndefined();
    });
});
