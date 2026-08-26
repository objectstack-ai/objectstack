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
 * Ordinary red, with deliberately green controls. Taking the fix back out
 * (`git checkout origin/main -- src/domains/meta.ts src/domains/packages.ts`,
 * restoring the unconditional threading) must turn the env-wide pins RED and
 * leave the `view` controls GREEN — the latter is the reason they are here: a
 * "fix" that simply stopped threading the org anywhere would pass every red
 * case and fail there, silently retiring ADR-0005 per-org overlays.
 *
 * Predicted 4 red / 4 green; measured 4 red / 4 green, against the real stack
 * (re-measured 2026-08-09 on the merged #7043 base — same 4/4, same shapes):
 *
 *   with the fix          without it (origin/main)
 *   ------------------    ---------------------------------------------------
 *   flow    org = null    org = "org_alpha"                            → RED
 *   object  org = null    org = "org_alpha"                            → RED
 *   receipt  identical    "(org=org_alpha, …)" vs "(env-wide, …)"      → RED
 *   app     1 row, null   TWO rows: env-wide `_unpublished:true` PLUS
 *                         org-scoped `_unpublished:false`, and the
 *                         env-wide list still answers `_unpublished:
 *                         true` — the flip that reverts on restart    → RED
 *   view    org = "org_alpha"  unchanged                             → GREEN
 *   views   org = "org_alpha"  unchanged                             → GREEN
 *   predicate (registry-derived)  unchanged                          → GREEN
 *   flip logs no failure          unchanged                          → GREEN
 *
 * The last green is NOT slack, and it is why the count is 4/4 rather than the
 * 5/3 this file first predicted: that case asserts an ABSENCE of a degradation
 * line, and the unfixed code satisfies it too — its flip succeeds, it just
 * succeeds into the wrong partition. It guards the opposite regression (a
 * future change that degrades the flip into warn-and-continue, which this route
 * answers 200 through), so it is kept and its greenness stated rather than
 * dressed up as a red.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    // [#8805] The predicate moved here from `../meta-write-org-scope.js` so the
    // REST `/meta` write doors share it. This suite still drives the DISPATCHER
    // through the real stack — that is why it stays in this package.
    declaresOrgOverride,
    organizationIdForMetaWrite, assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
// [#10503] The URL spelling contract itself — the map storage folds through,
// and the fold the transport was missing. Imported so the sweep below is
// quantified over the CONTRACT rather than over a hand-copied specimen list
// (Prime Directive #8): a future spelling limb arrives inside the quantifier.
import { META_URL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/shared';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpDispatcherResult } from './http-dispatcher.js';

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
            // `getMetaItems` filters every listed item through the disabled-
            // package gate and, for apps, merges nav contributions (ADR-0029
            // D7) — the same stubs every metadata-protocol harness carries.
            // No package is disabled and nothing contributes nav here.
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
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
            assertEngineFindOnePredicate(table, opts);
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

/**
 * A dispatcher whose auth service answers a session with an ACTIVE
 * ORGANIZATION — the population the whole defect keys off, and the one the
 * pre-existing runtime dispatcher tests never produced.
 */
function makeDispatcher(
    protocol: unknown,
    engine: any,
    activeOrganizationId: string | undefined,
    // [#10503] The `metadata` CORE-SERVICE slot, absent by default. The
    // `/published` route consults the protocol's layered overlay first and
    // only then falls back to THIS slot — the code/package store. Registering
    // it unconditionally would change which branch every #7018 case above
    // takes, so it is opt-in and every case that does not ask for it sees the
    // dispatcher exactly as before.
    metadataService?: unknown,
) {
    const services: Record<string, unknown> = {
        protocol,
        objectql: { registry: engine.registry },
        ...(metadataService ? { metadata: metadataService } : {}),
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

/**
 * An authenticated request context — the anonymous-deny gate (#3963) is
 * unconditional, and since #7019 the dispatcher's `/meta` PUT also requires
 * the `manage_metadata` capability (ADR-0066 D1). These tests are about which
 * PARTITION an authorized write lands in, so the caller is authorized: without
 * the capability every PUT 403s before the scoping decision is ever reached,
 * and each case would pass for the wrong reason.
 *
 * Both gates are satisfied HERE, explicitly, rather than inherited from
 * whatever another suite happens to have registered — that is what makes this
 * file order- and shard-independent, which is how the 403 reached CI at all:
 * the branch was cut before #7027 merged, so the gate did not exist locally.
 */
const ctx = (): any => ({
    request: { headers: {} },
    environmentId: 'env_1',
    executionContext: { userId: 'usr_1', systemPermissions: ['manage_metadata'] },
});

function makeStack(activeOrganizationId: string | undefined, metadataService?: unknown) {
    const engine = makeEngine();
    // `environmentId` set: an environment kernel, the topology ADR-0005's
    // overlay gate actually runs on.
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1');
    return {
        engine,
        protocol,
        dispatcher: makeDispatcher(protocol, engine, activeOrganizationId, metadataService),
    };
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
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'name', label: 'Name' }],
};

/** `allowOrgOverride: false` — the ADR-0045 publish-visibility specimen. */
const APP = { name: 'crm', label: 'CRM' };

/**
 * The dispatcher's `response` is optional on `HttpDispatcherResult` — a route
 * that declines answers `{ handled: false }`. Every case here drives a route
 * that MUST answer, so an absent response is a failure of the harness rather
 * than a value to narrow around at each call site: this says so once, loudly,
 * and hands back a response the assertions can read.
 */
function responseOf(result: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
    const response = result.response;
    if (!response) throw new Error('the dispatcher handled the route but returned no response');
    return response;
}

describe('#7018 — the registry decides whether a metadata write carries the session org', () => {
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // The protocol logs degradation lines on these paths; they are not the
        // subject and must not drown the run. `error` is spied rather than
        // silenced-and-forgotten — the ADR-0045 flip reports its own failure
        // there (#4754), and the last case reads it back.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
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
        // channel either, so it is env-wide too. (`webhook` took this slot
        // from `theme` at #10485 — the retired kind left the contract.)
        expect(declaresOrgOverride('webhook')).toBe(false);
        // No active org in, no org out — for every type.
        expect(organizationIdForMetaWrite('view', undefined)).toBeUndefined();
    });

    // ── PUT /meta/:type/:name — the dispatcher's metadata write ───────────

    it('a NON-overridable type lands env-wide even though the session has an active org', async () => {
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);

        const res = responseOf(await dispatcher.handleMetadata(`/flow/${FLOW.name}`, ctx(), 'PUT', FLOW));

        expect(res.status).toBe(200);
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
            // [#8310] The runtime object door requires an authored OWD.
            sharingModel: 'private',
            fields: { subject: { type: 'text', label: 'Subject' } },
        };

        const res = responseOf(await dispatcher.handleMetadata(`/object/${OBJECT.name}`, ctx(), 'PUT', OBJECT));

        expect(res.status).toBe(200);
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

        const a = responseOf(await withOrg.dispatcher.handleMetadata(`/flow/${FLOW.name}`, ctx(), 'PUT', FLOW));
        const b = responseOf(await withoutOrg.dispatcher.handleMetadata(`/flow/${FLOW.name}`, ctx(), 'PUT', FLOW));

        expect(a.status).toBe(200);
        expect(a.body.data).toEqual(b.body.data);
        expect(a.body.data).toMatchObject({ success: true, state: 'active' });
    });

    it('CONTROL — an `allowOrgOverride: true` type keeps its org scoping exactly as before', async () => {
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);

        const res = responseOf(await dispatcher.handleMetadata(`/view/${VIEW.name}`, ctx(), 'PUT', VIEW));

        expect(res.status).toBe(200);
        // ADR-0005's per-org overlay is the point of the flag and must survive
        // this change untouched — `getMetaItem`/`getMetaItems` load it on demand.
        expect(metaRow(engine, 'view', VIEW.name)!.organization_id).toBe(ACTIVE_ORG);
    });

    it('CONTROL — the plural URL spelling of an overridable type is scoped the same way', async () => {
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);

        const res = responseOf(await dispatcher.handleMetadata(`/views/${VIEW.name}`, ctx(), 'PUT', VIEW));

        expect(res.status).toBe(200);
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

        const res = responseOf(await dispatcher.handlePackages('/crm_pkg/publish-drafts', 'POST', {}, {}, ctx()));

        expect(res.status).toBe(200);
        expect(res.body.data.unhiddenApps).toEqual([APP.name]);
        expect(res.body.data.unhideError).toBeUndefined();

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

        const res = responseOf(await dispatcher.handlePackages('/crm_pkg/publish-drafts', 'POST', {}, {}, ctx()));

        expect(res.body.data.unhiddenApps).toEqual([APP.name]);
        const flipComplaints = (error.mock.calls as unknown[][])
            .map((c) => String(c[0]))
            .filter((line: string) => line.includes('visibility flip'));
        expect(flipComplaints).toEqual([]);
    });
});

