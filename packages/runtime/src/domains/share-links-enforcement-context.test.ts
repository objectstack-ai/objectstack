// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6551 / #6206 / #6430] Dispatcher-face `/share-links` enforcement context.
 *
 * The dispatcher domain used to rebuild a two-field `{ userId, tenantId }`
 * out of the request's ALREADY-COMPLETE resolved `ExecutionContext` and hand
 * that to `svc.createLink` / `svc.listLinks` / `svc.revokeLink` — the same
 * consumption-site truncation #6206 fixed on the plugin-sharing face (PR
 * #6552), one entry point over. Structural subtyping keeps the trimmed object
 * compiling against the contract's `ExecutionContext` parameter, so only a
 * behavioural repro + a seam-parity pin can hold this boundary.
 *
 * ## What is real here and what is a double
 *
 * REAL: the dispatcher domain body under test (`handleShareLinksRequest` — the
 * exact production entry for cloud per-env kernels, where
 * `registerShareLinkRoutes: false` makes it the ONLY share-link surface), the
 * `ShareLinkService` from `@objectstack/plugin-sharing` (its [Finding-2]
 * visibility read is the adjudication the envelope feeds), and the WHOLE
 * `SecurityPlugin` middleware from `@objectstack/plugin-security` — booted the
 * same way its own `vama-write-path-convergence.test.ts` boots it, so Layer 0
 * (the ADR-0105 D2 tenant wall reading `accessible_org_ids`) and Layer 1
 * (permission-set business RLS reading `positions` / `permissions`) are the
 * production verdicts, not re-implementations.
 *
 * DOUBLE: storage only. The engine below is an in-memory table set that runs
 * every non-system operation through the registered middleware chain (mutating
 * `opCtx.ast.where`, exactly the seam the real ObjectQL engine offers the
 * middleware) and then matches rows against the composed predicate. Its write
 * verbs open with the producers' own dispatch predicates
 * (`assertEngineUpdateDispatch` / `assertEngineDeleteDispatch`), so the double
 * cannot accept a call the real engine would refuse.
 *
 * ## The two limbs of #6551, separated by posture
 *
 * - `group` posture: Layer 1 admits (the caller OWNS the record), so the
 *   verdict hinges on Layer 0 alone — the `accessible_org_ids` limb. With the
 *   pre-fix truncation the wall never sees the set and denies (fail closed).
 * - `single` posture: Layer 0 is inert, so the verdict hinges on Layer 1 alone
 *   — the `positions` / `permissions` limb (the half the issue flagged as
 *   unreproduced). The record is visible ONLY through a position-bound
 *   permission set (`east_viewer`, applicability `positions: ['pos_east']`);
 *   the additive baseline (`acct_member`) carries an owner-only policy. A
 *   context truncated to `{ userId, tenantId }` resolves just the baseline →
 *   owner-only → 403 on a record the full envelope reads fine.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ShareLinkService } from '@objectstack/plugin-sharing';
import { apiErrorResponse } from '../error-envelope.js';
import { handleShareLinksRequest } from './share-links.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

const OBJECT = 'crm_account';
const RECORD = 'acc_1';
const ORG_A = 'org_plant_a';
const ORG_B = 'org_plant_b';
const USER = 'u_sharer';

/**
 * Schema double: a public tenant business object (carries `organization_id`,
 * no `access.default: 'private'`) that opts into publicSharing — the shape on
 * which the Layer 0 wall applies to every non-platform-admin caller.
 */
const ACCOUNT_SCHEMA = {
    name: OBJECT,
    fields: {
        id: { name: 'id' },
        name: { name: 'name' },
        region: { name: 'region' },
        owner_id: { name: 'owner_id' },
        organization_id: { name: 'organization_id' },
    },
    publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
};

/**
 * The additive baseline (wired as `fallbackPermissionSet`, the same role
 * `member_default` plays in production): CRUD on the object plus an OWNER-ONLY
 * read scope. Baseline-only visibility is deliberately narrow so the
 * position-bound widening below is the ONLY way to see a colleague's record.
 */
