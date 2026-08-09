// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7018 — the runtime threads the session's organization into a metadata WRITE
 * only for types the registry declares `allowOrgOverride: true`.
 *
 * This is the runtime half of the #6190 ruling (2026-08-09, Option A). Before
 * it, both dispatcher write sites threaded `resolveActiveOrganizationId`
 * unconditionally, and `SysMetadataRepository.put` stamps `organization_id`
 * for EVERY type — so any session with an active organization minted an
 * org-scoped `sys_metadata` row even for types that have no per-org read
 * channel at all. Cold boot (`loadMetaFromDb`) hydrates
 * `organization_id IS NULL` only, so those rows are **phantom writes**: live
 * for the life of the process, silently absent after the next restart.
 *
 * ── Why these tests exist even though the runtime suite was already green ──
 *
 * It was green because nothing in it ever populated
 * `session.activeOrganizationId`: with no active org the two branches are
 * indistinguishable. Every case below therefore drives a session that HAS one,
 * through the real `HttpDispatcher.resolveActiveOrganizationId` (a real
 * auth-service `getSession` shape), the real `handleMetadataRequest` /
 * `handlePackagesRequest`, the real `ObjectStackProtocolImplementation`, and
 * the real `SysMetadataRepository` — and then reads the stored ROW. Anything
 * that stubs `saveMetaItem` cannot see this defect, because the defect is
 * which partition the row lands in.
 *
 * ── Reverse verification, direction predicted BEFORE running ───────────────
 *
 * Ordinary red, with a deliberately green control. Restoring the unconditional
 * threading (drop `organizationIdForMetaWrite` at both call sites and pass the
 * active org straight through) must turn the env-wide pins RED — the `flow`
 * row, the `object` row and the ADR-0045 `app` flip all come back
 * `organization_id: 'org_alpha'`, and the post-flip visibility read goes back
 * to reporting the app as unpublished. The `view` case must stay GREEN, and it
 * is the reason it is here: a "fix" that simply stopped threading the org
 * anywhere would pass every red case and fail there, silently retiring
 * ADR-0005 per-org overlays. Predicted 5 red / 3 green.
 *
 * Measured (recorded in the PR body): 5 red / 3 green, and the reds fail in the
 * shape that names the defect —
 *
 *   AssertionError: expected 'org_alpha' to be null
 *
 * — the phantom row of #6190, reproduced on demand.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { HttpDispatcher } from './http-dispatcher.js';
import { declaresOrgOverride, organizationIdForMetaWrite } from './meta-write-org-scope.js';

const ACTIVE_ORG = 'org_alpha';

// ---------------------------------------------------------------------------
// Harness — a `sys_metadata`-shaped store the real repository writes into.
// ---------------------------------------------------------------------------

interface Row {
    id: string;
    [k: string]: unknown;
}