/**
 * #10503 — the dispatcher `/metadata` transport decided ORGANIZATION SCOPE
 * from the RAW path segment. The #10340 defect, one transport over.
 *
 * ── What was broken ───────────────────────────────────────────────────────
 *
 * Two maps that must agree did not. `protocol.saveMetaItem` folds the segment
 * through `canonicalizeMetaRequestType` → `META_URL_TO_SINGULAR`, the COMPLETE
 * spelling map, for STORAGE. The dispatcher handed the same string RAW to
 * `organizationIdForMetaWrite`, whose `declaresOrgOverride` tolerates only the
 * MANIFEST-collection spellings — incomplete by design. For the two URL-only
 * spellings of `allowOrgOverride: true` types the two answers diverged:
 *
 *   PUT /metadata/translation/:name     → org-scoped row      (correct)
 *   PUT /metadata/translations/:name    → env-wide row        (the defect)
 *   PUT /metadata/email_template/:name  → org-scoped row      (correct)
 *   PUT /metadata/email_templates/:name → env-wide row        (the defect)
 *
 * One item, two partitions, addressed by spelling. `translations` has no
 * manifest key at all; `email_template`'s manifest key is the camelCase
 * `emailTemplates`, so the snake_case plural the registry derivation adds is
 * URL-only too. Both fold to an `allowOrgOverride: true` type in storage.
 *
 * The `/published` branch is the smaller second site of the same class: after
 * the layered overlay consult misses, the fallback reads the code/package
 * store, which is keyed by CANONICAL type. Handed the raw segment it answered
 * 404 under a recognised plural and 200 under the singular twin.
 *
 * The correction is the one #10340 landed for REST and the one
 * `packages/spec/src/meta-spelling/metadata-url-spelling.ts` mandates: fold
 * the segment through `canonicalMetaUrlType` AT THE BOUNDARY, before the scope
 * decision. ⛔ NOT by widening `declaresOrgOverride` — a predicate below the
 * boundary consuming the URL spelling contract is the repair that module's
 * header forbids, and `meta-write-org-scope.ts`'s `ORG_OVERRIDABLE_TYPES`
 * header pins the limit.
 *
 * ── What these assertions are, and at which level ─────────────────────────
 *
 * The two measured members are pinned END TO END on the STORED ROW —
 * `sys_metadata.organization_id`, through the real dispatcher, the real
 * protocol and the real repository — because the defect IS which partition
 * the row lands in, and a 200 is not the assertion. The class-closing sweep
 * over every spelling in the contract is necessarily argument-level (a
 * schema-valid body per metadata type is not obtainable, and a 422 would pass
 * for the wrong reason); the stored-row link the argument stands for is what
 * the two specimens above it — and every #7018 case in this file — pin.
 *
 * Mirrors `packages/rest/src/rest-server-meta-org-scope-url-spelling.test.ts`,
 * the REST-side suite, case for case where the two transports have the same
 * doors.
 *
 * ── Reverse verification, direction predicted BEFORE running ──────────────
 *
 * Ordinary red, with deliberately green controls. Reverting the fold in
 * `src/domains/meta.ts` must turn the plural cases RED and leave every
 * singular-twin control and the `object`/`objects` over-folding guard GREEN —
 * the latter is why they are here: a "fix" that org-scoped everything would
 * pass the red cases and fail there, re-minting the #6190 phantom rows.
 * Measured result recorded in the PR body.
 */
