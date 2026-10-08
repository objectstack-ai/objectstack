// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6551 / commit 8e13ca876 / #6430] Dispatcher-face `/share-links` enforcement context.
 *
 * The dispatcher domain used to rebuild a two-field `{ userId, tenantId }`
 * out of the request's ALREADY-COMPLETE resolved `ExecutionContext` and hand
 * that to `svc.createLink` / `svc.listLinks` / `svc.revokeLink` — the same
 * consumption-site truncation commit 8e13ca876 fixed on the plugin-sharing face (PR
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
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { PermissionDeniedError, SecurityPlugin } from '@objectstack/plugin-security';
import { ShareLinkService, SharingServicePlugin, registerShareLinkRoutes } from '@objectstack/plugin-sharing';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { apiErrorResponse } from '../error-envelope.js';
import { handleShareLinksRequest } from './share-links.js';
import { HttpDispatcher } from '../http-dispatcher.js';
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

/**
 * [#6649] The CRUD-gate denial's input: an object grant with NO `allowRead`.
 *
 * The baseline is ADDITIVE for every human principal (ADR-0090 D5 — the
 * `fallbackPermissionSet` applies IN ADDITION to whatever else resolved), so a
 * caller only reaches the CRUD gate's deny branch when the baseline itself
 * withholds read. This set is therefore wired as BOTH the caller's explicit set
 * and the fallback in the #6649 cases below: `allowCreate` alone, so
 * `checkObjectPermission('find', 'crm_account', …)` is false and the security
 * middleware throws `PermissionDeniedError` — the shape whose status the domain
 * used to drop, because it declared `statusCode` alone until #21405.
 */
const ACCT_NO_READ: PermissionSet = PermissionSetSchema.parse({
    name: 'acct_no_read',
    label: 'Account create-only (no read grant)',
    objects: { crm_account: { allowCreate: true } },
});

const PERMISSION_SETS = [ACCT_MEMBER, EAST_VIEWER];

function matches(row: any, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    // `$or` / `$and` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them — a short-circuiting `return` here would discard every
    // sibling equality key in the same object. See #7620.
    if (Array.isArray(filter.$or) && !filter.$or.some((f: any) => matches(row, f))) return false;
    if (Array.isArray(filter.$and) && !filter.$and.every((f: any) => matches(row, f))) return false;
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
function makeEngine(tables: Record<string, any[]>, schemas?: Record<string, any>) {
    const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
    const runChain = async (opCtx: any, terminal: () => Promise<void>): Promise<void> => {
        const dispatch = async (i: number): Promise<void> =>
            i < middlewares.length ? middlewares[i](opCtx, () => dispatch(i + 1)) : terminal();
        await dispatch(0);
    };
    return {
        _tables: tables,
        registerMiddleware: (mw: any) => middlewares.push(mw),
        // [#14637] With a `schemas` map the double answers from IT and from
        // nothing else — including `undefined` for a name it does not carry,
        // which is the engine-cannot-answer case the policy gate must fail
        // CLOSED on. Omit the map (every caller that predates #14637) and this
        // is byte-for-byte the previous behaviour.
        getSchema: (name: string) =>
            schemas ? schemas[name] : name === OBJECT ? ACCOUNT_SCHEMA : { name },
        // The engine's trailing read options carry a context too (`find(object,
        // query, { context })`, merged as `mergeReadContext` merges them):
        // plugin-security's permission-set loader passes its explicit system
        // opt-in there. A double that dropped it handed that read to the
        // middleware with no principal, which ADR-0096 D5 now refuses.
        async find(object: string, options: any = {}, readOptions?: any) {
            const opCtx: any = {
                object,
                operation: 'find',
                context: { ...(options?.context ?? {}), ...(readOptions?.context ?? {}) },
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
async function bootSecurity(
    engine: any,
    posture: 'single' | 'group',
    // [#6649] The permission-set world and its additive baseline are parameters
    // now; the defaults are byte-for-byte what every #6551 case above booted
    // with, so those verdicts are untouched.
    sets: PermissionSet[] = PERMISSION_SETS,
    fallback: string = 'acct_member',
): Promise<void> {
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        objectql: engine,
        metadata: {
            get: async (_type: string, name: string) => (name === OBJECT ? ACCOUNT_SCHEMA : null),
            list: async () => sets,
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
        defaultPermissionSets: sets,
        // The additive human baseline, as in production (member_default's role).
        // This is also exactly what a TRUNCATED context degrades to: with
        // `permissions` stripped, resolution falls back to this one set.
        fallbackPermissionSet: fallback,
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

/**
 * [#6649] The dispatcher's own thrown-error mapper — the REAL private method,
 * borrowed off a dispatcher constructed over a kernel stub exactly as
 * `error-envelope.conformance.test.ts`'s `makeDispatcher()` does.
 *
 * Deliberately NOT a hand-written `e?.status ?? e?.statusCode ?? 500` double: a
 * restatement here would make these cases green against the double's rules
 * rather than production's, which is the same class of mistake as the
 * hand-written catch this issue is about. Every branch it takes (status from
 * `status` OR `statusCode`, `.code` carried through `details` for
 * `buildApiError` to promote, `INTERNAL_ERROR` derived when the throw has no
 * code, the 5xx leak guard) is production's.
 */
const realErrorFromThrown = (() => {
    const dispatcher: any = new HttpDispatcher({ context: { getService: () => null } } as any);
    return (e: any, fallbackStatus?: number) => dispatcher.errorFromThrown(e, fallbackStatus);
})();

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
        errorFromThrown: realErrorFromThrown,
    };
    return deps as DomainHandlerDeps;
}

const httpContext = (executionContext?: ExecutionContext): HttpProtocolContext =>
    ({ executionContext }) as unknown as HttpProtocolContext;

interface MintOptions {
    posture: 'single' | 'group';
    envelope: ExecutionContext | undefined;
    records: any[];
    /** [#6649] The permission-set world to boot; defaults to the #6551 one. */
    permissionSets?: PermissionSet[];
    /** [#6649] The additive baseline; defaults to the #6551 `acct_member`. */
    fallbackPermissionSet?: string;
}

/**
 * Drive the PRODUCTION dispatcher entry: POST /share-links for
 * `crm_account/acc_1` — the exact call the record page's share button makes
 * against a cloud per-env kernel.
 */
async function mintOnDispatcher(opts: MintOptions): Promise<{ status: number; body: any }> {
    const tables: Record<string, any[]> = { [OBJECT]: opts.records, sys_share_link: [], sys_permission_set: [] };
    const engine = makeEngine(tables);
    await bootSecurity(engine, opts.posture, opts.permissionSets, opts.fallbackPermissionSet);
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
            // The contract commit 8e13ca876 set: the WHOLE `resolveExecutionContext` envelope,
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

/**
 * [#6649] The domain's unified catch and the two channels a thrown refusal
 * carries its HTTP status on.
 *
 * The catch read `err?.status ?? 500` only. Every refusal `ShareLinkService`
 * raises itself carries `status` (its `makeError` sets `status` + `code`), which
 * is why the `403 FORBIDDEN` cases above were already correct and stayed correct
 * — but the SECURITY middleware's refusals do not come from that service. The
 * CRUD gate throws `PermissionDeniedError { code: 'PERMISSION_DENIED';
 * statusCode: 403 }` — no `status` field at all — straight out of
 * `svc.createLink`'s visibility read, past a service that does not catch it, into
 * this catch. `err?.status` was `undefined`, so the 403 left as a **500** while
 * `code` still read `PERMISSION_DENIED`: an envelope that contradicts itself, and
 * a status many clients treat as retryable when the answer is permanent.
 *
 * The fix routes the catch through `deps.errorFromThrown` — the dispatcher's
 * shared mapper, which `/meta`, `/actions` and `/mcp` already exit through and
 * which reads `status` OR `statusCode`. These cases assert `status` AND `code`
 * together on purpose: a denial arriving as 403 under the wrong code would be
 * just as wrong as the 500, and only the pair separates them.
 *
 * [#21405] The paragraphs above describe the class as #6649 found it. It now
 * carries `status` beside `statusCode`, which is what fixed the OTHER door, and
 * the shared-catch case below keeps a `statusCode`-only throw so this catch's
 * second channel stays pinned.
 */

/** The ADR-0112 envelope checks every case below shares. */
function expectDeclaredEnvelope(res: { status: number; body: any }): any {
    expect(BaseResponseSchema.safeParse(res.body).success).toBe(true);
    expect(envelopeViolations(res.body), `not the declared envelope: ${JSON.stringify(res.body)}`).toEqual([]);
    const parsed = ApiErrorSchema.safeParse(res.body.error);
    // `ApiErrorSchema.code` validates against the CLOSED set (StandardErrorCode ∪
    // ERROR_CODE_LEDGER), so this is also what keeps the code out of the
    // free-string space the old `'INTERNAL'` fallback sat in.
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(res.body.error.httpStatus).toBe(res.status);
    return res.body.error;
}

/** A `/share-links` call served by a service double that throws `thrown`. */
async function refusalFromService(
    thrown: unknown,
    verb: 'POST' | 'GET' | 'DELETE' = 'POST',
): Promise<{ status: number; body: any }> {
    const boom = async () => { throw thrown; };
    const svc = {
        createLink: vi.fn(boom),
        listLinks: vi.fn(boom),
        revokeLink: vi.fn(boom),
        resolveToken: vi.fn(async () => null),
    };
    const deps = makeDeps(makeEngine({ [OBJECT]: [], sys_share_link: [] }), svc);
    const res = await handleShareLinksRequest(
        deps,
        verb === 'DELETE' ? '/shl_x' : '',
        verb,
        verb === 'POST' ? { object: OBJECT, recordId: RECORD } : undefined,
        {},
        httpContext(envelopeFor({ memberOf: [ORG_A], permissions: ['acct_member'] })),
    );
    if (!res.handled || !res.response) throw new Error(`${verb} /share-links was not handled`);
    return res.response as { status: number; body: any };
}

/** The caller of the repro: create-only grant, so the visibility read is denied. */
const noReadCaller = (posture: 'single' | 'group') => ({
    posture,
    envelope: envelopeFor({ memberOf: [ORG_A], permissions: ['acct_no_read'] }),
    records: ownRecordInA(),
    permissionSets: [ACCT_NO_READ],
    fallbackPermissionSet: 'acct_no_read',
});

describe('[#6649] a security-middleware refusal keeps its own status through the domain catch', () => {
    it('single posture: no allowRead on the object answers 403 PERMISSION_DENIED (was 500 + PERMISSION_DENIED)', async () => {
        const res = await mintOnDispatcher(noReadCaller('single'));

        // The pair, together. Before the fix `code` was ALREADY
        // `PERMISSION_DENIED` here — only the status was wrong — so a case
        // asserting the code alone was green on the defect, and one asserting
        // "not 500" alone could not tell a right refusal from a wrong one.
        expect(res.status).toBe(403);
        expect(expectDeclaredEnvelope(res).code).toBe('PERMISSION_DENIED');
        // Coverage, NOT a discriminator: the message does not move between the
        // two directions of this fix (the pre-fix 500 exited through this
        // harness's `error` double, which has no leak guard, and the security
        // message trips no clause of `looksLikeInternalErrorLeak` anyway). It
        // pins the refusal's own reason against a FUTURE widening of that
        // heuristic swallowing an authorization answer.
        //
        // [#7414] Re-spelled, not weakened. This used to read
        // `toContain('Access denied')`, which was the CRUD gate's developer
        // sentence; that sentence is now `developerMessage` (logged, not
        // shipped) and `message` is the user-facing catalog entry rendered in
        // `ExecutionContext.locale` — `en` here, since this caller declares no
        // locale. Asserted against the catalog constant rather than a literal so
        // a future copy edit does not need to re-spell this file, and still
        // proves the same thing: an authorization answer reached the client
        // instead of being swallowed into the generic internal-error string.
        expect(res.body.error.message).toBe(BUILTIN_OPERATION_MESSAGES.en.permission_denied);
    }, 30_000);

    it('group posture: the same denial, the same envelope — the defect was never posture-specific', async () => {
        const res = await mintOnDispatcher(noReadCaller('group'));

        expect(res.status).toBe(403);
        expect(expectDeclaredEnvelope(res).code).toBe('PERMISSION_DENIED');
    }, 30_000);

    it('the catch is shared, so list and revoke answer the refusal identically — the production class and a statusCode-only throw', async () => {
        // Driven with a service double, because what is under test here is the
        // CATCH, not a second trip through the middleware. Two throws: the REAL
        // `PermissionDeniedError`, and a `statusCode`-only twin of the shape that
        // class had until #21405. The class now carries `status` beside
        // `statusCode`, so it no longer reaches the catch's `statusCode` channel
        // by itself; the twin keeps that channel pinned.
        const throws = {
            production: () => new PermissionDeniedError(`[Security] Access denied: operation on object '${OBJECT}'`),
            statusCodeOnly: () => Object.assign(
                new Error(`[Security] Access denied: operation on object '${OBJECT}'`),
                { code: 'PERMISSION_DENIED', statusCode: 403 },
            ),
        };
        for (const [shape, thrown] of Object.entries(throws)) {
            for (const verb of ['GET', 'DELETE'] as const) {
                const res = await refusalFromService(thrown(), verb);
                expect(res.status, `${shape} ${verb} status`).toBe(403);
                expect(expectDeclaredEnvelope(res).code, `${shape} ${verb} code`).toBe('PERMISSION_DENIED');
            }
        }
    });

    it('a throw carrying neither channel still answers 500 — under the CATALOGUED code, not the unregistered `INTERNAL`', async () => {
        const res = await refusalFromService(new Error('share link storage exploded'));

        expect(res.status).toBe(500);
        // `'INTERNAL'` is registered in `ERROR_CODE_LEDGER` for `rest` /
        // `service-storage` / `service-i18n` / `plugin-sharing` — never for
        // `@objectstack/runtime`. The union dedupes, so the schema stayed green
        // while this domain emitted a code it had not registered; the shared
        // mapper answers with the derived `INTERNAL_ERROR` instead.
        expect(expectDeclaredEnvelope(res).code).toBe('INTERNAL_ERROR');
    });

    it('a refusal that DOES carry `status` is untouched — the fix widens the channel, it does not switch it', async () => {
        // Honest note: this case is green in BOTH directions of the fix, by
        // construction — `ShareLinkService.makeError` sets `status`, which the
        // old chain read first and the shared mapper reads first. It is not a
        // regression pin for #6649 but for the NEXT change to this exit: it goes
        // red if the `status` channel is ever dropped in favour of `statusCode`.
        const res = await refusalFromService(
            Object.assign(new Error('Sharing is not enabled for this object'), {
                status: 422,
                code: 'SHARING_NOT_ENABLED',
            }),
        );

        expect(res.status).toBe(422);
        expect(expectDeclaredEnvelope(res).code).toBe('SHARING_NOT_ENABLED');
    });
});

/**
 * [#14637] The DISPATCHER twin of the share-link route probe, gated on the
 * standing `publicSharing.enabled` policy.
 *
 * ## Why this pin lives here and not only in plugin-sharing
 *
 * The probe above `resolveToken` exists twice: once in
 * `plugin-sharing/src/share-link-routes.ts` and once in the domain under test
 * here. For cloud's per-environment kernels this one is the DESIGNED PRIMARY
 * surface (`registerShareLinkRoutes: false`, see this module's header), so a
 * fix landing only at the plugin site would not close the oracle — it would
 * move it to whichever embedding uses this one. That is why the maintainer's
 * ruling (2026-09-03, decision batch #17 item 1, verbatim 「同意」 — option A)
 * names both sites in one PR, and why both are pinned.
 *
 * ## What was wrong
 *
 * `resolveToken` refuses a link whose object has `publicSharing.enabled` off,
 * and refuses it with the undifferentiated `null` that revoked / expired /
 * unknown / ineligible tokens get, because a distinguishable "sharing is off
 * for this object" is an existence oracle for a caller who may hold nothing
 * but a token. This probe then answered from the ROW: a `password_hash` row
 * drew `401 NEEDS_PASSWORD` / `WRONG_PASSWORD`, an `audience: 'signed_in'` row
 * drew `401 SIGN_IN_REQUIRED`, and a revoked row on a switched-off object drew
 * `410 EXPIRED_OR_REVOKED` — three ways to tell a real-but-switched-off token
 * from an unknown one.
 *
 * ## What is asserted
 *
 * Byte-equality with the unknown-token answer, not merely "a 404": the claim is
 * that an anonymous holder cannot tell them apart, and only equality of the
 * whole answer says that. `JSON.stringify` equality sits beside `toEqual`
 * because key ORDER is part of what goes on the wire.
 *
 * Every case carries its reverse check — with the block ON the 401s and the
 * 410 are exactly what they were. Without it these pins would also pass
 * against a probe that answered 404 unconditionally, which is not the ruled
 * behaviour.
 *
 * REAL here: the domain body, `ShareLinkService`, and the ADR-0112 envelope
 * builder. DOUBLE: storage (`makeEngine` above, whose write verbs open with the
 * producers' own dispatch predicates) — deliberately WITHOUT `bootSecurity`,
 * since no verdict below depends on the middleware chain and the resolve route
 * reads under `SYSTEM_CTX` anyway.
 */
describe('[#14637] the dispatcher probe reads the standing policy before it answers from the row', () => {
    const SHARED_OBJECT = 'kb_article';
    const SHARED_RECORD = 'kb_1';
    const UNKNOWN_TOKEN = 'zzzzzzzzzzzzzzzzzzzzzz';

    /** The shareable object, with `signed_in` on the whitelist so that arm is mintable. */
    const shareableSchema = (enabled: boolean) => ({
        name: SHARED_OBJECT,
        fields: {
            id: { name: 'id' },
            title: { name: 'title' },
            owner_id: { name: 'owner_id' },
        },
        publicSharing: {
            enabled,
            allowedAudiences: ['link_only', 'signed_in'],
            allowedPermissions: ['view'],
        },
    });

    interface Harness {
        /** Drive `GET /share-links/:token/resolve` on the production domain body. */
        resolve(token: string, opts?: { password?: string; signedIn?: boolean }): Promise<{ status: number; body: any }>;
        /** Throw the object's switch, from outside the token's life. */
        switchOff(): void;
        /** Take the object's schema away entirely — the unanswerable-policy case. */
        forgetSchema(): void;
        mint(input: { audience?: 'link_only' | 'signed_in'; password?: string }): Promise<string>;
        revoke(token: string): Promise<void>;
        /** Let the token's own clock run out — the OTHER half of the same 410 arm. */
        expire(token: string): void;
    }

    async function harness(): Promise<Harness> {
        const schemas: Record<string, any> = { [SHARED_OBJECT]: shareableSchema(true) };
        const tables: Record<string, any[]> = {
            [SHARED_OBJECT]: [{ id: SHARED_RECORD, title: 'How to share', owner_id: USER }],
            sys_share_link: [],
        };
        const engine = makeEngine(tables, schemas);
        const svc = new ShareLinkService({ engine: engine as any });
        const deps = makeDeps(engine, svc);

        return {
            switchOff: () => { schemas[SHARED_OBJECT] = shareableSchema(false); },
            forgetSchema: () => { delete schemas[SHARED_OBJECT]; },
            mint: async ({ audience = 'link_only', password }) => {
                const link = await svc.createLink(
                    {
                        object: SHARED_OBJECT,
                        recordId: SHARED_RECORD,
                        audience,
                        permission: 'view',
                        ...(password ? { password } : {}),
                    },
                    envelopeFor({ memberOf: [ORG_A], permissions: ['acct_member'] }),
                );
                expect(link.token).toBeTruthy();
                return link.token;
            },
            revoke: async (token: string) => { await svc.revokeLink(token, { isSystem: true } as any); },
            // Stamped on the row rather than minted: `createLink` refuses a past
            // `expiresAt` outright (`422 EXPIRY_IN_PAST`), so back-dating the
            // stored row is the only way to reach an ALREADY-EXPIRED link — which
            // is exactly what the passage of time does to a live one.
            expire: (token: string) => {
                const row = (tables.sys_share_link ?? []).find((r) => r.token === token);
                if (!row) throw new Error('expire(): no sys_share_link row for that token');
                row.expires_at = new Date(Date.now() - 60_000).toISOString();
            },
            resolve: async (token, opts = {}) => {
                const res = await handleShareLinksRequest(
                    deps,
                    `/${token}/resolve`,
                    'GET',
                    undefined,
                    opts.password ? { password: opts.password } : {},
                    httpContext(
                        opts.signedIn
                            ? envelopeFor({ memberOf: [ORG_A], permissions: ['acct_member'] })
                            : undefined,
                    ),
                );
                if (!res.handled || !res.response) throw new Error('GET /share-links/:token/resolve was not handled');
                return res.response as { status: number; body: any };
            },
        };
    }

    /** The ruling's assertion: not "a 404" but the SAME answer a never-minted token gets. */
    function expectIndistinguishable(actual: { status: number; body: any }, unknown: { status: number; body: any }) {
        expect(actual).toEqual(unknown);
        // Byte-equality on the wire, key order included.
        expect(JSON.stringify(actual)).toBe(JSON.stringify(unknown));
        expect(actual.status).toBe(404);
        expect(actual.body?.error?.code).toBe('INVALID_OR_EXPIRED');
        const wire = JSON.stringify(actual.body).toLowerCase();
        expect(wire).not.toContain('publicsharing');
        expect(wire).not.toContain('sharing_not_enabled');
        expect(wire).not.toContain('password');
    }

    it('the `password_hash` shape — NEEDS_PASSWORD and WRONG_PASSWORD both become the unknown-token answer', async () => {
        const h = await harness();
        const token = await h.mint({ password: 'hunter2' });

        // Reverse check, on the same token: with the block ON the 401
        // affordance is exactly what it always was, in both arms.
        const needsOn = await h.resolve(token);
        expect(needsOn.status).toBe(401);
        expect(needsOn.body?.error?.code).toBe('NEEDS_PASSWORD');
        const wrongOn = await h.resolve(token, { password: 'not-it' });
        expect(wrongOn.status).toBe(401);
        expect(wrongOn.body?.error?.code).toBe('WRONG_PASSWORD');
        expect((await h.resolve(token, { password: 'hunter2' })).status).toBe(200);

        h.switchOff();
        const unknown = await h.resolve(UNKNOWN_TOKEN);

        expectIndistinguishable(await h.resolve(token), unknown);
        expectIndistinguishable(await h.resolve(token, { password: 'not-it' }), unknown);
        // THE SHARPEST EDGE: a CORRECT password on a switched-off link answered
        // `WRONG_PASSWORD` — both an oracle and a lie.
        expectIndistinguishable(await h.resolve(token, { password: 'hunter2' }), unknown);
    });

    it("the `audience: 'signed_in'` shape — SIGN_IN_REQUIRED becomes the unknown-token answer", async () => {
        const h = await harness();
        const token = await h.mint({ audience: 'signed_in' });

        // Reverse check: an anonymous caller is still told to sign in, a
        // signed-in one is still served.
        const on = await h.resolve(token);
        expect(on.status).toBe(401);
        expect(on.body?.error?.code).toBe('SIGN_IN_REQUIRED');
        expect((await h.resolve(token, { signedIn: true })).status).toBe(200);

        h.switchOff();
        expectIndistinguishable(await h.resolve(token), await h.resolve(UNKNOWN_TOKEN));
        // The signed-in caller loses it too — a standing policy, not an
        // authentication affordance.
        expectIndistinguishable(
            await h.resolve(token, { signedIn: true }),
            await h.resolve(UNKNOWN_TOKEN, { signedIn: true }),
        );
    });

    it('EVERY arm falls through, the 410 included — option C (gate only the two 401s) is not what shipped', async () => {
        const h = await harness();
        const token = await h.mint({});
        await h.revoke(token);

        // Reverse check: with the block ON the revoked bucket is untouched.
        const on = await h.resolve(token);
        expect(on.status).toBe(410);
        expect(on.body?.error?.code).toBe('EXPIRED_OR_REVOKED');

        h.switchOff();
        expectIndistinguishable(await h.resolve(token), await h.resolve(UNKNOWN_TOKEN));
    });

    it("the 410 arm's OTHER half — an EXPIRED link falls through too, not just a revoked one", async () => {
        const h = await harness();
        const token = await h.mint({});
        h.expire(token);

        // `revoked_at` and `expires_at` are two predicates reaching ONE arm
        // (`share-links.ts`: `row.revoked_at || (row.expires_at && …)`), so a
        // pin on the revoked half alone leaves the expired half free to keep
        // answering 410 on a switched-off object — the same oracle, reached by
        // the other predicate.
        //
        // Reverse check: with the block ON, an expired link is still 410.
        const on = await h.resolve(token);
        expect(on.status).toBe(410);
        expect(on.body?.error?.code).toBe('EXPIRED_OR_REVOKED');

        h.switchOff();
        expectIndistinguishable(await h.resolve(token), await h.resolve(UNKNOWN_TOKEN));
    });

    it('fail-closed: an object whose schema the engine cannot answer for is refused, not probed', async () => {
        const h = await harness();
        const token = await h.mint({ password: 'hunter2' });

        // Not "off" — GONE. `getPolicy` calls an unanswerable schema
        // `enabled: false`, and this probe reaches the same verdict rather than
        // falling back to the row.
        h.forgetSchema();

        expectIndistinguishable(await h.resolve(token, { password: 'hunter2' }), await h.resolve(UNKNOWN_TOKEN));
    });
});

/**
 * [#21405] The SAME refusal through the OTHER door.
 *
 * `/share-links` has two doors. This file's subject is the dispatcher domain;
 * `plugin-sharing`'s `registerShareLinkRoutes` is the other, and it is the one
 * that serves `/api/v1/share-links` on the standalone server (the dispatcher
 * plugin mounts no route for the path there). Both hand the caller's envelope
 * to `ShareLinkService`, so one caller and one request reach one refusal, and
 * the only thing left to differ is how each door's catch reads the throw's
 * status.
 *
 * They differed. The plugin door's catch reads `err?.status ?? 500`, and
 * `PermissionDeniedError` declared `statusCode = 403` with no `status`, so the
 * #6649 refusal below — the CRUD gate's denial on `createLink`'s visibility
 * read — answered 403 here and 500 there. Measured on a showcase boot as a
 * plain member, `POST /api/v1/share-links` on a record they cannot read: 500
 * `PERMISSION_DENIED` through the plugin door, 403 through this domain. The
 * ruled fix is in the class: `PermissionDeniedError` carries `status` beside
 * `statusCode`, as every sibling in `plugin-security/src/errors.ts` does, so
 * no door's catch changes.
 *
 * ## What is real here
 *
 * Both doors, their production entries: `registerShareLinkRoutes` mounted on a
 * route recorder, and `handleShareLinksRequest` over the dispatcher's own
 * `errorFromThrown`. ONE engine double with the WHOLE `SecurityPlugin`
 * middleware booted on it, ONE `ShareLinkService` over that engine, ONE
 * envelope — so the throw each door catches is the middleware's own
 * `PermissionDeniedError` from the same read, not a double's.
 *
 * ## Why create only
 *
 * The list's refusal (the member's read of `sys_share_link`) no longer
 * reaches either door: the member's own list became a self-scoped read
 * (#21328), and both doors force the creator filter to the caller. Measured on
 * the showcase boot after that change: `GET /share-links` answers 200 through
 * both doors.
 */

/** The smallest `IHttpServer` that keeps the handlers a registrar mounts. */
class RouteRecorder implements IHttpServer {
    readonly routes = new Map<string, RouteHandler>();
    get(path: string, handler: RouteHandler) { this.routes.set(`GET ${path}`, handler); }
    post(path: string, handler: RouteHandler) { this.routes.set(`POST ${path}`, handler); }
    put(path: string, handler: RouteHandler) { this.routes.set(`PUT ${path}`, handler); }
    delete(path: string, handler: RouteHandler) { this.routes.set(`DELETE ${path}`, handler); }
    patch(path: string, handler: RouteHandler) { this.routes.set(`PATCH ${path}`, handler); }
    use() { /* no middleware is mounted by the registrar under test */ }
    async listen() { /* never listens: handlers are driven in-process */ }
}

/** `POST /share-links` through the plugin door, with `envelope` as the resolved caller. */
async function mintOnPluginDoor(
    engine: any,
    svc: ShareLinkService,
    envelope: ExecutionContext,
    body: { object: string; recordId: string } = { object: OBJECT, recordId: RECORD },
): Promise<{ status: number; body: any }> {
    const http = new RouteRecorder();
    registerShareLinkRoutes(http, svc, engine, { contextFromRequest: () => envelope });
    const handler = http.routes.get('POST /api/v1/share-links');
    if (!handler) throw new Error('registerShareLinkRoutes mounted no POST /api/v1/share-links');
    const captured: { status: number; body: any } = { status: 200, body: undefined };
    const res: IHttpResponse = {
        json: (data: any) => { captured.body = data; },
        send: () => { /* the share-link routes answer JSON only */ },
        status: (code: number) => { captured.status = code; return res; },
        header: () => res,
    };
    const req: IHttpRequest = {
        params: {},
        query: {},
        body,
        headers: {},
        method: 'POST',
        path: '/api/v1/share-links',
    };
    await handler(req, res);
    return captured;
}

describe('[#21405] the plugin route door answers the same refusal with the same status', () => {
    for (const posture of ['single', 'group'] as const) {
        it(`${posture} posture: no allowRead on the object answers 403 PERMISSION_DENIED through BOTH doors`, async () => {
            const caller = noReadCaller(posture);
            const tables: Record<string, any[]> = {
                [OBJECT]: caller.records,
                sys_share_link: [],
                sys_permission_set: [],
            };
            const engine = makeEngine(tables);
            await bootSecurity(engine, posture, caller.permissionSets, caller.fallbackPermissionSet);
            const svc = new ShareLinkService({ engine: engine as any });

            const plugin = await mintOnPluginDoor(engine, svc, caller.envelope);
            const dispatched = await handleShareLinksRequest(
                makeDeps(engine, svc),
                '',
                'POST',
                { object: OBJECT, recordId: RECORD },
                {},
                httpContext(caller.envelope),
            );
            const dispatcher = dispatched.response as { status: number; body: any };

            expect(plugin.status, `plugin door: ${JSON.stringify(plugin.body)}`).toBe(403);
            expect(plugin.body).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
            expect(dispatcher.status, `dispatcher door: ${JSON.stringify(dispatcher.body)}`).toBe(403);
            expect(expectDeclaredEnvelope(dispatcher).code).toBe('PERMISSION_DENIED');
            // Neither refused mint wrote a link.
            expect(tables.sys_share_link).toEqual([]);
        }, 30_000);
    }
});

/**
 * [#21329 — ADR-0111 D8 rule 1, ruling 5950188467 (A′)] Who may mint a link on
 * an OWNER-PRIVATE object, read at BOTH doors.
 *
 * ## The object
 *
 * An analogue of the conversation object the card measured: `access.default:
 * 'private'` (ADR-0066 D2), so the member baseline's `'*'` wildcard grant does
 * not cover it and no member reads it through the data door; an `owner_id` the
 * owner holds; and the `publicSharing` opt-in. On it the visibility read
 * `createLink` runs refuses the OWNER too — the CRUD gate throws before any
 * row is looked at — so on the visibility rule alone the owner could never
 * share their own record.
 *
 * ## The ruled matrix
 *
 * "the owner mints on an owner-private object; a hierarchy manager without
 * visibility is refused; a non-owner member is refused; Modify-All mints" —
 * plus the anonymous resolve of the owner's link, which is what the mint is
 * for. Each refusal is read as the pair (`status`, `code`) and against the
 * STORE: a refused mint writes no row.
 *
 * ## The capability hard stop
 *
 * A second object is gated on a capability too (`requiredPermissions`,
 * ADR-0066 D3). An owner who lacks it is refused there: neither alternative
 * applies past that gate. The control is an owner who holds the capability and
 * is refused only by the CRUD grant, and mints.
 *
 * ## What is real here
 *
 * Both doors' production entries — the dispatcher domain body and the plugin's
 * `registerShareLinkRoutes` (via `mintOnPluginDoor` above) — over ONE link
 * service; the whole `SecurityPlugin` (its CRUD gate, its `hasWriteBypass` and
 * `resolveWriteScope` probes, booted over the same engine double); and the
 * whole `SharingServicePlugin`, booted with `registerShareLinkRoutes: false`,
 * the per-environment configuration for which the dispatcher domain is the
 * only share-link surface. The plugin composes the link service itself, so the
 * authority each case reaches is the production wiring, not a hand-assembled
 * copy of it. DOUBLES: storage (`makeEngine` above) and the enterprise
 * hierarchy resolver, which this open edition does not ship.
 */
describe('[#21329] mint authority on an owner-private object, at both doors (ruling A′)', () => {
    const CONV = 'ai_conversations';
    const CONV_ID = 'conv_1';
    const OWNER = 'u_owner';
    const STRANGER = 'u_stranger';
    const ADMIN = 'u_admin';
    const MANAGER = 'u_manager';
    /** Owns a record on the capability-gated object AND holds its capability. */
    const CAPABLE_OWNER = 'u_capable_owner';
    /** Owner-private AND capability-gated (ADR-0066 D3): a read needs `view_vault`. */
    const VAULT = 'vault_notes';

    const CONVERSATION_SCHEMA = {
        name: CONV,
        access: { default: 'private' },
        fields: {
            id: { name: 'id' },
            title: { name: 'title' },
            owner_id: { name: 'owner_id' },
        },
        publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
    };

    /** The member baseline: a `'*'` wildcard grant, the shape `member_default` has. */
    const MEMBER_BASELINE: PermissionSet = PermissionSetSchema.parse({
        name: 'conv_member_baseline',
        label: 'Member baseline (wildcard grant)',
        objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    });

    /** Modify All on the wildcard, which a private object honours (the super-user bits). */
    const MODIFY_ALL: PermissionSet = PermissionSetSchema.parse({
        name: 'conv_modify_all',
        label: 'Modify All',
        objects: {
            '*': {
                allowRead: true,
                allowCreate: true,
                allowEdit: true,
                allowDelete: true,
                viewAllRecords: true,
                modifyAllRecords: true,
            },
        },
    });

    /**
     * A hierarchy manager: WRITE depth `unit` on the object and no read grant —
     * a principal `canManageShares` admits (ADR-0111 D1 DEPTH) on a record the
     * data door will not let them read.
     */
    const UNIT_WRITER: PermissionSet = PermissionSetSchema.parse({
        name: 'conv_unit_writer',
        label: 'Unit-depth writer, no read',
        objects: { [CONV]: { allowEdit: true, writeScope: 'unit' } },
    });

    /** The object a capability gates, on top of being owner-private. */
    const VAULT_SCHEMA = {
        name: VAULT,
        access: { default: 'private' },
        requiredPermissions: ['view_vault'],
        fields: {
            id: { name: 'id' },
            title: { name: 'title' },
            owner_id: { name: 'owner_id' },
        },
        publicSharing: { enabled: true, allowedAudiences: ['link_only'], allowedPermissions: ['view'] },
    };

    /** The capability, and nothing else: no object grant rides with it. */
    const VAULT_CAPABLE: PermissionSet = PermissionSetSchema.parse({
        name: 'conv_vault_capable',
        label: 'Holds view_vault',
        objects: {},
        systemPermissions: ['view_vault'],
    });

    const SETS = [MEMBER_BASELINE, MODIFY_ALL, UNIT_WRITER, VAULT_CAPABLE];

    /** The envelope `resolveExecutionContext` assembles for a human member of org A. */
    const principal = (userId: string, permissions: string[]): ExecutionContext =>
        ({
            userId,
            tenantId: ORG_A,
            email: `${userId}@example.com`,
            isSystem: false,
            principalKind: 'human',
            posture: 'MEMBER',
            positions: [],
            permissions,
            systemPermissions: [],
            org_user_ids: [userId],
            accessible_org_ids: [ORG_A],
        }) as unknown as ExecutionContext;

    const owner = () => principal(OWNER, ['conv_member_baseline']);
    const stranger = () => principal(STRANGER, ['conv_member_baseline']);
    const admin = () => principal(ADMIN, ['conv_member_baseline', 'conv_modify_all']);
    const manager = () => principal(MANAGER, ['conv_member_baseline', 'conv_unit_writer']);
    const capableOwner = () => principal(CAPABLE_OWNER, ['conv_member_baseline', 'conv_vault_capable']);

    interface World {
        tables: Record<string, any[]>;
        sharing: any;
        mint(as: ExecutionContext): Promise<{ status: number; body: any }>;
        /** The same mint through the plugin's route door. */
        mintOnPlugin(as: ExecutionContext): Promise<{ status: number; body: any }>;
        /** The same mint on the capability-gated object, at each door. */
        mintVault(recordId: string, as: ExecutionContext): Promise<{ status: number; body: any }>;
        mintVaultOnPlugin(recordId: string, as: ExecutionContext): Promise<{ status: number; body: any }>;
        /** A data-door read of a vault record under `as`. */
        readVault(recordId: string, as: ExecutionContext): Promise<unknown>;
        resolve(token: string): Promise<{ status: number; body: any }>;
        revoke(idOrToken: string, as: ExecutionContext): Promise<{ status: number; body: any }>;
        /** A data-door read of the record under `as` — the visibility leg itself. */
        read(as: ExecutionContext): Promise<unknown>;
        resolveWriteScopeCalls(): number;
    }

    async function bootWorld(): Promise<World> {
        const tables: Record<string, any[]> = {
            [CONV]: [{ id: CONV_ID, title: 'My chat', owner_id: OWNER, organization_id: ORG_A }],
            [VAULT]: [
                { id: 'vault_owner', title: 'Owner\'s note', owner_id: OWNER, organization_id: ORG_A },
                { id: 'vault_capable', title: 'Capable owner\'s note', owner_id: CAPABLE_OWNER, organization_id: ORG_A },
            ],
            sys_share_link: [],
            sys_permission_set: [],
        };
        const engine = makeEngine(tables, { [CONV]: CONVERSATION_SCHEMA, [VAULT]: VAULT_SCHEMA });
        const services: Record<string, any> = {
            manifest: { register: vi.fn() },
            objectql: engine,
            metadata: { get: async () => null, list: async () => SETS },
            // Cloud's topology: one database per environment, no organization wall.
            tenancy: { posture: 'single' },
            // The enterprise seam, doubled: the manager's `unit` covers the owner.
            'hierarchy-scope-resolver': {
                resolveOwnerIds: async (c: any, scope: string) =>
                    c?.userId === MANAGER && scope === 'unit' ? [MANAGER, OWNER] : [String(c?.userId)],
            },
        };
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const getService = (name: string) => {
            if (name in services) return services[name];
            throw new Error(`service not registered: ${name}`);
        };
        const registerService = (name: string, service: unknown) => { services[name] = service; };

        const securityCtx: any = { logger, hook: vi.fn(), registerService, getService };
        const security = new SecurityPlugin({
            defaultPermissionSets: SETS,
            fallbackPermissionSet: 'conv_member_baseline',
        });
        await security.init(securityCtx);
        await security.start(securityCtx);

        // Count the DEPTH probe, so a mint that consults it is visible.
        let writeScopeCalls = 0;
        const realResolveWriteScope = services.security.resolveWriteScope.bind(services.security);
        services.security.resolveWriteScope = (...args: unknown[]) => {
            writeScopeCalls += 1;
            return realResolveWriteScope(...args);
        };

        const hooks: Record<string, Array<() => Promise<void> | void>> = {};
        const sharingCtx: any = {
            logger,
            hook: (event: string, handler: () => Promise<void> | void) => { (hooks[event] ??= []).push(handler); },
            registerService,
            getService,
        };
        const plugin = new SharingServicePlugin({ enforce: false, registerShareLinkRoutes: false });
        await plugin.init(sharingCtx);
        await plugin.start(sharingCtx);
        for (const handler of hooks['kernel:ready'] ?? []) await handler();

        const svc = services[SHARE_LINK_SERVICE];
        if (!svc) throw new Error('the sharing plugin registered no share-link service');
        const deps = makeDeps(engine, svc);
        const drive = async (
            subPath: string,
            method: string,
            body: unknown,
            as: ExecutionContext | undefined,
        ): Promise<{ status: number; body: any }> => {
            const res = await handleShareLinksRequest(deps, subPath, method, body, {}, httpContext(as));
            if (!res.handled || !res.response) throw new Error(`${method} /share-links${subPath} was not handled`);
            return res.response as { status: number; body: any };
        };

        return {
            tables,
            sharing: services.sharing,
            mint: (as) => drive('', 'POST', { object: CONV, recordId: CONV_ID }, as),
            mintOnPlugin: (as) => mintOnPluginDoor(engine, svc, as, { object: CONV, recordId: CONV_ID }),
            mintVault: (recordId, as) => drive('', 'POST', { object: VAULT, recordId }, as),
            mintVaultOnPlugin: (recordId, as) => mintOnPluginDoor(engine, svc, as, { object: VAULT, recordId }),
            readVault: async (recordId, as) => engine.find(VAULT, { where: { id: recordId }, limit: 1, context: as }),
            resolve: (token) => drive(`/${token}/resolve`, 'GET', undefined, undefined),
            revoke: (idOrToken, as) => drive(`/${idOrToken}`, 'DELETE', undefined, as),
            read: async (as) => engine.find(CONV, { where: { id: CONV_ID }, limit: 1, context: as }),
            resolveWriteScopeCalls: () => writeScopeCalls,
        };
    }

    it('[persona] the object is owner-private: the owner\'s own data-door read is refused at the CRUD gate', async () => {
        const w = await bootWorld();
        // The visibility leg is CLOSED for the owner — without this, a 201 below
        // would prove nothing about the owner branch.
        await expect(w.read(owner())).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
        await expect(w.read(stranger())).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
        await expect(w.read(manager())).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
        // The Modify-All holder reads it: the super-user bits are honoured on a private object.
        expect(await w.read(admin())).toHaveLength(1);
    }, 30_000);

    it('[owner] the owner mints a link on their own record at both doors, and an anonymous holder resolves it', async () => {
        const w = await bootWorld();
        const res = await w.mint(owner());
        const plugin = await w.mintOnPlugin(owner());

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data).toMatchObject({ object_name: CONV, record_id: CONV_ID, created_by: OWNER });
        expect(plugin.status, JSON.stringify(plugin.body)).toBe(201);
        expect(plugin.body.data).toMatchObject({ object_name: CONV, record_id: CONV_ID, created_by: OWNER });
        expect(w.tables.sys_share_link.map((r) => r.created_by)).toEqual([OWNER, OWNER]);

        const resolved = await w.resolve(String(res.body.data.token));
        expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
        expect(resolved.body.data.record).toMatchObject({ id: CONV_ID, title: 'My chat' });
    }, 30_000);

    it('[stranger] a non-owner member is refused with the visibility read\'s own refusal at both doors, and nothing lands', async () => {
        const w = await bootWorld();
        const res = await w.mint(stranger());
        const plugin = await w.mintOnPlugin(stranger());

        expect(res.status).toBe(403);
        expect(expectDeclaredEnvelope(res).code).toBe('PERMISSION_DENIED');
        expect(plugin.status, JSON.stringify(plugin.body)).toBe(403);
        expect(plugin.body).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
        expect(w.tables.sys_share_link).toEqual([]);
    }, 30_000);

    it('[modify-all] a Modify-All holder mints at both doors', async () => {
        const w = await bootWorld();
        const res = await w.mint(admin());
        const plugin = await w.mintOnPlugin(admin());

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data).toMatchObject({ object_name: CONV, record_id: CONV_ID, created_by: ADMIN });
        expect(plugin.status, JSON.stringify(plugin.body)).toBe(201);
        expect(w.tables.sys_share_link.map((r) => r.created_by)).toEqual([ADMIN, ADMIN]);
    }, 30_000);

    it('[manager] a hierarchy manager without visibility is refused, though they ARE a share-manager of the record', async () => {
        const w = await bootWorld();

        // The control: this principal holds ADR-0111 D1 DEPTH authority over the
        // record. Without it the refusal below could be "not a manager at all".
        expect(await w.sharing.canManageShares(CONV, CONV_ID, manager())).toBe(true);
        const callsBefore = w.resolveWriteScopeCalls();

        const res = await w.mint(manager());
        const plugin = await w.mintOnPlugin(manager());
        expect(res.status).toBe(403);
        expect(expectDeclaredEnvelope(res).code).toBe('PERMISSION_DENIED');
        expect(plugin.status, JSON.stringify(plugin.body)).toBe(403);
        expect(plugin.body).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
        expect(w.tables.sys_share_link).toEqual([]);
        // The DEPTH branch is not part of mint authority at all: minting never
        // asked for the caller's write scope.
        expect(w.resolveWriteScopeCalls(), 'the mint consulted the hierarchy-depth probe').toBe(callsBefore);

        // ...while their revoke authority over the record (D8 rule 2) stands.
        const minted = await w.mint(owner());
        expect(minted.status, JSON.stringify(minted.body)).toBe(201);
        const revoked = await w.revoke(String(minted.body.data.id), manager());
        expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
        expect(w.tables.sys_share_link[0]?.revoked_at).toBeTruthy();
    }, 30_000);
    it('[capability persona] the vault refuses the owner at the CAPABILITY gate, and the capable owner only at the CRUD grant', async () => {
        const w = await bootWorld();
        const ownerRead = await w.readVault('vault_owner', owner()).then(() => null, (e) => e);
        expect(ownerRead).toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
        expect(ownerRead?.details?.missingPermissions, 'the owner lacks view_vault').toEqual(['view_vault']);
        const capableRead = await w.readVault('vault_capable', capableOwner()).then(() => null, (e) => e);
        expect(capableRead).toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
        expect(capableRead?.details?.missingPermissions, 'the capable owner is refused by the CRUD grant, not the capability').toBeUndefined();
    }, 30_000);

    it('[capability] an owner lacking the object\'s required capability is refused with that refusal at both doors, and nothing lands', async () => {
        const w = await bootWorld();
        const res = await w.mintVault('vault_owner', owner());
        const plugin = await w.mintVaultOnPlugin('vault_owner', owner());

        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(expectDeclaredEnvelope(res).code).toBe('PERMISSION_DENIED');
        // The wire carries the refusal's user-facing sentence only — which gate
        // refused (the capability's `missingPermissions`) stays off the wire, so
        // that half is pinned beside the service, on the rejection itself.
        expect(res.body.error.message).toBe(BUILTIN_OPERATION_MESSAGES.en.permission_denied);
        expect(plugin.status, JSON.stringify(plugin.body)).toBe(403);
        expect(plugin.body).toMatchObject({ success: false, error: { code: 'PERMISSION_DENIED' } });
        expect(w.tables.sys_share_link).toEqual([]);
        // The owner alternative itself holds; the hard stop is what refused.
        expect(await w.sharing.canManageShares(VAULT, 'vault_owner', owner())).toBe(true);
    }, 30_000);

    it('[capability control] the owner who HOLDS the capability mints on the same object at both doors', async () => {
        const w = await bootWorld();
        const res = await w.mintVault('vault_capable', capableOwner());
        const plugin = await w.mintVaultOnPlugin('vault_capable', capableOwner());

        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(plugin.status, JSON.stringify(plugin.body)).toBe(201);
        expect(w.tables.sys_share_link.map((r) => r.created_by)).toEqual([CAPABLE_OWNER, CAPABLE_OWNER]);
    }, 30_000);
});
