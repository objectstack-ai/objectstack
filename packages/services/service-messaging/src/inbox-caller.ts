// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Authenticated-caller scoping for the plugin-facing inbox surface
 * (ADR-0030 Layer 5) — the write door (#10753) and the read door (#11452).
 *
 * ## The shape this closes
 *
 * `MessagingService.markRead(userId, ids)` is the REST door's contract method:
 * `INotificationService.markRead?(userId, ids)`, called by
 * `packages/runtime/src/domains/notifications.ts`, which binds `userId` to
 * `context.executionContext.userId` — the session user the HTTP door already
 * authenticated. On that path the parameter is trustworthy because the door
 * filled it.
 *
 * The service is also registered as a kernel service (`registerService('messaging', service)`
 * in `messaging-service-plugin.ts`), and the kernel hands every plugin ONE
 * shared `PluginContext` whose `getService` carries no caller identity. So for
 * an in-process caller that same `userId` is a FREE PARAMETER: any plugin can
 * mark ANY user's inbox messages read, and the receipt write lands
 * context-lessly on an `engine-owned` object (ADR-0103), so no engine-level
 * permission check sees it either. Unconstrained and undeclared, in both
 * directions.
 *
 * The READ side has the same shape (#11452): `listInbox(userId, opts)` keys
 * its whole read — inbox rows joined with read-state — on the same free
 * parameter, so an in-process caller could read ANY user's inbox titles,
 * bodies and read-state. Both doors resolve their recipient here.
 *
 * The verbs here are the plugin-facing door, and the whole design is that they
 * take NO target user. The recipient is DERIVED from the caller's
 * {@link ExecutionContext}, so "mark someone else's inbox read" has no
 * spelling on this surface — it is unrepresentable rather than merely
 * discouraged. A plugin closing out a notification it pushed (the
 * emit-in-a-hook → close-out-in-a-later-hook pattern) is acting inside the
 * recipient's own request, and this is exactly the identity that request
 * carries.
 *
 * ## Why `userId` ONLY, and nothing that looks like it
 *
 * `ExecutionContext` carries three principal-shaped fields and only one of
 * them is an authorization subject:
 *
 *  - `userId` — "the subject the engine authorizes AS". The only one read here.
 *  - `attributedUserId` — ATTRIBUTION ONLY. Its own contract states the
 *    invariant: "nothing in the authorization path reads this", and a context
 *    carrying only it "authorizes exactly like a context carrying nothing —
 *    ANONYMOUS, per ADR-0118 D2". Promoting it here would open the second
 *    adjudication track ADR-0095 D3 closed, and it would do so on a write that
 *    clears someone's unread badge.
 *  - `actor` — a service-principal LABEL (`svc:<name>`), not a `sys_user` id.
 *    There is no inbox to clear for `svc:flow`.
 *
 * A tolerant `caller.userId ?? caller.attributedUserId ?? caller.actor` chain
 * is precisely the consumer-side widening contract-first exists to refuse: it
 * would read as working, and it would silently authorize the wrong principal.
 * There is no fallback and there must not be one.
 *
 * `isSystem: true` without a `userId` is refused for the same reason rather
 * than elevated: the system has no inbox, so there is no receipt it could be
 * the recipient of. A system caller that genuinely means "sweep this user"
 * still has `markRead(userId, ids)` — the door where naming a target user is
 * the declared contract.
 *
 * ## What this is, and what it is honestly NOT
 *
 * It is a DISCIPLINE boundary, not a security boundary, and the difference is
 * worth stating where the code is rather than discovering later. An in-process
 * plugin already holds the data engine and can write `sys_notification_receipt`
 * rows directly; nothing at this layer can stop trusted code that means to.
 * What this does is make the CORRECT pattern the only one the plugin-facing
 * surface expresses, and make the incorrect one fail loudly at the call site
 * instead of silently succeeding — which is the failure mode measured on the
 * existing path, where an absent caller returns `{ success: true, readCount: 0 }`
 * (the read path's analog: a well-formed empty
 * `{ notifications: [], unreadCount: 0 }` inbox).
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * The authenticated caller a plugin-facing inbox write acts as — the
 * `ExecutionContext` the caller was handed, passed through whole.
 *
 * Passed WHOLE, deliberately: the measured defect family behind
 * `assembleExecutionContext` (#6071, #6206, #6551) is "a field exists on
 * `ExecutionContext`, one copy carries it, another silently does not". A
 * hand-picked `{ userId }` slice here would be one more such copy.
 */
export type InboxCaller = ExecutionContext;

/**
 * The plugin-facing inbox refusal — write and read doors alike. Carries the
 * ADR-0112 envelope pair a
 * boundary reads — `status` + a registered `code` — so a caller that surfaces
 * it over HTTP answers `401 UNAUTHENTICATED` rather than the `500
 * INTERNAL_ERROR` a bare `Error` demotes to (`resolveThrownHttpError`,
 * `@objectstack/types`).
 *
 * `UNAUTHENTICATED` rather than `PERMISSION_DENIED`, and the distinction is
 * the point of the whole axis: there is no second identity for the caller to
 * disagree with, so there is no forbidden-target case to answer 403 for. The
 * only thing that can go wrong is having no authenticated principal at all.
 */
export class InboxCallerError extends Error {
    /** Registered `StandardErrorCode` — 401's standard member. */
    readonly code = 'UNAUTHENTICATED';
    /** HTTP answer this refusal declares (ADR-0112). */
    readonly status = 401;

    constructor(message: string) {
        super(message);
        this.name = 'InboxCallerError';
    }
}

/**
 * The recipient a plugin-facing inbox call acts on: the caller's
 * authenticated `userId`, or a refusal.
 *
 * Never returns a guess. Never falls back to `attributedUserId` / `actor` /
 * `isSystem` — see this module's header for why each of those is a wrong
 * answer rather than a missing feature.
 *
 * @param caller The caller's execution context (`undefined` is a refusal).
 * @param verb   The plugin-facing method name, so the refusal names the call.
 * @param targetUserDoor The contract method a caller that legitimately must
 *               NAME a target user still has, quoted in the refusal so the
 *               prescription matches the verb — `listInbox(userId, opts)` for
 *               the read door. Defaults to the write door's existing text, so
 *               the #10753 call sites keep their refusal bytes unchanged.
 * @throws {InboxCallerError} when no authenticated user can be resolved.
 */
export function resolveInboxRecipient(
    caller: InboxCaller | undefined,
    verb: string,
    targetUserDoor = 'markRead(userId, ids)',
): string {
    const userId = typeof caller?.userId === 'string' ? caller.userId.trim() : '';
    if (userId) return userId;

    // Name what WAS present, so the caller can tell "I passed nothing" from "I
    // passed a context whose principal is not an authorization subject" — the
    // second is the mistake that otherwise reads as a platform bug.
    const carried: string[] = [];
    if (caller?.attributedUserId) carried.push('attributedUserId');
    if (caller?.actor) carried.push('actor');
    if (caller?.isSystem) carried.push('isSystem');
    const detail = carried.length
        ? ` The context carries ${carried.join(' + ')}, which is attribution/privilege, never an authorization subject`
        : '';

    throw new InboxCallerError(
        `messaging: ${verb} requires an authenticated caller — no 'userId' on the execution context.${detail}. `
        + `This surface acts only on the CALLER'S OWN inbox and takes no target user; `
        + `a system/background sweep that must name one uses ${targetUserDoor}.`,
    );
}
