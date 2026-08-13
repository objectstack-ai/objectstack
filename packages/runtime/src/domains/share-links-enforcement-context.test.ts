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
import { PermissionDeniedError, SecurityPlugin } from '@objectstack/plugin-security';
import { ShareLinkService } from '@objectstack/plugin-sharing';
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
 * middleware throws `PermissionDeniedError` — the `statusCode`-only shape whose
 * status the domain used to drop.
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

    it('the catch is shared, so list and revoke answer the statusCode-only refusal identically', async () => {
        // Driven with a service double raising the REAL `PermissionDeniedError`
        // (the production class, `statusCode` and no `status`), because what is
        // under test here is the CATCH, not a second trip through the middleware.
        for (const verb of ['GET', 'DELETE'] as const) {
            const res = await refusalFromService(
                new PermissionDeniedError(`[Security] Access denied: operation on object '${OBJECT}'`),
                verb,
            );
            expect(res.status, `${verb} status`).toBe(403);
            expect(expectDeclaredEnvelope(res).code, `${verb} code`).toBe('PERMISSION_DENIED');
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