const ACCT_MEMBER: PermissionSet = PermissionSetSchema.parse({
    name: 'acct_member',
    label: 'Account member (baseline)',
    objects: { crm_account: { allowRead: true, allowCreate: true } },
    rowLevelSecurity: [
        { name: 'own_accounts', object: 'crm_account', operation: 'all', using: 'owner_id == current_user.id' },
    ],
});

/**
 * The position-bound permission set of the issue's unreproduced limb: extra
 * read scope (`region == "east"`), applicable ONLY to callers holding
 * `pos_east` (ADR-0090 P2 applicability domain). In production this set
 * reaches the envelope via the position → permission-set binding that
 * `resolveAuthzContext` folds into `permissions`; both `positions` (the
 * applicability domain) and `permissions` (the set name) are fields the
 * pre-fix truncation dropped.
 */
const EAST_VIEWER: PermissionSet = PermissionSetSchema.parse({
    name: 'east_viewer',
    label: 'East-region viewer (position-bound)',
    objects: { crm_account: { allowRead: true } },
    rowLevelSecurity: [
        {
            name: 'east_region_read',
            object: 'crm_account',
            operation: 'select',
            using: 'region == "east"',
            positions: ['pos_east'],
        },
    ],
});

const PERMISSION_SETS = [ACCT_MEMBER, EAST_VIEWER];

function matches(row: any, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or)) return filter.$or.some((f: any) => matches(row, f));
    if (Array.isArray(filter.$and)) return filter.$and.every((f: any) => matches(row, f));
    return Object.entries(filter).every(([k, v]) => {
        if (k === '$or' || k === '$and') return true;
        if (v != null && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
        return row[k] === v;
    });
}

/**
 * Storage double that pipes every operation through the registered middleware
 * chain. `find` exposes `opCtx.ast` (the seam the security middleware
 * AND-composes Layer 0 + Layer 1 into) and executes the COMPOSED predicate —
 * so a deny verdict here is the production middleware's, not this file's.
 */
function makeEngine(tables: Record<string, any[]>) {
    const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
    const runChain = async (opCtx: any, terminal: () => Promise<void>): Promise<void> => {
        const dispatch = async (i: number): Promise<void> =>
            i < middlewares.length ? middlewares[i](opCtx, () => dispatch(i + 1)) : terminal();
        await dispatch(0);
    };
    return {
        _tables: tables,
        registerMiddleware: (mw: any) => middlewares.push(mw),
        getSchema: (name: string) => (name === OBJECT ? ACCOUNT_SCHEMA : { name }),
        async find(object: string, options: any = {}) {
            const opCtx: any = {
                object,
                operation: 'find',
                context: options?.context ?? {},
                options,
                ast: { where: options?.where },
            };
            await runChain(opCtx, async () => {
                const rows = (tables[object] ??= []).filter((r) => matches(r, opCtx.ast.where));
                opCtx.result = rows.slice(0, options?.limit ?? 1000);
            });
            return opCtx.result;
        },
        async insert(object: string, row: any, options?: any) {
            const opCtx: any = { object, operation: 'insert', context: options?.context ?? {}, data: row, options };
            await runChain(opCtx, async () => {
                (tables[object] ??= []).push({ ...row });
                opCtx.result = row;
            });
            return opCtx.result;
        },
        async update(object: string, data: any, options?: any) {
            const dispatch = assertEngineUpdateDispatch(data, options);
            const opCtx: any = { object, operation: 'update', context: options?.context ?? {}, data, options };
            await runChain(opCtx, async () => {
                const rows = (tables[object] ??= []);
                if (dispatch.kind === 'by-id') {
                    const i = rows.findIndex((r) => r.id === dispatch.id);
                    if (i >= 0) rows[i] = { ...rows[i], ...data };
                    opCtx.result = data;
                    return;
                }
                const matched = rows.filter((r) => matches(r, options?.where ?? {}));
                for (const r of matched) Object.assign(r, data);
                opCtx.result = matched.length;
            });
            return opCtx.result;
        },
        async delete(object: string, options?: any) {
            const dispatch = assertEngineDeleteDispatch(options);
            const opCtx: any = { object, operation: 'delete', context: options?.context ?? {}, options };
            await runChain(opCtx, async () => {
                const rows = (tables[object] ??= []);
                if (dispatch.kind === 'by-id') {
                    const before = rows.length;
                    tables[object] = rows.filter((r) => r.id !== dispatch.id);
                    opCtx.result = tables[object].length < before;
                    return;
                }
                const matched = rows.filter((r) => matches(r, options?.where ?? {}));
                tables[object] = rows.filter((r) => !matched.includes(r));
                opCtx.result = matched.length;
            });
            return opCtx.result;
        },
    };
}

