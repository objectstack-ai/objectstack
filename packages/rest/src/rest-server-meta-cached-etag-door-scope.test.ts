// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16525] The REST cached `/meta` door hands `getMetaItemCached` the EFFECTIVE
 * organization, already reduced by the registry read gate — so the validator's
 * scope prefix and the representation it validates agree at the only door that
 * reaches this verb in production.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * `getMetaItemCached` folds `request.organizationId` — the value AS SUPPLIED —
 * into the ETag (pinned in `@objectstack/metadata-protocol`,
 * `get-meta-item-cached-etag-scope.test.ts` §1). On its own that is a validator
 * that can name a scope the body was never resolved under. What makes it
 * agree in production is one line at THIS door:
 *
 *     const readOrganizationId = organizationIdForMetaRead(
 *         canonicalMetaUrlType(req.params.type), readCtx?.tenantId,
 *     );
 *
 * computed above the cached/uncached fork and spread into the cached request.
 * The gate has already run by the time the protocol sees the member, and
 * `organizationIdForMetaRead` is idempotent, so supplied === effective here.
 *
 * ⭐ NOTHING PINNED THAT. The sibling `rest-server-meta-read-org-scope.test.ts`
 * says so in its own words — "it pins that the arm still FOLDS, never that the
 * fold happens at the door" — and its measured ablation confirms it: swapping
 * the door's predicate for a raw `ctx?.tenantId` leaves that file green,
 * because the callee re-folds. It re-folds for the BODY. It does not re-fold
 * for the ETag, which is computed one layer above from the member as handed in.
 * ⇒ That ablation is exactly the change this file exists to redden.
 *
 * ── The observation channel, and the control ──────────────────────────────
 *
 * The `ETag` response header, compared across two reads of ONE document that
 * differ only in the session's active organization.
 *
 *   • a NON-overridable type: the two validators must be IDENTICAL, because
 *     the door reduced both organizations to `undefined`.
 *   • ⭐ THE CONTROL THAT MUST FIRE — an OVERRIDABLE type: the two validators
 *     must DIFFER, because the door forwards the organization there. Without
 *     it, a harness that emitted no ETag at all, or never took the cached arm,
 *     would pass every assertion above by answering `undefined === undefined`.
 *
 * §3 closes the loop by asking the protocol the counterfactual directly: given
 * the RAW tenant the door started from, the validator it would issue differs
 * from the one the door actually issued. That is the whole of what the door's
 * pre-gate buys, stated as a difference rather than as an intention.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

/** `allowOrgOverride: false` — the door must reduce the organization away. */
const NON_OVERRIDABLE = 'object';

/** `allowOrgOverride: true`, and the type that takes the CACHED arm. */
const OVERRIDABLE = 'view';

const NAME = 'shared_document';

interface Row {
    id: string; type: string; name: string;
    organization_id: string | null; package_id: string | null;
    state: string; metadata: string;
}

const row = (type: string, organization_id: string | null = null): Row => ({
    id: `r_${type}_${organization_id ?? 'env'}`,
    type,
    name: NAME,
    organization_id,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify(
        type === OVERRIDABLE
            ? {
                name: NAME, label: `${organization_id ?? 'env'} ${type}`,
                object: 'task', viewKind: 'list',
                columns: [{ field: 'name', label: 'Name' }],
            }
            : {
                name: NAME, label: `${organization_id ?? 'env'} ${type}`,
                sharingModel: 'private',
                fields: { title: { type: 'text', label: 'Title' } },
            },
    ),
});

