// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Current-user endpoints — `/auth/me/permissions`, `/auth/me/localization` and
 * `/me/apps` — plus the session → `ExecutionContext` resolver and the
 * permission-map shaping they need.
 *
 * ## Why this is its own module (and its own export)
 *
 * These three are the platform's SOLE supply: `packages/rest` and
 * `packages/runtime` register no `/me/*` route at all, the objectui console
 * reads `/auth/me/permissions` for its whole permission layer and
 * `/auth/me/localization` for regional defaults, and `core`'s auth gate
 * allow-lists `/me/apps` + `/me/localization` as endpoints a gated user MUST
 * still reach to bootstrap the remediation UI. #4079 lifted them out from under
 * `registerStandardEndpoints`, which also gated a DUPLICATE `/data` CRUD +
 * discovery surface, so that flag could not take the console down with it. That
 * surface and the flag have since been deleted (#4073); these three are all the
 * plugin serves beyond the socket.
 *
 * That split fixed the flag but left the supply still welded to
 * {@link HonoServerPlugin}: a host that stands up a bare {@link HonoHttpServer}
 * instead of mounting the plugin — which is exactly what cloud's Vercel /
 * serverless entrypoints do, while their `OS_NODE_SERVE=1` sibling mounts the
 * real plugin — got no provider at all, and the console's FLS / `apiOperations`
 * had no server-side answer on that path (cloud#924). Registration is a
 * function of a Hono app plus a service locator, not of owning the socket, so it
 * lives here and both shapes call the same one.
 *
 * {@link registerCurrentUserEndpoints} is idempotent: a host may call it eagerly
 * on its raw app AND mount the plugin, and the plugin's own `kernel:ready`
 * registration then finds the routes present and skips rather than shadowing
 * them with dead duplicates. Registration order is the only route precedence
 * Hono has (first registration wins), and it is load-bearing here — plugin-auth
 * (and cloud's `AuthProxyPlugin`) mount a `/api/v1/auth/*` wildcard that
 * `/auth/me/*` must be registered ahead of to win the match without a wasted
 * round-trip to an auth service that does not implement these paths.
 */

import { IDataEngine, derivePosture } from '@objectstack/core';
import { ADMIN_FULL_ACCESS, ORGANIZATION_ADMIN_GRANTS } from '@objectstack/spec';
import {
    resolveEffectiveApiMethods,
    effectiveOperationsArray,
    type EnableLike,
} from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { Logger } from '@objectstack/spec/contracts';
import { allowPerfDisclosure, isPerfDisclosurePrincipal } from '@objectstack/observability';

/** API prefix these endpoints mount under unless the host overrides it. */
export const DEFAULT_CURRENT_USER_PREFIX = '/api/v1';

/**
 * The service locator + logger the current-user endpoints resolve their answer
 * from. A `PluginContext` satisfies this structurally, so the plugin passes its
 * own context unchanged; a host outside the plugin lifecycle (cloud's
 * serverless entrypoints) passes a thin adapter over its kernel.
 *
 * `getService` may return `undefined` for an absent service — every service
 * these endpoints read is optional, and each read has a defined degraded answer
 * (see the handlers). A locator that THROWS instead is equally accepted: the
 * reads are wrapped, exactly as they were when `PluginContext.getService` (which
 * throws) was the only caller.
 */
export interface CurrentUserEndpointsContext {
    getService<T>(name: string): T | undefined;
    logger?: Partial<Pick<Logger, 'debug' | 'warn'>>;
    /**
     * The kernel this locator reads from. Optional, and used for ONE thing: it
     * is the `defaultKernel` argument the host's `kernel-resolver` seam takes
     * (see {@link resolveRequestContext}). `PluginContext.getKernel` satisfies
     * it; a host adapter should supply it too. Without it a multi-tenant host
     * cannot be asked which kernel owns the request, and these endpoints answer
     * from `getService` — which on such a host is the wrong kernel (#927 is the
     * cloud-side record of that failure), so omitting it is a downgrade, not a
     * neutral choice.
     */
    getKernel?(): unknown;
}

/**
 * Minimal shape of the host's ADR-0006 kernel-resolution seam, as registered
 * under the `kernel-resolver` service name. Structurally the framework's
 * `KernelResolver` (`@objectstack/runtime`), declared here rather than imported
 * so this package keeps no runtime dependency on the dispatcher.
 */
export interface KernelResolverLike {
    resolveKernel(
        context: { request: { headers: unknown }; routePath?: string; environmentId?: string },
        defaultKernel: unknown,
    ): Promise<unknown | undefined> | unknown | undefined;
}

/** Options for {@link registerCurrentUserEndpoints}. */
export interface RegisterCurrentUserEndpointsOptions {
    /**
     * The raw Hono app to register on. Routes go on the raw app (not through
     * `IHttpServer`'s verb methods) because that is where the `/api/v1/auth/*`
     * wildcards they must outrank are mounted.
     */
    rawApp: any;
    /** Service locator + logger — see {@link CurrentUserEndpointsContext}. */
    ctx: CurrentUserEndpointsContext;
    /** API prefix. @default '/api/v1' */
    prefix?: string;
}

/** Body returned when the request's environment kernel cannot be reached. */
const ENVIRONMENT_UNAVAILABLE = {
    error: 'environment_unavailable',
    message: 'The environment serving this request is not available yet. Retry shortly.',
} as const;

/** A locator over an arbitrary kernel, for the per-request resolution below. */
function contextForKernel(kernel: any, from: CurrentUserEndpointsContext): CurrentUserEndpointsContext {
    return {
        // Sync `getService`, like every other read on this surface. Per-environment
        // kernels register `auth` / `objectql` / `metadata` /
        // `security.permissions` as INSTANCES (their plugins register them in
        // `init()`), so they are in the service map by the time a request arrives.
        getService: <T>(name: string): T | undefined => kernel?.getService?.(name) as T | undefined,
        logger: from.logger,
        getKernel: () => kernel,
    };
}

/**
 * Which kernel's services answer THIS request.
 *
 * Single-environment hosts register no `kernel-resolver` and are unchanged: the
 * registration-time locator is the answer. On a MULTI-TENANT host the seam is
 * the whole point — identity lives on the per-environment kernel (cloud's
 * `ArtifactKernelFactory` mounts `AuthPlugin` per environment; its host kernel is
 * a routing shell with no `auth` at all), so resolving against the host kernel
 * reports `{authenticated:false}` for every real caller and the console's
 * permission layer silently falls open. The dispatcher has consulted this seam
 * since ADR-0006 Phase 5; these three endpoints not consulting it was the defect
 * (#927).
 *
 * Resolution is LAZY — the service is read per request, never captured at
 * registration — because a host may register these routes before
 * `kernel.bootstrap()` (to outrank an auth wildcard), which is before the plugin
 * that registers the resolver has run its `init()`.
 *
 * Four outcomes, and the two failure ones are deliberate:
 *   - no resolver (or no `getKernel`) → the registration-time locator.
 *   - a kernel → that kernel's services. THE fix.
 *   - `undefined` → the registration-time locator. That is the seam's contract
 *     for "unscoped / control-plane / single-environment request", and on such a
 *     host the default kernel really is the right answer.
 *   - a throw → **no answer at all**, surfaced as the thrown status when it
 *     carries one (cloud's `KernelWarmingError` is a 503 + `Retry-After`) else
 *     503. Falling back to the default kernel here would hand back a
 *     confidently-wrong `{authenticated:false}`, which the client reads as
 *     "anonymous" and fails OPEN on — strictly worse than a retryable error.
 */
async function resolveRequestContext(
    c: any,
    ctx: CurrentUserEndpointsContext,
    prefix: string,
): Promise<{ ctx: CurrentUserEndpointsContext } | { response: Response }> {
    const resolver = (() => {
        try { return ctx.getService<KernelResolverLike>('kernel-resolver'); } catch { return undefined; }
    })();
    if (typeof resolver?.resolveKernel !== 'function' || typeof ctx.getKernel !== 'function') {
        return { ctx };
    }
    const defaultKernel = ctx.getKernel();
    // `routePath` is the API-prefix-stripped path, matching what the dispatcher
    // hands the resolver — cloud's resolver applies its own path policy to it
    // (control-plane prefixes skip environment resolution).
    const path: string = c.req.path ?? '';
    const routePath = path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;
    try {
        const resolved = await resolver.resolveKernel(
            { request: { headers: c.req.raw.headers }, routePath },
            defaultKernel,
        );
        if (!resolved || resolved === defaultKernel) return { ctx };
        return { ctx: contextForKernel(resolved, ctx) };
    } catch (err: any) {
        const status = typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode <= 599
            ? err.statusCode
            : 503;
        ctx.logger?.warn?.('[hono] current-user endpoint: environment resolution failed', {
            err: err?.message, code: err?.code, status, routePath,
        });
        if (typeof err?.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0) {
            try { c.header('Retry-After', String(Math.ceil(err.retryAfterSeconds))); } catch { /* best effort */ }
        }
        return { response: c.json(ENVIRONMENT_UNAVAILABLE, status) };
    }
}

/** The three route paths this module owns, under `prefix`. */
export function currentUserRoutePaths(prefix: string = DEFAULT_CURRENT_USER_PREFIX): string[] {
    return [
        `${prefix}/auth/me/permissions`,
        `${prefix}/auth/me/localization`,
        `${prefix}/me/apps`,
    ];
}

/**
 * Whether every path in `paths` is already served by a GET (or `all()`) route on
 * this app — the idempotence predicate.
 *
 * `every`, not `some`: this function registers all three or none, so a partial
 * state can only come from a host mounting its own route at one of these paths.
 * Treating that as "already provided" would silently drop the other two, while
 * re-registering all three leaves the host's earlier registration winning its
 * own path (first registration wins) and supplies the rest.
 */
function allPathsMounted(rawApp: any, paths: readonly string[]): boolean {
    const routes: Array<{ method?: string; path?: string }> = Array.isArray(rawApp?.routes) ? rawApp.routes : [];
    return paths.every((p) =>
        routes.some((r) => {
            if (r?.path !== p) return false;
            const method = String(r?.method ?? '').toUpperCase();
            return method === 'GET' || method === 'ALL';
        }),
    );
}

/**
 * Fold the `'*'` wildcard super-user grant into every per-object entry of a
 * `/me/permissions` `objects` map, mutating it in place.
 *
 * The endpoint merges each resolved permission set's explicit `objects` entries
 * most-permissively per key, but treats `'*'` and named objects as independent
 * keys — so a wildcard "Modify/View All Data" grant is never propagated into a
 * per-object entry another set explicitly denied. That makes the client's
 * per-object FLS STRICTER than the server's actual enforcement
 * (`PermissionEvaluator.checkObjectPermission`, which returns allow as soon as
 * ANY set grants — including via the `'*'` modifyAll/viewAll super-user bypass,
 * with no deny-wins). The mismatch surfaces for a platform admin
 * (`admin_full_access` `'*': {modifyAllRecords}`) who ALSO holds
 * `organization_admin` (which denies writes on identity tables): the client
 * would see `sys_user.allowEdit:false` and disable a form the server accepts
 * (verified: `PATCH /data/sys_user {name}` → 200). ADR-0057 D10 makes the
 * server the authoritative gate; the client must mirror it, never diverge.
 *
 * The super-user grant covers private/managed objects on the server, so folding
 * it here is exactly as broad as real enforcement — never broader.
 */
export function foldWildcardSuperUser(objects: Record<string, any>): void {
    const wild = objects?.['*'];
    if (!wild) return;
    const superRead = wild.viewAllRecords === true || wild.modifyAllRecords === true;
    const superWrite = wild.modifyAllRecords === true;
    if (!superRead && !superWrite) return;
    for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
        if (obj === '*' || !acc) continue;
        if (superRead) acc.allowRead = true;
        if (superWrite) {
            acc.allowEdit = true;
            acc.allowCreate = true;
            acc.allowDelete = true;
        }
    }
}

/** Minimal schema shape the managed-write clamp needs. */
export interface ManagedSchemaLike {
    managedBy?: string;
    userActions?: {
        create?: boolean;
        // edit/delete accept the #2614 object form ({ enabled, visibleWhen,
        // disabledWhen }); only the object-level `enabled` matters here — the
        // per-record predicates are UI gating, not a permission grant.
        edit?: boolean | { enabled?: boolean };
        delete?: boolean | { enabled?: boolean };
    } | null;
}

/** True only when a userActions flag (bare boolean or object form) explicitly opts the write in. */
function isWriteOptedIn(v: boolean | { enabled?: boolean } | undefined | null): boolean {
    return v === true || (typeof v === 'object' && v !== null && v.enabled === true);
}

/**
 * Buckets whose user-context generic writes are guarded fail-closed at the
 * engine: `better-auth` by plugin-auth's identity write guard (ADR-0092 D2),
 * `engine-owned` / `system` / `append-only` by plugin-security's engine-owned
 * write guard (ADR-0103). `config` / `platform` have no such guard — their
 * permission-set result stands.
 */
const GUARDED_WRITE_BUCKETS: ReadonlySet<string> = new Set(['better-auth', 'system', 'engine-owned', 'append-only']);

/**
 * Re-clamp a `/me/permissions` `objects` map by the SECOND server-side
 * enforcement layer that permission sets don't model: the engine write guards.
 * They fail-closed reject USER-CONTEXT insert/update/delete on every managed
 * object whose resolved affordances forbid the verb — `better-auth`
 * (ADR-0092 D2) and `system`/`append-only` (ADR-0103) — except where the object
 * opted the write affordance in via `userActions.{create,edit,delete}` (e.g.
 * sys_user opens `edit` for its profile fields; the RBAC link tables / prefs /
 * messaging config open their CRUD).
 *
 * Without this clamp, {@link foldWildcardSuperUser} would report `allowEdit:true`
 * for a platform admin on tables the guard actually blocks (sys_member,
 * sys_automation_run, …) — a false-POSITIVE that mirrors, inverted, the
 * false-negative the fold fixes. The real effective answer for a user-context
 * caller is `permission-set grant ∩ guard policy`, and the guard policy for a
 * guarded object is exactly its resolved CRUD affordance. `config`/`platform`
 * objects are NOT clamped — no guard covers them, so their permission-set result
 * stands (an admin CAN write them via the data API, and the hint must not
 * under-report that).
 */
export function clampManagedObjectWrites(
    objects: Record<string, any>,
    schemaOf: (objectName: string) => ManagedSchemaLike | undefined,
): void {
    for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
        if (obj === '*' || !acc) continue;
        const schema = schemaOf(obj);
        if (!schema?.managedBy || !GUARDED_WRITE_BUCKETS.has(schema.managedBy)) continue;
        const ua = schema.userActions ?? {};
        if (!isWriteOptedIn(ua.edit)) acc.allowEdit = false;
        if (ua.create !== true) acc.allowCreate = false;
        if (!isWriteOptedIn(ua.delete)) acc.allowDelete = false;
    }
}

/** The API-exposure-relevant slice of a registered object schema. */
export interface ApiExposureSchemaLike {
    name?: string;
    enable?: EnableLike | null;
}

/**
 * [#3391] Seed false-initialized per-object entries for a MODIFY-ALL super-user,
 * for every registered object whose `apiMethods` whitelist tightens exposure.
 *
 * A super-user's grant is usually the `'*'` wildcard, not explicit per-object
 * entries — so restricting objects never appear in the merged `objects` map and
 * would miss their `apiOperations` annotation. Seeding a `{allow*: false}` entry
 * lets {@link foldWildcardSuperUser} pull it true (super-user reads/writes
 * everything) and lets {@link annotateEffectiveApiOperations} attach the effective
 * set. Runs BEFORE fold.
 *
 * Guarded to `modifyAllRecords` super-users ONLY: for a viewAll-only caller,
 * materializing a `false` entry would flip the client's `check('edit')` from
 * "undefined → default-allow" to "explicit false → deny" — a scope-exceeding
 * behavior change. A modify-all caller is folded to `true` anyway, so seeding is
 * harmless there. Unrestricted objects are skipped (they carry no annotation).
 */
export function seedSuperUserRestrictedObjects(
    objects: Record<string, any>,
    allSchemas: readonly ApiExposureSchemaLike[],
): void {
    if (objects?.['*']?.modifyAllRecords !== true) return;
    for (const schema of allSchemas) {
        const name = schema?.name;
        if (!name || name === '*' || objects[name]) continue;
        const eff = resolveEffectiveApiMethods(schema.enable ?? undefined);
        if (eff.mode === 'unrestricted') continue; // only restricting objects
        objects[name] = { allowCreate: false, allowRead: false, allowEdit: false, allowDelete: false };
    }
}

/**
 * [#3391] Annotate each per-object `/me/permissions` entry with the SERVER's
 * effective API operation set (`apiOperations`), mutating the map in place.
 *
 * This is the single "effective" channel the frontend consumes — it renders the
 * operations the server hands down here, never the raw `apiMethods` whitelist.
 * Only objects whose whitelist actually tightens exposure are annotated (a
 * `deny-all` object gets an empty array; an unrestricted object gets nothing, so
 * the client keeps its default-allow behavior). Runs AFTER fold + clamp so the
 * annotation sits alongside the final CRUD affordances.
 */
export function annotateEffectiveApiOperations(
    objects: Record<string, any>,
    schemaOf: (objectName: string) => ApiExposureSchemaLike | undefined,
): void {
    // [#3544] The `'*'` entry's export grant is the FALLBACK for objects that do
    // not carry one of their own. The merge keeps `'*'` and named objects as
    // independent keys, but the server evaluator does not: its
    // `resolveObjectPermission` falls back to the wildcard whenever a set has no
    // explicit entry for the object, so an admin set granting export wholesale
    // via `'*': { allowExport: true }` really does grant it per-object. Reading
    // the wildcard here keeps the button the client shows and the request the
    // server accepts in agreement — the same class of client/server divergence
    // `foldWildcardSuperUser` exists to close, on the export axis.
    const wildExport = objects?.['*']?.allowExport;
    for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
        if (obj === '*' || !acc) continue;
        const schema = schemaOf(obj);
        if (!schema) continue; // schema missing → no annotation (client falls back)
        // [#3544] User-level export axis: `export` derives from `list ∧ this
        // grant`. OPT-IN — only an explicit `true` (on the object entry, else
        // inherited from `'*'`) allows export; unset and `false` both withhold
        // it, and the super-user bits do NOT imply it.
        const exportBit = acc.allowExport ?? wildExport;
        const userExportAllowed = exportBit === true;
        const eff = resolveEffectiveApiMethods(schema.enable ?? undefined, { userExportAllowed });
        // Annotate when the object tightens via `apiMethods`, OR when the export
        // axis removes `export` from an otherwise-open object (so the client
        // hides the Export button). An unrestricted object with export still
        // allowed needs no annotation — the client keeps its default-allow path.
        if (eff.mode === 'unrestricted' && userExportAllowed) continue;
        acc.apiOperations = effectiveOperationsArray(eff);
    }
}