/**
 * Boot the REAL SecurityPlugin over the engine double, the same harness shape
 * as plugin-security's `vama-write-path-convergence.test.ts`. The tenancy
 * posture arrives the production way — via the `tenancy` service (ADR-0093
 * D4 / ADR-0105 D1).
 */
async function bootSecurity(engine: any, posture: 'single' | 'group'): Promise<void> {
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        objectql: engine,
        metadata: {
            get: async (_type: string, name: string) => (name === OBJECT ? ACCOUNT_SCHEMA : null),
            list: async () => PERMISSION_SETS,
        },
        tenancy: { posture },
    };
    const ctx: any = {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        hook: vi.fn(),
        registerService: vi.fn(),
        getService: (name: string) => {
            if (name in services) return services[name];
            throw new Error(`service not registered: ${name}`);
        },
    };
    const plugin = new SecurityPlugin({
        defaultPermissionSets: PERMISSION_SETS,
        // The additive human baseline, as in production (member_default's role).
        // This is also exactly what a TRUNCATED context degrades to: with
        // `permissions` stripped, resolution falls back to this one set.
        fallbackPermissionSet: 'acct_member',
    });
    await plugin.init(ctx);
    await plugin.start(ctx);
}

/**
 * The envelope exactly as `resolveExecutionContext` assembles it for a human
 * principal (see `security/resolve-execution-context.ts`): the two fields the
 * old `callerCtx` kept PLUS everything it dropped.
 */
function envelopeFor(opts: {
    memberOf: string[];
    permissions: string[];
    positions?: string[];
    orgUserIds?: string[];
}): ExecutionContext {
    const ctx: any = {
        userId: USER,
        tenantId: opts.memberOf[0],
        email: 'sharer@example.com',
        isSystem: false,
        principalKind: 'human',
        posture: 'MEMBER',
        positions: opts.positions ?? [],
        permissions: opts.permissions,
        systemPermissions: [],
        org_user_ids: opts.orgUserIds ?? [USER],
        accessible_org_ids: [...opts.memberOf],
    };
    return ctx as ExecutionContext;
}

function makeDeps(engine: any, svc: any): DomainHandlerDeps {
    const deps: any = {
        resolveService: async (_c: any, name: string) =>
            name === SHARE_LINK_SERVICE ? svc : name === 'objectql' ? engine : undefined,
        getRequestKernelService: async (_c: any, name: string) => (name === 'objectql' ? engine : undefined),
        success: (data: any, meta?: any) => ({ status: 200, body: { success: true, data, ...(meta ? { meta } : {}) } }),
        // The REAL envelope builder the dispatcher's own `error()` delegates to,
        // so `error.code` / status assertions here are against the production
        // ADR-0112 shape, not a lookalike.
        error: (message: string, httpStatus = 500, details?: any) => apiErrorResponse({ message, httpStatus, details }),
        routeNotFound: (route: string) => apiErrorResponse({ message: `Route not found: ${route}`, httpStatus: 404 }),
    };
    return deps as DomainHandlerDeps;
}