function matchesWhere(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        // ⛔ REFUSE a combinator rather than reading it as a field name: a
        // double that answered `$and` by looking for a column literally called
        // `$and` would return a well-formed WRONG answer.
        if (k.startsWith('$')) {
            throw new Error(`stub engine: unsupported WHERE combinator \`${k}\``);
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

/**
 * ⛔ Read-only double, deliberately — every case below is a GET, so declaring
 * `insert` / `update` / `delete` would owe `check:engine-double-contract` a
 * dispatch contract that no case exercises.
 */
function makeStubEngine(rows: Row[]) {
    return {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return rows.find(
                (r) => matchesWhere(r as unknown as Record<string, unknown>, opts.where),
            ) ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = rows.filter(
                (r) => matchesWhere(r as unknown as Record<string, unknown>, opts?.where ?? {}),
            );
            // Bound AFTER the filter and BY PRESENCE, so `limit: 0` returns
            // nothing rather than everything (`check:objectql-double-limit`).
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        registry: {
            registerItem: () => {}, registerObject: () => {},
            listItems: () => [], getItem: () => undefined,
            getObject: () => undefined, getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    } as any;
}

function mockServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => undefined, close: async () => undefined,
    };
}

/**
 * Records headers — the sibling harness discards them, and the header IS the
 * observation channel here.
 */
function mockRes() {
    const headers = new Map<string, string>();
    const res: any = {
        statusCode: 200,
        _body: undefined,
        _headers: headers,
        json(body: any) { this._body = body; return this; },
        send() { return this; },
        setHeader(k: string, v: string) { headers.set(String(k).toLowerCase(), String(v)); return this; },
        status(code: number) { this.statusCode = code; return this; },
        header(k: string, v: string) { headers.set(String(k).toLowerCase(), String(v)); return this; },
    };
    return res;
}

function boot(rows: Row[]) {
    const protocol = new ObjectStackProtocolImplementation(makeStubEngine(rows), () => new Map()) as any;
    protocol.getDiscovery = async () => ({
        version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
    });

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    let session: any = { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId: ORG_A };
    (rest as any).resolveExecCtx = async () => session;
    rest.registerRoutes();

    const get = async (type: string) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === 'GET' && r.path === `${META}/:type/:name`,
        );
        if (!found) throw new Error('route not registered: GET /meta/:type/:name');
        const res = mockRes();
        let thrown: any;
        try {
            await found.handler(
                { method: 'GET', path: '', params: { type, name: NAME }, query: {}, headers: {}, body: {} } as any,
                res,
            );
        } catch (err) { thrown = err; }
        return { status: res.statusCode, body: res._body, etag: res._headers.get('etag'), thrown };
    };

    return {
        protocol,
        as(tenantId: string | undefined) {
            session = tenantId === undefined
                ? { userId: 'u1', systemPermissions: ['manage_metadata'] }
                : { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId };
        },
        get,
    };
}

/** The document a GET served, whichever envelope shape the arm answers in. */
const servedLabel = (body: any): string | undefined =>
    (body?.item ?? body?.data ?? body)?.label;

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the channel itself, proved before anything is concluded from it
// ═══════════════════════════════════════════════════════════════════════════