/**
 * Build the session → `ExecutionContext` resolver the current-user endpoints
 * need.
 *
 * Extracted from `registerDiscoveryAndCrudEndpoints` when these endpoints
 * stopped being gated on `registerStandardEndpoints` (#4073), so the two groups
 * would agree on who the caller is. That surface has since been deleted and
 * these endpoints are the only remaining caller — kept as a named export
 * because the serverless host path (cloud#924) composes it directly.
 */
export function makeExecutionContextResolver(ctx: CurrentUserEndpointsContext) {
    const getObjectQL = () => ctx.getService<IDataEngine>('objectql');
    // Helper: resolve ExecutionContext from request headers (cookie session
    // or API key). Mirrors the runtime's resolveExecutionContext but
    // self-contained to avoid a cross-package dep. We DO query the
    // `sys_user_permission_set` link tables because hardcoding a single
    // permission set name (e.g. `member_default`) would silently ignore
    // any explicit admin / role assignment — including the platform-admin
    // promotion seeded by `bootstrapPlatformAdmin`.
    const resolveCtx = async (c: any): Promise<any | undefined> => {
        try {
            const authService: any = ctx.getService('auth');
            if (!authService) return undefined;
            let api: any = authService.api;
            if (!api && typeof authService.getApi === 'function') {
                api = await authService.getApi();
            }
            if (!api?.getSession) return undefined;
            const session = await api.getSession({ headers: c.req.raw.headers });
            if (!session?.user?.id) return undefined;
            const userId = session.user.id;
            const tenantId = session.session?.activeOrganizationId ?? undefined;
            const permissions: string[] = [];
            const roles: string[] = [];
            try {
                const ql = getObjectQL();
                const sysCtx = { context: { isSystem: true } };
                // Roles via sys_member (org-scoped if active org).
                const memberRows = await ql?.find?.(
                    'sys_member',
                    {
                        where: tenantId
                            ? { user_id: userId, organization_id: tenantId }
                            : { user_id: userId },
                        limit: 50,
                        ...sysCtx,
                    } as any,
                ).catch(() => []);
                for (const m of (memberRows ?? []) as any[]) {
                    if (typeof m.role === 'string') {
                        for (const r of m.role.split(',').map((s: string) => s.trim()).filter(Boolean)) {
                            if (!roles.includes(r)) roles.push(r);
                        }
                    }
                }
                // User-scoped permission sets — match BOTH (a) the active
                // org's link rows and (b) the cross-tenant rows
                // (organization_id IS NULL) so the platform-admin
                // promotion seeded by `bootstrapPlatformAdmin` applies
                // regardless of the user's active org.
                const upsRows = await ql?.find?.(
                    'sys_user_permission_set',
                    { where: { user_id: userId }, limit: 100, ...sysCtx } as any,
                ).catch(() => []);
                const psIds = new Set<string>();
                for (const r of (upsRows ?? []) as any[]) {
                    const orgScope = r.organization_id ?? null;
                    if (!orgScope || (tenantId && orgScope === tenantId)) {
                        const pid = r.permission_set_id ?? r.permissionSetId;
                        if (pid) psIds.add(pid);
                    }
                }
                if (psIds.size > 0) {
                    const psRows = await ql?.find?.(
                        'sys_permission_set',
                        { where: { id: { $in: Array.from(psIds) } }, limit: 500, ...sysCtx } as any,
                    ).catch(() => []);
                    for (const ps of (psRows ?? []) as any[]) {
                        if (ps.name && !permissions.includes(ps.name)) permissions.push(ps.name);
                    }
                }
            } catch {
                /* fall through with whatever we resolved so far */
            }
            // Resolve fellow-org user IDs so identity-table RLS (sys_user
            // org-members policy) can scope @-mention pickers, owner
            // lookups and reviewer selectors to the active organization.
            // Mirrors the resolvers in `@objectstack/rest` and
            // `@objectstack/runtime` so all three REST entry-points
            // produce a consistent ExecutionContext shape.
            let orgUserIds: string[] = [userId];
            if (tenantId) {
                try {
                    const ql = getObjectQL();
                    const sysCtx = { context: { isSystem: true } };
                    const memberRows = await ql?.find?.(
                        'sys_member',
                        { where: { organization_id: tenantId }, limit: 1000, ...sysCtx } as any,
                    ).catch(() => []);
                    const ids = new Set<string>([userId]);
                    for (const m of (memberRows ?? []) as any[]) {
                        const uid = m.user_id ?? m.userId;
                        if (typeof uid === 'string' && uid.length > 0) ids.add(uid);
                    }
                    orgUserIds = Array.from(ids);
                } catch {
                    /* fall back to self-only */
                }
            }
            // [ADR-0105 D2] The caller's org access set — the `group`
            // posture's Layer 0 wall is `organization_id IN (...)`, so a
            // context without it fails every read closed on this surface.
            // Resolved from the user's OWN memberships (all organizations,
            // not the active one). This standalone resolver duplicates the
            // canonical `resolveAuthzContext` by design (see the posture
            // note below); the duplication is tracked by
            // `scripts/check-single-authz-resolver.mjs`.
            let accessibleOrgIds: string[] = [];
            try {
                const ql = getObjectQL();
                const sysCtx = { context: { isSystem: true } };
                const myMemberships = await ql?.find?.(
                    'sys_member',
                    { where: { user_id: userId }, limit: 200, ...sysCtx } as any,
                ).catch(() => []);
                const orgIds = new Set<string>();
                for (const m of (myMemberships ?? []) as any[]) {
                    const oid = m.organization_id ?? m.organizationId;
                    if (typeof oid === 'string' && oid.length > 0) orgIds.add(oid);
                }
                accessibleOrgIds = Array.from(orgIds);
            } catch {
                /* no memberships resolvable → empty set → fails closed */
            }
            // Env-side AI-seat marker (simple model). The single-org env
            // DB has no permission-set/org dimension for this — the seat is
            // the boolean `sys_user.ai_access`. Read it with a GUARDED system
            // query (NOT a better-auth additionalField: sys_user is
            // better-auth-managed and better-auth SELECTs explicit columns,
            // so an additionalField would make getSession query a possibly-
            // missing column → broken auth; a guarded read can only no-op).
            // When true, synthesize the `ai_seat` capability so the per-agent
            // gate (evaluateAgentAccess → requires `ai_seat`) admits the user
            // with no permission-set grant. Absent/false/missing-column →
            // no synthesis (deny, as before).
            if (!permissions.includes('ai_seat')) {
                try {
                    const ql = getObjectQL();
                    const sysCtx = { context: { isSystem: true } };
                    const uRows = await ql?.find?.(
                        'sys_user',
                        { where: { id: userId }, limit: 1, ...sysCtx } as any,
                    ).catch(() => []);
                    // Turso returns sqlite booleans as 1/0; memory driver as boolean.
                    const aiAccess = (uRows?.[0] as any)?.ai_access;
                    if (aiAccess === true || aiAccess === 1 || aiAccess === '1') permissions.push('ai_seat');
                } catch {
                    /* no ai_access column / query failed → no seat (safe) */
                }
            }
            // [#2408 / #3361] Open the per-request `Server-Timing` disclosure
            // gate for an admin/service principal — the standalone-surface analog
            // of the runtime dispatcher's `timedResolveExecutionContext`. This
            // self-contained resolver derives no posture rung, so derive one HERE,
            // for the gate decision ONLY, from the resolved permission-set grants,
            // and hand it to the shared `isPerfDisclosurePrincipal` predicate. The
            // rung is computed onto a THROW-AWAY object, never the returned
            // context: `ctx.posture` is an enforcement input (Layer 0 tier
            // adjudication, ADR-0099 D1) and only the authoritative resolver may
            // set it. A no-op when perf-tuning is off (no ambient gate).
            const disclosurePosture = derivePosture({
                isPlatformAdmin: permissions.includes(ADMIN_FULL_ACCESS),
                isTenantAdmin: ORGANIZATION_ADMIN_GRANTS.some((n) => permissions.includes(n)),
            });
            if (isPerfDisclosurePrincipal({ isSystem: false, posture: disclosurePosture } as ExecutionContext)) {
                allowPerfDisclosure();
            }
            return {
                userId,
                tenantId,
                roles,
                permissions,
                isSystem: false,
                org_user_ids: orgUserIds,
                accessible_org_ids: accessibleOrgIds,
            } as any;
        } catch {
            return undefined;
        }
    };
    return resolveCtx;
}