const httpContext = (executionContext?: ExecutionContext): HttpProtocolContext =>
    ({ executionContext }) as unknown as HttpProtocolContext;

interface MintOptions {
    posture: 'single' | 'group';
    envelope: ExecutionContext | undefined;
    records: any[];
}

/**
 * Drive the PRODUCTION dispatcher entry: POST /share-links for
 * `crm_account/acc_1` — the exact call the record page's share button makes
 * against a cloud per-env kernel.
 */
async function mintOnDispatcher(opts: MintOptions): Promise<{ status: number; body: any }> {
    const tables: Record<string, any[]> = { [OBJECT]: opts.records, sys_share_link: [], sys_permission_set: [] };
    const engine = makeEngine(tables);
    await bootSecurity(engine, opts.posture);
    const svc = new ShareLinkService({ engine: engine as any });
    const deps = makeDeps(engine, svc);
    const res = await handleShareLinksRequest(
        deps,
        '',
        'POST',
        { object: OBJECT, recordId: RECORD },
        {},
        httpContext(opts.envelope),
    );
    if (!res.handled || !res.response) throw new Error('POST /share-links was not handled');
    return res.response as { status: number; body: any };
}

/** A record the caller OWNS (Layer 1 admits it) in plant A. */
const ownRecordInA = () => [{ id: RECORD, name: 'Acme', owner_id: USER, organization_id: ORG_A, region: 'west' }];
/** A COLLEAGUE's east-region record — visible only through `east_viewer`. */
const eastRecordOwnedByOther = () => [
    { id: RECORD, name: 'East Acme', owner_id: 'u_other', organization_id: ORG_A, region: 'east' },
];

describe('[#6551] dispatcher-face share-link creation under the `group` posture (the accessible_org_ids limb)', () => {
    it('mints a link for an owned, readable record (403 FORBIDDEN before the envelope was passed through whole)', async () => {
        const res = await mintOnDispatcher({
            posture: 'group',
            envelope: envelopeFor({ memberOf: [ORG_A], permissions: ['acct_member'] }),
            records: ownRecordInA(),
        });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ success: true });
        expect(res.body.data).toMatchObject({ object_name: OBJECT, record_id: RECORD, created_by: USER });
        expect(typeof res.body.data.token).toBe('string');
    }, 30_000);

    it('still refuses a record OUTSIDE the caller org access set — the wall is live, not bypassed', async () => {
        const res = await mintOnDispatcher({
            posture: 'group',
            envelope: envelopeFor({ memberOf: [ORG_B], permissions: ['acct_member'] }),
            records: ownRecordInA(),
        });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
    }, 30_000);

    it('reaches records across EVERY organization the caller belongs to (MOAC union)', async () => {
        const res = await mintOnDispatcher({
            posture: 'group',
            envelope: envelopeFor({ memberOf: [ORG_B, ORG_A], permissions: ['acct_member'] }),
            records: ownRecordInA(),
        });
        expect(res.status).toBe(201);
    }, 30_000);

    it('a context WITHOUT accessible_org_ids is refused (the pre-fix truncation, measured — fail closed, ADR-0105 D2)', async () => {
        // NOT a regression pin for the fix (this outcome is identical before
        // and after it — the truncation produced exactly such a context); it
        // pins that the wall stays fail-closed on an absent set, i.e. the fix
        // widened the ENVELOPE, never the authority.
        const envelope = envelopeFor({ memberOf: [ORG_A], permissions: ['acct_member'] });
        delete (envelope as any).accessible_org_ids;
        const res = await mintOnDispatcher({ posture: 'group', envelope, records: ownRecordInA() });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
    }, 30_000);
});