/** Match one row against a `where` clause, honouring the operators these paths lower. */
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
    const registryItems = new Map<string, Map<string, unknown>>();
    const engine: any = {
        registry: {
            listItems: (type: string) => Array.from(registryItems.get(type)?.values() ?? []),
            getItem: (type: string, name: string) => registryItems.get(type)?.get(name),
            // Nothing here is code-shipped: every specimen below is a
            // runtime-authored item, which is the tier the tenant scenario in
            // #6190 actually uses (`allowRuntimeCreate: true`).
            getArtifactItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            registerItem: (type: string, name: string, item: unknown) => {
                let byName = registryItems.get(type);
                if (!byName) { byName = new Map(); registryItems.set(type, byName); }
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
        async update(table: string, data: Record<string, unknown>, opts?: { where?: Record<string, unknown> }) {
            const target = tableOf(table).find((r) => matches(r, opts?.where));
            if (target) Object.assign(target, data);
            return target ?? null;
        },
        async delete(table: string, opts?: { where?: Record<string, unknown> }) {
            const rows = tableOf(table);
            const keep = rows.filter((r) => !matches(r, opts?.where));
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

/**
 * A dispatcher whose auth service answers a session with an ACTIVE
 * ORGANIZATION — the population the whole defect keys off, and the one the
 * pre-existing runtime dispatcher tests never produced.
 */
function makeDispatcher(protocol: unknown, engine: any, activeOrganizationId: string | undefined) {
    const services: Record<string, unknown> = {
        protocol,
        objectql: { registry: engine.registry },
        auth: {
            api: {
                getSession: async () => (
                    activeOrganizationId ? { session: { activeOrganizationId } } : { session: {} }
                ),
            },
        },
    };
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    return new HttpDispatcher(kernel);
}

/** An authenticated request context — the anonymous-deny gate (#3963) is unconditional. */
const ctx = (): any => ({
    request: { headers: {} },
    environmentId: 'env_1',
    executionContext: { userId: 'usr_1', systemPermissions: [] },
});

function makeStack(activeOrganizationId: string | undefined) {
    const engine = makeEngine();
    // `environmentId` set: an environment kernel, the topology ADR-0005's
    // overlay gate actually runs on.
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1');
    return { engine, protocol, dispatcher: makeDispatcher(protocol, engine, activeOrganizationId) };
}

const metaRow = (engine: any, type: string, name: string) =>
    engine.metaRows().find((r: any) => r.type === type && r.name === name && r.state === 'active');

// ---------------------------------------------------------------------------
// Specimens — schema-VALID bodies. A minimal one 422s before the scoping
// decision is ever reached, which would pass these tests for the wrong reason.
// ---------------------------------------------------------------------------

/** `allowOrgOverride: false`, `allowRuntimeCreate: true` — the #6190 specimen. */
const FLOW = {
    name: 'escalate_overdue',
    label: 'Escalate overdue tasks',
    type: 'record_change',
    status: 'active',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: 'task', triggerType: 'record-after-update' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** `allowOrgOverride: true` — the control. Its org scoping must NOT change. */
const VIEW = {
    name: 'overdue_grid',
    label: 'Overdue',
    object: 'task',
    columns: [{ field: 'name', label: 'Name' }],
};

/** `allowOrgOverride: false` — the ADR-0045 publish-visibility specimen. */
const APP = { name: 'crm', label: 'CRM' };

describe('#7018 — the registry decides whether a metadata write carries the session org', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // The protocol logs degradation lines on these paths; they are not the
        // subject and must not drown the run. `error` is spied rather than
        // silenced-and-forgotten — the ADR-0045 flip reports its own failure
        // there (#4754), and the last case reads it back.
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    // ── the predicate itself ──────────────────────────────────────────────

    it('is derived from the registry, not a parallel allowlist (PD #8)', () => {
        // Deliberately recomputed from `DEFAULT_METADATA_TYPE_REGISTRY` rather
        // than spelled out: a hand-written list here would agree with a
        // hand-written list there and pin nothing. Flipping any registry entry
        // moves both sides of this assertion together.
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            expect(declaresOrgOverride(entry.type)).toBe(entry.allowOrgOverride);
        }
        // Plural URL spellings are judged identically (`/meta/views/...`).
        expect(declaresOrgOverride('views')).toBe(declaresOrgOverride('view'));
        expect(declaresOrgOverride('flows')).toBe(declaresOrgOverride('flow'));
        // A runtime-registered type with no registry entry has no per-org read
        // channel either, so it is env-wide too.
        expect(declaresOrgOverride('theme')).toBe(false);
        // No active org in, no org out — for every type.
        expect(organizationIdForMetaWrite('view', undefined)).toBeUndefined();
    });

    // ── PUT /meta/:type/:name — the dispatcher's metadata write ───────────

    it('a NON-overridable type lands env-wide even though the session has an active org', async () => {
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);

        const res = await dispatcher.handleMetadata(`/flow/${FLOW.name}`, ctx(), 'PUT', FLOW);

        expect(res.response.status).toBe(200);
        const row = metaRow(engine, 'flow', FLOW.name);
        expect(row).toBeDefined();
        // THE assertion. Before #7018 this was `'org_alpha'` — a row
        // `loadMetaFromDb` walks past and the `kernel:ready` flow binder
        // (`getMetaItems({type:'flow'})`, no org) never sees, so the automation
        // fires until the next restart and then silently stops.
        expect(row!.organization_id).toBeNull();
    });

    it('the same is true for `object`, whose org-scoped rows 404 every record after a restart', async () => {
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);
        const OBJECT = {
            name: 'ticket',
            label: 'Ticket',
            fields: { subject: { type: 'text', label: 'Subject' } },
        };

        const res = await dispatcher.handleMetadata(`/object/${OBJECT.name}`, ctx(), 'PUT', OBJECT);

        expect(res.response.status).toBe(200);
        expect(metaRow(engine, 'object', OBJECT.name)!.organization_id).toBeNull();
    });

    it('the receipt an org session gets back is the one a no-org session gets', async () => {
        // "Otherwise the write lands env-wide — the same row a no-active-org
        // session already produces today" (the #6190 ruling). Same row AND same
        // receipt: the caller cannot tell the two sessions apart, which is what
        // makes this a scoping fix rather than a new refusal. The row assertion
        // above is the load-bearing one; this pins that nothing else moved.
        const withOrg = makeStack(ACTIVE_ORG);
        const withoutOrg = makeStack(undefined);

        const a = await withOrg.dispatcher.handleMetadata(`/flow/${FLOW.name}`, ctx(), 'PUT', FLOW);
        const b = await withoutOrg.dispatcher.handleMetadata(`/flow/${FLOW.name}`, ctx(), 'PUT', FLOW);

        expect(a.response.status).toBe(200);
        expect(a.response.body.data).toEqual(b.response.body.data);
        expect(a.response.body.data).toMatchObject({ success: true, state: 'active' });
    });

    it('CONTROL — an `allowOrgOverride: true` type keeps its org scoping exactly as before', async () => {
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);

        const res = await dispatcher.handleMetadata(`/view/${VIEW.name}`, ctx(), 'PUT', VIEW);

        expect(res.response.status).toBe(200);
        // ADR-0005's per-org overlay is the point of the flag and must survive
        // this change untouched — `getMetaItem`/`getMetaItems` load it on demand.
        expect(metaRow(engine, 'view', VIEW.name)!.organization_id).toBe(ACTIVE_ORG);
    });

    it('CONTROL — the plural URL spelling of an overridable type is scoped the same way', async () => {
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);

        const res = await dispatcher.handleMetadata(`/views/${VIEW.name}`, ctx(), 'PUT', VIEW);

        expect(res.response.status).toBe(200);
        expect(metaRow(engine, 'view', VIEW.name)!.organization_id).toBe(ACTIVE_ORG);
    });

    // ── POST /packages/:id/publish-drafts — the ADR-0045 visibility flip ──

    it('the ADR-0045 publish flip writes env-wide, and the app is visible afterwards', async () => {
        const { engine, protocol, dispatcher } = makeStack(ACTIVE_ORG);

        // The starting state a materialized (additive) build leaves behind: the
        // app persisted env-wide, gated `_unpublished: true`, awaiting the flip.
        await protocol.saveMetaItem({
            type: 'app',
            name: APP.name,
            item: { ...APP, _unpublished: true },
            packageId: 'crm_pkg',
        });
        expect(metaRow(engine, 'app', APP.name)!.organization_id).toBeNull();

        // `publishPackageDrafts` is stubbed to "nothing to promote" — the
        // materialized regime has no drafts left, which is exactly the branch
        // ADR-0045 §3's flip exists to serve. Everything the flip itself
        // touches (`getMetaItems`, `saveMetaItem`) stays REAL.
        protocol.publishPackageDrafts = async () => ({
            success: true, publishedCount: 0, failedCount: 0, published: [], failed: [],
        });

        const res = await dispatcher.handlePackages('/crm_pkg/publish-drafts', 'POST', {}, {}, ctx());

        expect(res.response.status).toBe(200);
        expect(res.response.body.data.unhiddenApps).toEqual([APP.name]);
        expect(res.response.body.data.unhideError).toBeUndefined();

        // One row, still env-wide — not a second, org-scoped row shadowing it.
        const appRows = engine.metaRows().filter((r: any) => r.type === 'app' && r.state === 'active');
        expect(appRows).toHaveLength(1);
        expect(appRows[0].organization_id).toBeNull();

        // And the flip is real where it counts: the env-wide read — the one
        // cold boot and the App Switcher do — now sees a published app. An
        // org-scoped flip left THIS read reporting `_unpublished: true`, which
        // is why the old flip reverted on restart.
        const listed = await protocol.getMetaItems({ type: 'app' });
        const served: any = (listed.items as any[]).find((i: any) => i?.name === APP.name);
        expect(served).toBeDefined();
        expect(served._unpublished).toBe(false);
    });

    it('the flip reports NO degradation — it is a clean write, not a warn-and-continue', async () => {
        // Every case above mutes `console.warn`, so a regression that degraded
        // into "flip failed, carry on" would otherwise read as a clean pass.
        // The route answers 200 either way (#4754), so the log line is the only
        // place that failure is visible.
        const { protocol, dispatcher } = makeStack(ACTIVE_ORG);
        await protocol.saveMetaItem({
            type: 'app', name: APP.name, item: { ...APP, _unpublished: true }, packageId: 'crm_pkg',
        });
        protocol.publishPackageDrafts = async () => ({
            success: true, publishedCount: 0, failedCount: 0, published: [], failed: [],
        });
        error.mockClear();

        const res = await dispatcher.handlePackages('/crm_pkg/publish-drafts', 'POST', {}, {}, ctx());

        expect(res.response.body.data.unhiddenApps).toEqual([APP.name]);
        const flipComplaints = error.mock.calls
            .map((c) => String(c[0]))
            .filter((line) => line.includes('visibility flip'));
        expect(flipComplaints).toEqual([]);
    });
});