/**
 * Register the current-user endpoints — `/auth/me/permissions`,
 * `/auth/me/localization` and `/me/apps` — on `rawApp`.
 *
 * When {@link HonoServerPlugin} drives this, it is UNCONDITIONAL — and these are
 * now the only routes it mounts beyond the socket itself.
 *
 * They used to ride on the `registerStandardEndpoints` flag alongside a raw
 * `/data` CRUD + discovery surface, one flag over two opposite things (#4073).
 * That surface was DUPLICATE supply and has been deleted; these three are the
 * opposite and could not be. Nothing else in the platform mounts them:
 * `packages/rest` and `packages/runtime` register no `/me/*` route at all, the
 * console reads `/auth/me/permissions` for its whole permission layer and
 * `/auth/me/localization` for regional defaults, and
 * `core/security/auth-gate.ts` allow-lists `/me/apps` + `/me/localization` as
 * endpoints a gated user MUST still reach to bootstrap the remediation UI. The
 * split (#4144) had to land before the deletion for exactly that reason.
 *
 * IDEMPOTENT: returns `false` and registers nothing when all three paths are
 * already served. That is what lets a host call this eagerly on its own raw app
 * AND mount the plugin — the plugin's `kernel:ready` registration then finds them
 * present and skips, instead of shadowing the host's routes with dead
 * duplicates (cloud#924).
 */