describe('#10503 the dispatcher /metadata transport decides org scope on the FOLDED type', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    // The two measured members of the disagreement set: URL-only spellings of
    // `allowOrgOverride: true` types, invisible to the manifest map. Each
    // carries a schema-VALID body — a minimal one 422s before the scoping
    // decision is ever reached, which would pass these tests for the wrong
    // reason (the lesson the specimens above this block were built on).
    const MEMBERS = [
        {
            plural: 'translations',
            singular: 'translation',
            item: {
                // [#12194] The addressing name is snake_case — the item-name
                // grammar refuses `zh-CN` as an ADDRESSING key (uppercase +
                // dash). The BCP-47 spelling lives in `locale`, which is this
                // type's required identity; the name was always free to choose.
                name: 'zh_cn',
                label: 'Chinese (Simplified)',
                locale: 'zh-CN',
                messages: { greeting: '你好' },
            },
        },
        {
            plural: 'email_templates',
            singular: 'email_template',
            item: {
                name: 'welcome',
                label: 'Welcome',
                subject: 'Welcome aboard',
                bodyHtml: '<p>Welcome aboard</p>',
            },
        },
    ] as const;

    for (const { plural, singular, item } of MEMBERS) {
        it(`PUT /metadata/${plural}/:name lands ORG-SCOPED, where its ${singular} twin lands`, async () => {
            // THE assertion, and it is the stored row rather than the status:
            // before the fold this write persisted with `organization_id
            // NULL` while the author's own org-scoped read looked elsewhere —
            // receipted 200, served by nothing.
            const viaPlural = makeStack(ACTIVE_ORG);
            const resPlural = responseOf(
                await viaPlural.dispatcher.handleMetadata(`/${plural}/${item.name}`, ctx(), 'PUT', item),
            );
            expect(resPlural.status).toBe(200);
            const pluralRow = metaRow(viaPlural.engine, singular, item.name);
            expect(pluralRow).toBeDefined();
            expect(pluralRow!.organization_id).toBe(ACTIVE_ORG);

            // The live control, in the same file and the same direction: the
            // singular twin's scoping is what the plural must equal, and it
            // must not have moved.
            const viaSingular = makeStack(ACTIVE_ORG);
            const resSingular = responseOf(
                await viaSingular.dispatcher.handleMetadata(`/${singular}/${item.name}`, ctx(), 'PUT', item),
            );
            expect(resSingular.status).toBe(200);
            const singularRow = metaRow(viaSingular.engine, singular, item.name);
            expect(singularRow!.organization_id).toBe(ACTIVE_ORG);
            expect(pluralRow!.organization_id).toBe(singularRow!.organization_id);
        });

        it(`both spellings of ${singular} address ONE partition, not two`, async () => {
            // The defect stated as the thing an operator would actually see.
            // Storage already folded both spellings to `${singular}`, so the
            // rows differed ONLY in `organization_id` — a second, env-wide row
            // shadowed by the org-scoped one the author's own reads resolve.
            const { engine, dispatcher } = makeStack(ACTIVE_ORG);

            expect(responseOf(
                await dispatcher.handleMetadata(`/${plural}/${item.name}`, ctx(), 'PUT', item),
            ).status).toBe(200);
            expect(responseOf(
                await dispatcher.handleMetadata(`/${singular}/${item.name}`, ctx(), 'PUT', item),
            ).status).toBe(200);

            const rows = engine.metaRows().filter(
                (r: any) => r.type === singular && r.name === item.name && r.state === 'active',
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].organization_id).toBe(ACTIVE_ORG);
        });

        it(`CONTROL — with NO active org, /${plural} still lands env-wide`, async () => {
            // The fold changes WHICH type is judged, never invents an
            // organization: no active org in, no org out, for every spelling.
            const { engine, dispatcher } = makeStack(undefined);

            expect(responseOf(
                await dispatcher.handleMetadata(`/${plural}/${item.name}`, ctx(), 'PUT', item),
            ).status).toBe(200);
            expect(metaRow(engine, singular, item.name)!.organization_id).toBeNull();
        });
    }

    // ── the over-folding guard ────────────────────────────────────────────

    it('⛔ a NON-overridable type stays env-wide under its plural spelling too', async () => {
        // The fold must change which type is judged, never the judgement.
        // `object` is `allowOrgOverride: false`, and an org-scoped write of it
        // is exactly the phantom row #6190 stopped minting — a row cold boot
        // walks past, after which every record 404s. The singular is pinned by
        // the #7018 case above; this is the spelling the fold newly reaches.
        const { engine, dispatcher } = makeStack(ACTIVE_ORG);
        const OBJECT = {
            name: 'ticket',
            label: 'Ticket',
            sharingModel: 'private',
            fields: { subject: { type: 'text', label: 'Subject' } },
        };

        const res = responseOf(await dispatcher.handleMetadata(`/objects/${OBJECT.name}`, ctx(), 'PUT', OBJECT));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'object', OBJECT.name)!.organization_id).toBeNull();
    });

    // ── the class, not the two specimens ──────────────────────────────────

    it('decides scope for EVERY spelling in the URL contract exactly as for its folded type', async () => {
        // The class-closing sweep. For every key of `META_URL_TO_SINGULAR` the
        // transport's decision must equal the predicate's decision on the
        // FOLDED type — the property the two maps' disagreement broke. A future
        // spelling limb (a new registry type's derived plural, a new camelCase
        // form) arrives inside this quantifier with nothing to update by hand.
        //
        // Argument-level, deliberately and for a stated reason: a
        // schema-valid body for each of ~40 metadata types is not obtainable,
        // and an invalid one 422s before the scope decision — the sweep would
        // then be green over a decision never made. `saveMetaItem` is
        // therefore replaced with a recorder, and the argument→partition link
        // it stands for is pinned end-to-end by the two specimens above.
        for (const [spelling, folded] of Object.entries(META_URL_TO_SINGULAR)) {
            const { protocol, dispatcher } = makeStack(ACTIVE_ORG);
            const saveMetaItem = vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 });
            protocol.saveMetaItem = saveMetaItem;

            await dispatcher.handleMetadata(`/${spelling}/specimen`, ctx(), 'PUT', { name: 'specimen' });

            expect(
                saveMetaItem.mock.calls[0][0].organizationId,
                `PUT /metadata/${spelling} scope disagreed with its fold '${folded}'`,
            ).toBe(organizationIdForMetaWrite(folded, ACTIVE_ORG));
        }
    });

    it('hands the protocol the RAW segment as the request type — the protocol owns its own fold', async () => {
        // Only the scope ARGUMENT is folded. The request `type` stays the raw
        // segment exactly as before, because the protocol boundary folds it
        // itself (`canonicalizeMetaRequestType`) and two pre-folds would hide a
        // drift between them from the protocol's own tests. Byte-identical to
        // the REST suite's pin of the same decision.
        const { protocol, dispatcher } = makeStack(ACTIVE_ORG);
        const saveMetaItem = vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 });
        protocol.saveMetaItem = saveMetaItem;

        await dispatcher.handleMetadata('/translations/zh-CN', ctx(), 'PUT', { name: 'zh-CN' });

        const request = saveMetaItem.mock.calls[0][0];
        expect(request.type).toBe('translations');
        expect(request.organizationId).toBe(ACTIVE_ORG);
    });

    // ── the smaller second site: GET /metadata/:type/:name/published ──────

    describe('the /published code-store fallback — 404-by-spelling ends', () => {
        /**
         * A code/package published store, which is keyed by CANONICAL type —
         * the thing the raw segment could not address. It answers a body for
         * the canonical key only and records every key it was asked for, so
         * the assertions can read BOTH what came back and what was asked.
         */
        function publishedStore(canonicalType: string, name: string) {
            const asked: Array<[string, string]> = [];
            return {
                asked,
                service: {
                    getPublished: async (type: string, itemName: string) => {
                        asked.push([type, itemName]);
                        return type === canonicalType && itemName === name
                            ? { name: itemName, published: true }
                            : undefined;
                    },
                },
            };
        }

        for (const { plural, singular, item } of MEMBERS) {
            it(`/${plural}/:name/published answers what /${singular}/:name/published answers`, async () => {
                const viaPlural = publishedStore(singular, item.name);
                const pluralRes = responseOf(await makeStack(ACTIVE_ORG, viaPlural.service)
                    .dispatcher.handleMetadata(`/${plural}/${item.name}/published`, ctx(), 'GET'));

                const viaSingular = publishedStore(singular, item.name);
                const singularRes = responseOf(await makeStack(ACTIVE_ORG, viaSingular.service)
                    .dispatcher.handleMetadata(`/${singular}/${item.name}/published`, ctx(), 'GET'));

                // Same status and same body — before the fold the plural was a
                // 404 for an item that IS published, the singular a 200.
                expect(pluralRes.status).toBe(200);
                expect(pluralRes.status).toBe(singularRes.status);
                expect(pluralRes.body.data).toEqual(singularRes.body.data);
                // And the key the store was asked for is the canonical one
                // under both spellings — the reason the two now agree.
                expect(viaPlural.asked).toEqual([[singular, item.name]]);
                expect(viaPlural.asked).toEqual(viaSingular.asked);
            });
        }

        it('⛔ folds the SPELLING only — an unmapped segment reaches the store verbatim', async () => {
            // `canonicalMetaUrlType` returns its input unchanged for anything
            // the contract does not map, which is what keeps a plugin-
            // registered kind addressable. The fold is a lookup, never a
            // guesser, and this pins that the boundary did not grow one.
            expect(canonicalMetaUrlType('webhook')).toBe('webhook');
            const store = publishedStore('webhook', 'stripe');
            const res = responseOf(await makeStack(ACTIVE_ORG, store.service)
                .dispatcher.handleMetadata('/webhook/stripe/published', ctx(), 'GET'));

            expect(res.status).toBe(200);
            expect(store.asked).toEqual([['webhook', 'stripe']]);
        });
    });
});
