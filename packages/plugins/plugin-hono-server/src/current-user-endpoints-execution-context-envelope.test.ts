// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15747 — the current-user faces assemble their `ExecutionContext` through the
// SHARED assembler, not a hand-rolled literal.
//
// `makeExecutionContextResolver` built the envelope for all three current-user
// routes as an object literal cast `as any`. `assembleExecutionContext`
// (@objectstack/core) exists precisely to make that shape unrepresentable — it
// CLOSES the field set with a type, so a transport entry point cannot silently
// omit a field — and the resolver sat beside it omitting six of them:
//
//     principalKind · onBehalfOf · audience · accessToken · authGate · oauthScopes
//
// (`locale` / `timezone` / `currency` were the seventh through ninth. #15387
// repaired those AT THE ENDPOINT — `/auth/me/localization` reads the
// localization cascade itself and no longer reads them off this envelope at
// all — so they are withheld here on the record rather than resolved twice.)
//
// ## What these cases measure, and why each is not vacuous
//
// The envelope is handed to exactly ONE consumer on these faces:
// `ISecurityService.resolvePermissionSetsForContext`. So the tests capture the
// context that ARRIVES there — the same instrumentation #6071 used on the REST
// face (`packages/rest/src/rest-exec-ctx-principal-kind.test.ts`) — through the
// REAL registered routes, driven with `app.request()`. Nothing here mocks the
// resolver.
//
// ⚠️ An assertion that `principalKind` is merely PRESENT would be close to
// vacuous: its only reachable reader on these faces is the security plugin's
// `const isAgent = context?.principalKind === 'agent'`, and `undefined` and
// `'human'` are indistinguishable there. So the cases assert the two things
// that genuinely differ:
//
//   1. the envelope's KEY SET equals the shared assembler's output exactly —
//      which fails both when a field is omitted and when one is over-filled;
//   2. `'agent'` is UNREACHABLE on this face — the load-bearing leg of the
//      card's LATENT grade, pinned so that acquiring an OAuth door here turns
//      it red instead of silently promoting the hazard to a live defect.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { assembleExecutionContext, resolveUserAuthzGrants, ENTRY_EXECUTION_CONTEXT_FIELDS } from '@objectstack/core';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const ME_LOCALIZATION = '/api/v1/auth/me/localization';
const ME_APPS = '/api/v1/me/apps';

const USER = 'usr_member';
const EMAIL = 'member@example.com';
const ACTIVE_ORG = 'org_active';
const GRANTED = 'showcase_ops';

type Row = Record<string, any>;

/** The sets the `security` service hands back — whole, as the contract publishes them. */
const RESOLVED = [
    {
        name: GRANTED,
        label: 'Showcase Ops',
        systemPermissions: ['showcase.export_data'],
        tabPermissions: { exports: 'visible' },
        objects: { showcase_order: { allowRead: true, allowEdit: true } },
        fields: { 'showcase_order.total': { readable: true, editable: true } },
    },
];

const APPS = [
    { name: 'exports', requiredPermissions: ['showcase.export_data'] },
    { name: 'open', requiredPermissions: [] },
];

/** `where` matcher: scalar equality plus the `$in` form the resolver sends. */
function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([key, cond]) => {
        // REFUSE an unsupported combinator rather than reading it as a field
        // name — a silent `false` would look exactly like a row that did not
        // match, and a case would pass for the wrong reason.
        if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
        const value = row[key] ?? null;
        if (cond && typeof cond === 'object' && Array.isArray((cond as any).$in)) {
            return (cond as any).$in.includes(value);
        }
        return value === (cond ?? null);
    });
}

const TABLES: Record<string, Row[]> = {
    sys_user: [{ id: USER, email: EMAIL }],
    sys_member: [{ user_id: USER, organization_id: ACTIVE_ORG, role: 'member' }],
    sys_user_position: [],
    sys_user_permission_set: [
        { id: 'ups1', user_id: USER, permission_set_id: 'ps_ops', organization_id: ACTIVE_ORG },
    ],
    sys_position: [],
    sys_position_permission_set: [],
    sys_permission_set: [{ id: 'ps_ops', name: GRANTED }],
};

