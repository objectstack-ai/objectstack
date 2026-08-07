// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * actor-user — the ONE producer of the caller's `user` shape for the three
 * dispatch paths that hand it to customer code (#5372).
 *
 * Before this module the shape was open-coded three times and the three
 * disagreed, in the worst possible way — not by omitting a key, but by
 * DELIVERING A PLAUSIBLE WRONG VALUE under a declared one:
 *
 *   - REST `/actions` (domains/actions.ts) hardcoded `name: ec.userId`;
 *   - MCP `run_action` (action-execution.ts) read
 *     `ec.userName ?? ec.userDisplayName ?? ec.userId` — neither alias is
 *     declared on `ExecutionContextSchema` and nothing in the repo ever
 *     assigned either, so the chain always landed on the id (the #4984
 *     dead-limb family: a `??` chain whose only reachable arm is the last);
 *   - the AI routes (domains/ai.ts) spelled the key `displayName` (same dead
 *     chain behind it) and read the caller's address off `ec.userEmail`,
 *     which is not the declared field either (it is `ec.email`), so
 *     `user.email` on that path was permanently `undefined`.
 *
 * `ctx.user.name` reads as a plausible string, so no consumer-side `??` can
 * detect that it is the wrong string — an app that trusts the declared key
 * writes opaque ids into user-facing surfaces (hotcrm's activity timeline did
 * exactly that, objectstack-ai/hotcrm#673). One producer, one shape, one
 * resolution of the display name is the structural fix; a fallback in each
 * consumer would have been the #12 anti-pattern.
 *
 * `sys_user.name` is the authority: it is the platform's own profile
 * display-name column (`required: true` on the object, and the one field
 * besides `image` that plugin-auth's identity write guard lets a user edit).
 * Resolution is quiet by construction — a missing row, an unavailable engine
 * or a blank name falls back to the id. A dispatch must not fail because a
 * display name could not be read.
 *
 * [ADR-0068 D1] The shape is not invented here. `EvalUser` is the spec's one
 * user-context contract, mounted under `current_user` / `user` / `ctx.user` on
 * the predicate surface (`formula/stdlib.ts` `buildScope`) — and `name` is
 * declared on it as "Display name". So the REST hardcode was not merely
 * inconsistent with its sibling dispatchers, it was serving something else
 * under a key the spec had already defined. This module builds the identity
 * core through the SAME `createEvalUser` factory and extends it with the two
 * transport channels the dispatch surfaces publish, so an author's `ctx.user`
 * means one thing whether they are writing a predicate or a body.
 */

import { createEvalUser, type EvalUser } from '@objectstack/spec/identity';

/**
 * The user envelope handed to an action body (`ctx.user`) and to AI route
 * handlers (`req.user`).
 *
 * [ADR-0068 D1] Its identity core IS an `EvalUser` — the spec's one
 * user-context contract, built through the same `createEvalUser` factory the
 * formula/predicate surface mounts under `current_user` / `user` / `ctx.user`.
 * That is deliberate and load-bearing: an action declares a `visible`
 * predicate and a `body` side by side, both spelled `ctx.user`, and ADR-0068
 * exists precisely because the platform once had three different user shapes
 * under one name. A body reading `ctx.user.name` (or `.positions`, or
 * `.isPlatformAdmin`) must see what the predicate one line above sees.
 *
 * The extra keys are the TRANSPORT's, not the contract's: the id/name aliases
 * the two dispatch surfaces already published, and the two authority channels
 * (`permissions` = permission-SET names, `systemPermissions` = CAPABILITIES —
 * separate channels, never merged, #4705). They extend the EvalUser core; they
 * never contradict it.
 *
 * Every key is always present with a defined value except `email` /
 * `organizationId`, which are genuinely optional facts about the caller. The
 * arrays in particular are never `undefined`, so a consumer reads "holds
 * nothing" instead of needing a `?? []` to tell absence from emptiness.
 */
export interface ActorUser extends EvalUser {
    /** The acting user's id (`sys_user.id`), or `system` for a self-invoked call. */
    id: string;
    /**
     * Alias of {@link id}. Pre-existing on the AI-route shape (both producers
     * emitted it), carried into the unified shape rather than dropped — this
     * change fixes a wrong VALUE, it does not get to retire a key consumers
     * may already read.
     */
    userId: string;
    /**
     * The acting user's display name (`sys_user.name`). Falls back to the id
     * when the platform cannot resolve one — so `name === id` means exactly
     * "this user has no resolvable display name", never "the dispatcher
     * forgot to look". (`EvalUser.name` is optional; on this surface it is
     * always populated, because a body that has to handle `undefined` will
     * print `undefined` into a timeline exactly once and then grow a
     * workaround.)
     */
    name: string;
    /** Alias of {@link name} — the spelling AI route handlers already read. */
    displayName: string;
    /**
     * ADR-0090 position names held by the caller (canonical; `EvalUser.positions`).
     *
     * The pre-ADR-0090 `roles` alias of this key was REMOVED in v17 (#6011).
     * It carried `positions` verbatim under a word ADR-0090 D3 reserves and
     * bans, and no consumer read it — the "kept for the REST/AI shapes" claim
     * its comment made was checked and disproven at removal time (the REST/AI
     * shapes are BUILT here, but nothing downstream read `.roles` off them).
     * A body that used to read `ctx.user.roles` reads `ctx.user.positions`.
     *
     * ⚠️ Do not restore it as a `??` fallback in a consumer: `positions` is the
     * one spelling this surface publishes, and a second de-facto spelling is
     * exactly the state #5613's ruling called a defect rather than an endpoint.
     * (`ctx.session` is a DIFFERENT face and keeps its own deprecation window —
     * see `buildActionSession` in `action-execution.ts`.)
     */
    positions: string[];
    /** Permission-SET names (`admin_full_access`, `ai_seat`, …). */
    permissions: string[];
    /** CAPABILITIES (`manage_metadata`, `studio.access`, …) — a separate channel (#4705). */
    systemPermissions: string[];
}

/** The principal a genuinely anonymous / self-invoked dispatch runs as (#2701). */
const SYSTEM_ACTOR_ID = 'system';

/**
 * Per-request memo for the display-name read, keyed on the request's
 * ExecutionContext object identity — the envelope `resolveExecutionContext`
 * builds once per inbound request. So N action dispatches inside one request
 * cost ONE `sys_user` read, and nothing is cached across requests (a renamed
 * user is correct on their very next request, with no invalidation hook to
 * forget). Entries die with the context.
 */
const displayNameByContext = new WeakMap<object, Promise<string | undefined>>();

/** A lazily-resolved data engine — the callers reach theirs differently. */
export type QlGetter = () => Promise<any> | any;

async function readDisplayName(getQl: QlGetter, userId: string): Promise<string | undefined> {
    try {
        const ql: any = await getQl();
        if (!ql || typeof ql.find !== 'function') return undefined;
        // System-elevated, exactly like the shared authz resolver's own
        // `sys_user` read (core/security/resolve-authz-context.ts): resolving
        // WHO the caller is must not depend on the caller holding read
        // permission on the identity table.
        let rows: any = await ql.find('sys_user', {
            where: { id: userId },
            limit: 1,
            context: { isSystem: true },
        });
        if (rows && rows.value) rows = rows.value;
        if (!Array.isArray(rows)) return undefined;
        const row = rows.find((r: any) => r?.id === userId) ?? rows[0];
        const name = row?.name;
        return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
    } catch {
        // Quiet by design — see the module header.
        return undefined;
    }
}

/**
 * Resolve the acting user's display name from `sys_user.name`, once per
 * request. Returns `undefined` when there is no user, no engine, no row, or
 * no name — callers fall back to the id via {@link actorUserFromExecutionContext}.
 */
export async function resolveActorDisplayName(getQl: QlGetter, ec: any): Promise<string | undefined> {
    const userId = ec?.userId;
    if (typeof userId !== 'string' || userId.length === 0) return undefined;
    const cacheKey: object | undefined = ec && typeof ec === 'object' ? ec : undefined;
    if (cacheKey) {
        const cached = displayNameByContext.get(cacheKey);
        if (cached) return cached;
    }
    const pending = readDisplayName(getQl, userId);
    if (cacheKey) displayNameByContext.set(cacheKey, pending);
    return pending;
}

/** Normalize an unknown into a string array (never `undefined`). */
function strings(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Build the unified user envelope. Pass no `id` (an anonymous / self-invoked
 * dispatch) to get the `system` principal in the SAME shape, so a body never
 * has to branch on which principal it got.
 */
export function buildActorUser(input?: {
    id?: string;
    displayName?: string;
    email?: string;
    organizationId?: string;
    positions?: unknown;
    permissions?: unknown;
    systemPermissions?: unknown;
}): ActorUser {
    const id =
        typeof input?.id === 'string' && input.id.length > 0 ? input.id : SYSTEM_ACTOR_ID;
    const anonymous = id === SYSTEM_ACTOR_ID && !input?.id;
    const name =
        !anonymous && typeof input?.displayName === 'string' && input.displayName.trim().length > 0
            ? input.displayName.trim()
            : id;
    // [ADR-0068 D1] The identity core comes from the spec's ONE factory, so
    // `positions` normalization and the `isPlatformAdmin` derivation can never
    // disagree with the predicate surface's copy of the same user.
    const core = createEvalUser({
        id,
        name,
        email: anonymous ? undefined : (typeof input?.email === 'string' && input.email.length > 0 ? input.email : undefined),
        positions: anonymous ? [] : strings(input?.positions),
        organizationId:
            !anonymous && typeof input?.organizationId === 'string' && input.organizationId.length > 0
                ? input.organizationId
                : undefined,
    });
    return {
        ...core,
        name,
        userId: id,
        displayName: name,
        positions: core.positions,
        permissions: anonymous ? [] : strings(input?.permissions),
        systemPermissions: anonymous ? [] : strings(input?.systemPermissions),
    };
}

/**
 * Map a resolved {@link ExecutionContext} (plus the display name resolved by
 * {@link resolveActorDisplayName}) onto the unified shape. This is the single
 * place that decides which ExecutionContext field feeds which user key —
 * `email` (declared) rather than the `userEmail` that never existed,
 * `tenantId` → `organizationId` (the blessed developer-facing name, #3280).
 */
export function actorUserFromExecutionContext(ec: any, displayName?: string): ActorUser {
    return buildActorUser({
        id: typeof ec?.userId === 'string' ? ec.userId : undefined,
        displayName,
        email: typeof ec?.email === 'string' ? ec.email : undefined,
        organizationId: ec?.tenantId != null ? String(ec.tenantId) : undefined,
        positions: ec?.positions,
        permissions: ec?.permissions,
        systemPermissions: ec?.systemPermissions,
    });
}