describe('§0 the cached arm runs and emits a validator', () => {
    it('a read of the cached-arm type answers 200 with an ETag header', async () => {
        const b = boot([row(OVERRIDABLE)]);
        const res = await b.get(OVERRIDABLE);
        expect(res.thrown, `GET threw: ${res.thrown?.code ?? res.thrown?.message}`).toBeUndefined();
        expect(res.status).toBe(200);
        expect(res.etag, 'no ETag header — the cached arm was not taken').toBeTruthy();
        expect(servedLabel(res.body)).toBe(`env ${OVERRIDABLE}`);
    });

    it('the non-overridable type reaches the same arm', async () => {
        const b = boot([row(NON_OVERRIDABLE)]);
        const res = await b.get(NON_OVERRIDABLE);
        expect(res.thrown, `GET threw: ${res.thrown?.code ?? res.thrown?.message}`).toBeUndefined();
        expect(res.status).toBe(200);
        expect(res.etag, 'no ETag header — the cached arm was not taken').toBeTruthy();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — the door reduces the organization before the validator is computed
// ═══════════════════════════════════════════════════════════════════════════

describe('§1 two tenants reading ONE env-wide document', () => {
    let rows: Row[];
    beforeEach(() => { rows = []; });

    it(`${NON_OVERRIDABLE}: the validators are IDENTICAL — the door gated both organizations away`, async () => {
        rows.push(row(NON_OVERRIDABLE));
        const b = boot(rows);

        b.as(ORG_A);
        const a = await b.get(NON_OVERRIDABLE);
        b.as(ORG_B);
        const bb = await b.get(NON_OVERRIDABLE);
        b.as(undefined);
        const none = await b.get(NON_OVERRIDABLE);

        expect(servedLabel(a.body)).toBe(`env ${NON_OVERRIDABLE}`);
        expect(servedLabel(bb.body)).toBe(`env ${NON_OVERRIDABLE}`);
        expect(servedLabel(none.body)).toBe(`env ${NON_OVERRIDABLE}`);

        // The claim: the scope the validator states is the scope the body was
        // resolved under — environment-wide, for all three callers.
        expect(
            a.etag,
            'the cached door stopped reducing the organization — see #16525',
        ).toBe(none.etag);
        expect(bb.etag).toBe(none.etag);
    });

    it(`⭐ CONTROL — ${OVERRIDABLE}: the validators DIFFER, because the door forwards the organization`, async () => {
        rows.push(row(OVERRIDABLE));
        const b = boot(rows);

        b.as(ORG_A);
        const a = await b.get(OVERRIDABLE);
        b.as(ORG_B);
        const bb = await b.get(OVERRIDABLE);
        b.as(undefined);
        const none = await b.get(OVERRIDABLE);

        // Same bytes for all three — the organization resolves no row here, so
        // any validator difference is the SCOPE component and nothing else.
        expect(servedLabel(a.body)).toBe(`env ${OVERRIDABLE}`);
        expect(servedLabel(bb.body)).toBe(`env ${OVERRIDABLE}`);
        expect(servedLabel(none.body)).toBe(`env ${OVERRIDABLE}`);

        expect(a.etag, 'the control did not fire — the ETag ignores the organization entirely').not.toBe(none.etag);
        expect(bb.etag).not.toBe(none.etag);
        expect(a.etag).not.toBe(bb.etag);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — the organization still reaches the BODY where it legitimately can
// ═══════════════════════════════════════════════════════════════════════════

describe('§2 the reduction is the registry gate, not a dropped organization', () => {
    it(`${OVERRIDABLE}: an org-scoped row is still served to its tenant`, async () => {
        // ⭐ Without this, §1 is equally consistent with a door that forwards no
        // organization at all — which would be #9454 reopened, not a fix.
        const b = boot([row(OVERRIDABLE), row(OVERRIDABLE, ORG_A)]);

        b.as(ORG_A);
        const mine = await b.get(OVERRIDABLE);
        b.as(ORG_B);
        const theirs = await b.get(OVERRIDABLE);

        expect(servedLabel(mine.body)).toBe(`${ORG_A} ${OVERRIDABLE}`);
        expect(servedLabel(theirs.body)).toBe(`env ${OVERRIDABLE}`);
        expect(mine.etag).not.toBe(theirs.etag);
    });

    it(`${NON_OVERRIDABLE}: a phantom org row is served to nobody`, async () => {
        const b = boot([row(NON_OVERRIDABLE), row(NON_OVERRIDABLE, ORG_A)]);

        b.as(ORG_A);
        const mine = await b.get(NON_OVERRIDABLE);
        expect(servedLabel(mine.body)).toBe(`env ${NON_OVERRIDABLE}`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — ⭐ the counterfactual: what the pre-gate is actually worth
// ═══════════════════════════════════════════════════════════════════════════

describe('§3 handing the protocol the RAW tenant issues a different validator', () => {
    it(`${NON_OVERRIDABLE}: the raw-tenant validator differs from the one the door issued`, async () => {
        const rows = [row(NON_OVERRIDABLE)];
        const b = boot(rows);

        b.as(ORG_A);
        const throughDoor = await b.get(NON_OVERRIDABLE);

        // The same read the door performs, minus the door's `organizationIdFor
        // MetaRead` reduction. The protocol re-folds for the BODY — the label
        // below proves it — and does NOT re-fold for the validator.
        const raw = await b.protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: NAME, organizationId: ORG_A,
        });

        expect(raw.data?.label, 'the callee stopped re-folding for the body').toBe(`env ${NON_OVERRIDABLE}`);
        expect(
            throughDoor.etag,
            'the door\'s pre-gate no longer changes the validator — re-read #16525 §3',
        ).not.toBe(`"${raw.etag.value}"`);
    });
});