const makeQl = () => ({
    find: async (object: string, opts: any) => {
        const rows = (TABLES[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    registry: { getAllApps: () => APPS, getAllObjects: () => [] },
    getSchema: () => undefined,
});

/**
 * Mount the REAL routes on a REAL Hono app.
 *
 * @param authHeaders headers the request presents (the OAuth-door case sends a
 *   JWT-shaped bearer here).
 */
function mount() {
    /** Every context that ARRIVED at the one consumer, in call order. */
    const seen: any[] = [];
    /**
     * The OAuth verifier the `/mcp` door calls
     * (`resolve-execution-context.ts` → `authService.verifyMcpAccessToken`).
     * Present on the service so that "this face never calls it" is a MEASURED
     * absence rather than an absent method that could never have been called.
     */
    const verifyMcpAccessToken = vi.fn(async () => ({
        userId: USER,
        scopes: ['data:read', 'actions:execute'],
        clientId: 'cli_agent_1',
    }));

    const services: Record<string, unknown> = {
        auth: {
            verifyMcpAccessToken,
            api: {
                getSession: async () => ({
                    user: { id: USER, email: EMAIL },
                    session: { activeOrganizationId: ACTIVE_ORG },
                }),
            },
        },
        objectql: makeQl(),
        metadata: { list: async () => [] as unknown[] },
        security: {
            resolvePermissionSetsForContext: async (context: any) => {
                seen.push(context);
                return RESOLVED;
            },
        },
    };

    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn() {} },
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    return { app, seen, verifyMcpAccessToken };
}

const get = (app: any, path: string, headers?: Record<string, string>) =>
    app.request(`http://localhost${path}`, headers ? { headers } : undefined);

/**
 * The envelope the SHARED assembler produces for this fixture's principal —
 * the reference these faces must agree with. Built from the same
 * `ResolvedAuthzContext` the resolver resolves, with every per-face divergence
 * passed explicitly, exactly as the resolver passes it.
 */
const reference = async () =>
    assembleExecutionContext({
        // The SAME grant resolution the faces run — `resolveUserAuthzGrants` is
        // shared INPUT, not the subject. What is under test is the ASSEMBLY
        // step after it, which is the step that was hand-rolled.
        authz: {
            ...(await resolveUserAuthzGrants(makeQl(), USER, { tenantId: ACTIVE_ORG })),
            userId: USER,
            tenantId: ACTIVE_ORG,
        },
        oauth: undefined,
        localization: undefined,
        requestLocale: undefined,
        accessToken: undefined,
        authGate: undefined,
    })!;

describe('[#15747] the current-user faces assemble through the shared assembler', () => {
    it('/auth/me/permissions hands its consumer the assembler-shaped envelope', async () => {
        const { app, seen } = mount();
        await get(app, ME_PERMISSIONS);

        expect(seen).toHaveLength(1);
        // THE measurement. Before the repair the literal emitted 11 keys and
        // `principalKind` was not among them; the assembler emits the closed
        // set minus the fields withheld on the record.
        expect(Object.keys(seen[0]).sort()).toEqual(Object.keys(await reference()).sort());
    });

    it('/me/apps hands its consumer the SAME envelope shape', async () => {
        const { app, seen } = mount();
        await get(app, ME_APPS);

        expect(seen).toHaveLength(1);
        expect(Object.keys(seen[0]).sort()).toEqual(Object.keys(await reference()).sort());
    });

    it('every key the faces emit belongs to the closed entry set', async () => {
        const { app, seen } = mount();
        await get(app, ME_PERMISSIONS);

        const closed = new Set<string>(ENTRY_EXECUTION_CONTEXT_FIELDS as readonly string[]);
        expect(Object.keys(seen[0]).filter((k) => !closed.has(k))).toEqual([]);
    });

    it('the principal is a HUMAN, and the six omitted fields are decided rather than dropped', async () => {
        const { app, seen } = mount();
        await get(app, ME_PERMISSIONS);
        const ctx = seen[0];

        // The one omitted field with a live downstream reader
        // (`plugin-security`: `context?.principalKind === 'agent'`).
        expect(ctx.principalKind).toBe('human');
        // The other five: WITHHELD on this face, and `emit()` drops an
        // `undefined` decision — so their absence is now the assembler's
        // recorded answer rather than a hand-rolled omission. Asserted
        // together with the key-set equality above, which is what makes this
        // pair a statement about the whole set rather than about six names.
        for (const field of ['onBehalfOf', 'audience', 'accessToken', 'authGate', 'oauthScopes']) {
            expect(ctx[field]).toBeUndefined();
        }
    });

    // ⭐ The card's LATENT grade rests on exactly this: `principalKind` is read
    // downstream ONLY to test for `'agent'`, and an agent principal requires an
    // OAuth access token naming an authorized client — which the shared
    // assembler produces from its `oauth` input, and which reaches it from the
    // `/mcp` dispatch door ALONE (`acceptOAuthAccessToken`). This face resolves
    // its principal from the better-auth SESSION and never opens that door.
    //
    // If this case ever goes red, the grade has flipped: an absent
    // `principalKind` would then be reachable as something other than 'human'
    // and the omission becomes a live, security-relevant defect.
    it('an OAuth-shaped bearer cannot produce an AGENT principal on this face', async () => {
        const { app, seen, verifyMcpAccessToken } = mount();
        await get(app, ME_PERMISSIONS, {
            authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig',
        });

        // The face never consults the OAuth verifier — the method is on the
        // service and would have answered an agent principal had it been asked.
        expect(verifyMcpAccessToken).not.toHaveBeenCalled();
        expect(seen[0].principalKind).toBe('human');
        expect(seen[0].onBehalfOf).toBeUndefined();
        expect(seen[0].oauthScopes).toBeUndefined();
    });

    // The blast radius #15387 declined to take on: converting the resolver
    // changes the envelope handed to /auth/me/permissions and /me/apps too.
    // These three cases are the before/after on each face's WIRE.
    it('/auth/me/permissions answers the same body', async () => {
        const { app } = mount();
        expect(await (await get(app, ME_PERMISSIONS)).json()).toEqual({
            authenticated: true,
            userId: USER,
            tenantId: ACTIVE_ORG,
            // The MEASURED before-state, not a guess: org membership folds
            // to `org_member` and the ADR-0090 D5 `everyone` anchor is
            // implicit. Recorded here so the after-run asserts identity with
            // what this face answered before the conversion.
            positions: ['org_member', 'everyone'],
            permissionSets: [GRANTED],
            objects: { showcase_order: { allowRead: true, allowEdit: true } },
            fields: { 'showcase_order.total': { readable: true, editable: true } },
            systemPermissions: ['showcase.export_data'],
            tabPermissions: { exports: 'visible' },
        });
    });

    it('/me/apps answers the same body', async () => {
        const { app } = mount();
        expect(await (await get(app, ME_APPS)).json()).toEqual({
            apps: [{ name: 'exports', requiredPermissions: ['showcase.export_data'] }, { name: 'open', requiredPermissions: [] }],
        });
    });

    it('/auth/me/localization answers the same body', async () => {
        const { app } = mount();
        // Reads the localization cascade itself since #15387 — it consults the
        // envelope for `userId` / `tenantId` and nothing else, so converting
        // the resolver must leave this wire untouched.
        expect(await (await get(app, ME_LOCALIZATION)).json()).toEqual({
            authenticated: true,
            currency: null,
            locale: 'en-US',
            timezone: 'UTC',
        });
    });

    it('an unauthenticated request still reaches no consumer at all', async () => {
        // The fail-closed half: `assembleExecutionContext` answers `undefined`
        // for a principal-less authz context, and these faces answered
        // `{authenticated:false}` / `{apps:[]}` before it. Both must hold, or
        // the conversion would have turned a 'no session' answer into a guest
        // ENVELOPE reaching enforcement — the thing
        // `assembleExecutionContextOrGuest` is the named entry for, and which
        // this face deliberately does NOT adopt.
        const seen: any[] = [];
        const services: Record<string, unknown> = {
            auth: { api: { getSession: async () => undefined } },
            objectql: makeQl(),
            metadata: { list: async () => [] as unknown[] },
            security: {
                resolvePermissionSetsForContext: async (context: any) => {
                    seen.push(context);
                    return RESOLVED;
                },
            },
        };
        const app = new Hono();
        registerCurrentUserEndpoints({
            rawApp: app,
            ctx: {
                logger: { debug() {}, warn() {} },
                getService: <T,>(name: string): T => {
                    if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                    return services[name] as T;
                },
            },
        });

        expect(await (await get(app, ME_PERMISSIONS)).json()).toEqual({ authenticated: false });
        expect(await (await get(app, ME_APPS)).json()).toEqual({ apps: [] });
        expect(seen).toEqual([]);
    });
});