export function registerCurrentUserEndpoints(
    options: RegisterCurrentUserEndpointsOptions,
): boolean {
    const { rawApp, ctx, prefix = DEFAULT_CURRENT_USER_PREFIX } = options;
    const paths = currentUserRoutePaths(prefix);
    if (allPathsMounted(rawApp, paths)) {
        ctx.logger?.debug?.('Current-user endpoints already registered — skipping', { prefix });
        return false;
    }
    /**
     * Wrap a handler so it runs against the kernel that OWNS the request.
     *
     * The handler's `ctx` parameter deliberately shadows the registration-time
     * locator: every `ctx.getService(...)` in the bodies below then reads the
     * per-request kernel on a multi-tenant host and the same kernel as before on
     * a single-environment one, with no per-read plumbing to keep in sync. Same
     * for `resolveCtx` — the caller's identity must be resolved from the kernel
     * that owns the session, not the routing shell in front of it.
     */
    const withRequestContext = (
        handler: (
            c: any,
            ctx: CurrentUserEndpointsContext,
            resolveCtx: ReturnType<typeof makeExecutionContextResolver>,
        ) => Promise<Response>,
    ) => async (c: any): Promise<Response> => {
        const resolution = await resolveRequestContext(c, ctx, prefix);
        if ('response' in resolution) return resolution.response;
        return handler(c, resolution.ctx, makeExecutionContextResolver(resolution.ctx));
    };

    // Effective permissions for the current user — single aggregation
    // endpoint that resolves session → roles → permission sets → merged
    // field/object permissions. Frontend Field-Level Security (FLS)
    // consumes this to gate form fields / list columns without having
    // to replicate the server's role+permission-set resolution and
    // most-permissive merge logic.
    //
    // Response shape (designed to mirror @object-ui/permissions
    // expectations — see `PermissionSet` in @objectstack/spec):
    //   {
    //     userId, tenantId, roles, permissionSets,
    //     objects: Record<objectName, { allowCreate, allowRead, ... }>,
    //     fields:  Record<"object.field", { readable, editable }>,
    //   }
    //
    // Returns `{authenticated:false}` (200) when no session is
    // present, so the frontend can distinguish anon from error.
    rawApp.get(`${prefix}/auth/me/permissions`, withRequestContext(async (c, ctx, resolveCtx) => {
        const execCtx = await resolveCtx(c);
        if (!execCtx?.userId) {
            return c.json({ authenticated: false });
        }
        try {
            // [#4093] Guarded like the three lookups below, not bare:
            // `getService` THROWS on an unregistered slot, and since
            // plugin-dev stopped stubbing `security.permissions` (a fake
            // that answered "allowed" for everything) an unclaimed slot is
            // the ordinary state of a stack without SecurityPlugin. Bare,
            // it landed in the outer catch — same fail-open body, but
            // logged as "/auth/me/permissions failed", which reads as a
            // fault on every console navigation instead of the deliberate
            // `!evaluator` branch right below.
            const metadata: any = (() => {
                try { return ctx.getService('metadata'); } catch { return null; }
            })();
            const evaluator: any = (() => {
                try { return ctx.getService('security.permissions'); } catch { return null; }
            })();
            const bootstrap: any[] = (() => {
                try { return ctx.getService<any[]>('security.bootstrapPermissionSets') ?? []; }
                catch { return []; }
            })();
            const fallbackName: string | null = (() => {
                try { return ctx.getService<string | null>('security.fallbackPermissionSet') ?? 'member_default'; }
                catch { return 'member_default'; }
            })();
            // DB loader: surfaces user-defined permission sets
            // (created via the admin UI as `sys_permission_set`
            // rows) that aren't in metadata or bootstrap.
            const ql: any = (() => {
                try { return ctx.getService('objectql'); } catch { return null; }
            })();
            const dbLoader = ql
                ? async (names: string[]) => {
                    let rows: any;
                    try {
                        rows = await ql.find(
                            'sys_permission_set',
                            { where: { name: { $in: names } }, limit: names.length },
                            { context: { isSystem: true } },
                        );
                    } catch {
                        rows = [];
                    }
                    const list = Array.isArray(rows) ? rows : rows?.records ?? [];
                    return list.map((r: any) => ({
                        name: r.name,
                        label: r.label,
                        objects: typeof r.object_permissions === 'string'
                            ? JSON.parse(r.object_permissions || '{}')
                            : r.object_permissions ?? {},
                        fields: typeof r.field_permissions === 'string'
                            ? JSON.parse(r.field_permissions || '{}')
                            : r.field_permissions ?? {},
                        // #2752 follow-through: DB-loaded sets used to drop
                        // their capability + tab columns, so a direct grant
                        // of e.g. `setup.access` never surfaced here.
                        systemPermissions: typeof r.system_permissions === 'string'
                            ? JSON.parse(r.system_permissions || '[]')
                            : r.system_permissions ?? [],
                        tabPermissions: typeof r.tab_permissions === 'string'
                            ? JSON.parse(r.tab_permissions || '{}')
                            : r.tab_permissions ?? {},
                    }));
                }
                : undefined;
            if (!evaluator || !metadata) {
                // Auth resolved but security plugin isn't wired — emit
                // an empty-but-authenticated body so the frontend can
                // fail-open with full access (matches server behaviour
                // when SecurityPlugin isn't registered).
                return c.json({
                    authenticated: true,
                    userId: execCtx.userId,
                    tenantId: execCtx.tenantId ?? null,
                    positions: execCtx.positions ?? [],
                    permissionSets: execCtx.permissions ?? [],
                    objects: {},
                    fields: {},
                });
            }
            // Resolve the same way SecurityPlugin middleware does:
            // role names + explicit permission-set names, with a
            // fallback to `member_default` when authenticated users
            // resolve to zero permission sets (matches the
            // post-resolution fallback in security-plugin.ts).
            const requested = [
                ...(execCtx.positions ?? []),
                ...(execCtx.permissions ?? []),
            ];
            let resolved: any[] = await evaluator
                .resolvePermissionSets(requested, metadata, bootstrap, dbLoader)
                .catch(() => []);
            if (resolved.length === 0 && fallbackName) {
                resolved = await evaluator
                    .resolvePermissionSets([fallbackName], metadata, bootstrap, dbLoader)
                    .catch(() => []);
            }
            // Most-permissive merge of `objects` and `fields` across
            // all resolved permission sets — same semantics as
            // PermissionEvaluator.getFieldPermissions but for ALL
            // objects in a single pass.
            const objects: Record<string, any> = {};
            const fields: Record<string, { readable: boolean; editable: boolean }> = {};
            const systemPermissions = new Set<string>();
            const tabRank: Record<string, number> = { hidden: 0, default_off: 1, default_on: 2, visible: 3 };
            const tabPermissions: Record<string, 'visible' | 'hidden' | 'default_on' | 'default_off'> = {};
            for (const ps of resolved) {
                if (ps?.objects) {
                    for (const [obj, perm] of Object.entries(ps.objects)) {
                        const acc = objects[obj] ?? {};
                        for (const [k, v] of Object.entries(perm as any)) {
                            if (v === true) acc[k] = true;
                            else if (acc[k] === undefined) acc[k] = v;
                        }
                        objects[obj] = acc;
                    }
                }
                if (ps?.fields) {
                    for (const [key, perm] of Object.entries(ps.fields)) {
                        const acc = fields[key] ?? { readable: false, editable: false };
                        const p = perm as any;
                        if (p.readable) acc.readable = true;
                        if (p.editable) acc.editable = true;
                        fields[key] = acc;
                    }
                }
                if (Array.isArray(ps?.systemPermissions)) {
                    for (const sp of ps.systemPermissions) {
                        if (typeof sp === 'string') systemPermissions.add(sp);
                    }
                }
                if (ps?.tabPermissions && typeof ps.tabPermissions === 'object') {
                    for (const [app, val] of Object.entries(ps.tabPermissions as Record<string, unknown>)) {
                        if (typeof val !== 'string' || !(val in tabRank)) continue;
                        const cur = tabPermissions[app];
                        if (!cur || tabRank[val] > tabRank[cur]) {
                            tabPermissions[app] = val as 'visible' | 'hidden' | 'default_on' | 'default_off';
                        }
                    }
                }
            }
            // Make the client's per-object FLS reflect the server's ACTUAL
            // effective enforcement = permission-set grant ∩ identity write
            // guard (ADR-0057 D10). (1) Fold the `'*'` super-user grant into
            // every object so an admin's wildcard is not shadowed by another
            // set's explicit deny; (2) re-clamp `better-auth` managed objects
            // by their write affordance, since the guard (ADR-0092 D2) blocks
            // user-context writes there except where the object opted in
            // (sys_user → edit). Together these remove both the false-negative
            // (admin sees sys_user editable) and the false-positive (admin does
            // NOT see sys_member editable, matching the guard).
            // [#3391] For a modify-all super-user, seed restricting objects
            // absent from the merged map so fold pulls them true and annotate
            // can attach their effective apiOperations. Guarded — a failure
            // here must never drop the whole response.
            try {
                const allSchemas: ApiExposureSchemaLike[] = (() => {
                    try { return (ql as any)?.registry?.getAllObjects?.() ?? []; }
                    catch { return []; }
                })();
                seedSuperUserRestrictedObjects(objects, allSchemas);
            } catch (e: any) {
                ctx.logger?.warn?.('[hono] effective apiOperations seed failed', { err: e?.message });
            }
            foldWildcardSuperUser(objects);
            clampManagedObjectWrites(objects, (name) => {
                try { return ql?.getSchema?.(name) as ManagedSchemaLike | undefined; }
                catch { return undefined; }
            });
            // [#3391] Annotate the per-object effective API operation set —
            // the single channel the frontend consumes for effective ops.
            // Guarded: on failure we simply omit apiOperations and the client
            // falls back to its default-allow behavior.
            try {
                annotateEffectiveApiOperations(objects, (name) => {
                    try { return ql?.getSchema?.(name) as ApiExposureSchemaLike | undefined; }
                    catch { return undefined; }
                });
            } catch (e: any) {
                ctx.logger?.warn?.('[hono] effective apiOperations annotate failed', { err: e?.message });
            }
            return c.json({
                authenticated: true,
                userId: execCtx.userId,
                tenantId: execCtx.tenantId ?? null,
                positions: execCtx.positions ?? [],
                permissionSets: resolved.map((p: any) => p?.name).filter(Boolean),
                objects,
                fields,
                systemPermissions: Array.from(systemPermissions),
                tabPermissions,
            });
        } catch (err: any) {
            ctx.logger?.warn?.('[hono] /auth/me/permissions failed', { err: err?.message });
            return c.json({ authenticated: true, userId: execCtx.userId, objects: {}, fields: {} });
        }
    }));

    // GET /me/localization — the resolved regional defaults (currency /
    // locale / timezone) for the current request's tenant, exposed to EVERY
    // authenticated user. The `localization` SETTINGS are gated to
    // `setup.access`, but the resolved defaults are needed by every renderer
    // to format currency/dates/numbers — so they ride on the request
    // ExecutionContext (ADR-0053) and are surfaced here without that gate.
    rawApp.get(`${prefix}/auth/me/localization`, withRequestContext(async (c, ctx, resolveCtx) => {
        const execCtx = await resolveCtx(c);
        if (!execCtx?.userId) {
            return c.json({ authenticated: false });
        }
        return c.json({
            authenticated: true,
            currency: execCtx.currency ?? null,
            locale: execCtx.locale ?? null,
            timezone: execCtx.timezone ?? null,
        });
    }));

    // GET /me/apps — list apps the current user is allowed to enter.
    // Apps live in the ENGINE REGISTRY (runtime AppPlugin registerApp()),
    // not the metadata service — reading `metadata.list('app')` returned
    // [] for every principal (#2752), leaving tabPermissions and
    // AppSchema.requiredPermissions with no enforced consumer. Source
    // from `registry.getAllApps()` (the same authority the meta routes
    // use, nav contributions merged), with the metadata service kept as
    // an additive fallback for runtime-draft-published apps. Filters:
    //   1. AppSchema.requiredPermissions ⊆ ctx.systemPermissions
    //   2. ctx.tabPermissions[app.name] !== 'hidden'
    // Anonymous users get an empty array. When SecurityPlugin is absent
    // we fail-open and return every app (matches server behaviour).
    rawApp.get(`${prefix}/me/apps`, withRequestContext(async (c, ctx, resolveCtx) => {
        const execCtx = await resolveCtx(c);
        if (!execCtx?.userId) return c.json({ apps: [] });
        try {
            const byName = new Map<string, any>();
            try {
                const registry: any = (ctx.getService('objectql') as any)?._registry;
                for (const app of registry?.getAllApps?.() ?? []) {
                    if (app?.name) byName.set(String(app.name), app);
                }
            } catch { /* registry unavailable — fall through to metadata */ }
            try {
                const metadata: any = ctx.getService('metadata');
                for (const app of ((await metadata?.list?.('app')) ?? []) as any[]) {
                    if (app?.name && !byName.has(String(app.name))) byName.set(String(app.name), app);
                }
            } catch { /* metadata service optional */ }
            // Resolve the caller's effective capability/tab surface the
            // same way /auth/me/permissions does — resolveCtx() carries
            // neither systemPermissions nor tabPermissions, so filtering
            // on execCtx fields silently gated EVERY requiredPermissions
            // app away from everyone, including the platform admin.
            const sysPerms = new Set<string>(execCtx.systemPermissions ?? []);
            const tabs: Record<string, string> = { ...((execCtx as any).tabPermissions ?? {}) };
            let failOpen = true;
            try {
                const evaluator: any = ctx.getService('security.permissions');
                failOpen = !evaluator;
                if (evaluator) {
                    const metadata: any = ctx.getService('metadata');
                    const bootstrap: any[] = (() => {
                        try { return ctx.getService<any[]>('security.bootstrapPermissionSets') ?? []; }
                        catch { return []; }
                    })();
                    const fallbackName: string | null = (() => {
                        try { return ctx.getService<string | null>('security.fallbackPermissionSet') ?? 'member_default'; }
                        catch { return 'member_default'; }
                    })();
                    const requested = [
                        ...((execCtx as any).positions ?? []),
                        ...((execCtx as any).permissions ?? []),
                    ];
                    const qlSvc: any = (() => { try { return ctx.getService('objectql'); } catch { return null; } })();
                    const dbLoader = qlSvc
                        ? async (names: string[]) => {
                            let rows: any;
                            try {
                                rows = await qlSvc.find(
                                    'sys_permission_set',
                                    { where: { name: { $in: names } }, limit: names.length },
                                    { context: { isSystem: true } },
                                );
                            } catch { rows = []; }
                            const list = Array.isArray(rows) ? rows : rows?.records ?? [];
                            return list.map((r: any) => ({
                                name: r.name,
                                systemPermissions: typeof r.system_permissions === 'string'
                                    ? JSON.parse(r.system_permissions || '[]')
                                    : r.system_permissions ?? [],
                                tabPermissions: typeof r.tab_permissions === 'string'
                                    ? JSON.parse(r.tab_permissions || '{}')
                                    : r.tab_permissions ?? {},
                            }));
                        }
                        : undefined;
                    let resolved: any[] = await evaluator
                        .resolvePermissionSets(requested, metadata, bootstrap, dbLoader)
                        .catch(() => []);
                    if (resolved.length === 0 && fallbackName) {
                        resolved = await evaluator
                            .resolvePermissionSets([fallbackName], metadata, bootstrap, dbLoader)
                            .catch(() => []);
                    }
                    const tabRank: Record<string, number> = { hidden: 0, default_off: 1, default_on: 2, visible: 3 };
                    for (const ps of resolved) {
                        for (const sp of (Array.isArray(ps?.systemPermissions) ? ps.systemPermissions : [])) {
                            if (typeof sp === 'string') sysPerms.add(sp);
                        }
                        if (ps?.tabPermissions && typeof ps.tabPermissions === 'object') {
                            for (const [app, val] of Object.entries(ps.tabPermissions as Record<string, unknown>)) {
                                if (typeof val !== 'string' || !(val in tabRank)) continue;
                                const cur = tabs[app];
                                if (!cur || tabRank[val] > (tabRank[cur] ?? -1)) tabs[app] = val;
                            }
                        }
                    }
                }
            } catch { failOpen = true; }
            const apps = [...byName.values()].filter((app: any) => {
                if (tabs[app.name] === 'hidden') return false;
                if (failOpen) return true;
                const req: string[] = Array.isArray(app.requiredPermissions) ? app.requiredPermissions : [];
                return req.every((p) => sysPerms.has(p));
            });
            return c.json({ apps });
        } catch (err: any) {
            ctx.logger?.warn?.('[hono] /me/apps failed', { err: err?.message });
            return c.json({ apps: [] });
        }
    }));
    ctx.logger?.debug?.('Registered current-user endpoints', { prefix });
    return true;
}