describe('[#6551] dispatcher-face creation under the `single` posture (the positions/permissions limb — the issue\'s unreproduced half)', () => {
    it('mints a link for a record visible ONLY through a position-bound permission set', async () => {
        const res = await mintOnDispatcher({
            posture: 'single',
            envelope: envelopeFor({
                memberOf: [ORG_A],
                // What `resolveAuthzContext` produces for a `pos_east` holder:
                // the position itself AND the set bound to it.
                permissions: ['acct_member', 'east_viewer'],
                positions: ['pos_east'],
            }),
            records: eastRecordOwnedByOther(),
        });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ object_name: OBJECT, record_id: RECORD });
    }, 30_000);

    it('the baseline alone cannot see it — what the pre-fix truncation degraded every caller to', async () => {
        // A `{ userId, tenantId }`-truncated context resolves exactly the
        // additive baseline (`fallbackPermissionSet`) and no positions — this
        // case measures that degradation's verdict on the SAME record: the
        // owner-only baseline policy excludes it, so the mint is refused.
        const res = await mintOnDispatcher({
            posture: 'single',
            envelope: envelopeFor({ memberOf: [ORG_A], permissions: ['acct_member'] }),
            records: eastRecordOwnedByOther(),
        });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
    }, 30_000);
});

describe('[#6551] the dispatcher seam itself', () => {
    it('hands the service the COMPLETE resolved envelope on all three verbs — re-trimming fails by naming the dropped keys', async () => {
        const seen: Record<string, any> = {};
        const svc = {
            createLink: vi.fn(async (_input: any, ctx: any) => {
                seen.createLink = ctx;
                return { id: 'shl_seam', token: 'tok_seam', object_name: OBJECT, record_id: RECORD };
            }),
            listLinks: vi.fn(async (_filter: any, ctx: any) => {
                seen.listLinks = ctx;
                return [];
            }),
            revokeLink: vi.fn(async (_id: string, ctx: any) => {
                seen.revokeLink = ctx;
            }),
            resolveToken: vi.fn(async () => null),
        };
        const engine = makeEngine({ [OBJECT]: [], sys_share_link: [] });
        const deps = makeDeps(engine, svc);
        const envelope = envelopeFor({
            memberOf: [ORG_B, ORG_A],
            permissions: ['acct_member', 'east_viewer'],
            positions: ['pos_east'],
            orgUserIds: [USER, 'u_other'],
        });

        await handleShareLinksRequest(deps, '', 'POST', { object: OBJECT, recordId: RECORD }, {}, httpContext(envelope));
        await handleShareLinksRequest(deps, '', 'GET', undefined, {}, httpContext(envelope));
        await handleShareLinksRequest(deps, '/shl_seam', 'DELETE', undefined, {}, httpContext(envelope));

        for (const verb of ['createLink', 'listLinks', 'revokeLink'] as const) {
            expect(svc[verb]).toHaveBeenCalledTimes(1);
            const got = seen[verb];
            // The #6206 contract: the WHOLE `resolveExecutionContext` envelope,
            // unchanged — a re-trim shows up here as the exact keys it dropped.
            const dropped = Object.keys(envelope as any).filter(
                (k) => !(k in got) || got[k] !== (envelope as any)[k],
            );
            expect(dropped, `svc.${verb} enforcement context dropped/altered keys`).toEqual([]);
        }
    });

    it('an unauthenticated request is refused with the 401 envelope BEFORE any service call', async () => {
        const svc = {
            createLink: vi.fn(),
            listLinks: vi.fn(),
            revokeLink: vi.fn(),
            resolveToken: vi.fn(async () => null),
        };
        const engine = makeEngine({ [OBJECT]: [], sys_share_link: [] });
        const deps = makeDeps(engine, svc);
        const res = await handleShareLinksRequest(
            deps,
            '',
            'POST',
            { object: OBJECT, recordId: RECORD },
            {},
            httpContext(undefined),
        );
        expect(res.response?.status).toBe(401);
        expect(res.response?.body).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
        expect(svc.createLink).not.toHaveBeenCalled();
    });
});
