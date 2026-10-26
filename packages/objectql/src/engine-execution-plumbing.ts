// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 9] The caller-envelope builders of `ObjectQL`'s execution
 * plumbing, moved out of `engine.ts` whole: `buildSession` (the
 * `HookContext.session` a hook reads, WHO is calling), `buildProvenance` (the
 * `HookContext.provenance` envelope, WHERE a write came from), `buildEvalUser`
 * (the ADR-0068 `current_user` validation-time predicates read) and
 * `buildUser` (the `HookContext.user` shortcut).
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same copy list, the same flags carried only when
 * set, and the same `undefined` for a context with nothing to say. Each
 * method's docblock stays on the method in `engine.ts`, which is still the
 * contract.
 *
 * What stays in the class: `executeWithMiddleware`, because ADR-0139 cites it
 * by `engine.ts#executeWithMiddleware`; `buildReferentialFieldClear` and
 * `claimReferentialCascadeDelete`, whose bodies are no longer than the call
 * (and, for the second, the host literal) moving them would cost.
 *
 * ## How the moved bodies reach the class
 *
 * None of the four reads a member of the engine: each is a function of the
 * `ExecutionContext` it is handed. So there is no host object here — there
 * is no shared state to hand over — and each method keeps its name,
 * modifiers, signature, docblock and position and calls the function of the
 * same name directly, as the member-free bodies of earlier cuts do
 * (`engine-validation-messages.ts#objectDisplayLabel`).
 *
 * This module imports nothing from the engine, so there is no module cycle at
 * run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/** The body of `ObjectQL#buildSession`; the method's docblock there is its contract. */
export function buildSession(execCtx?: ExecutionContext): HookContext['session'] {
  if (!execCtx) return undefined;
  const session = {
    userId: execCtx.userId,
    // `organizationId` is the blessed developer-facing name for the caller's
    // active org (matches the `organization_id` column, `current_user`
    // RLS shape, and seed rows). It comes from `execCtx.tenantId`, which the
    // kernel resolves from `session.activeOrganizationId`. The deprecated
    // `session.tenantId` alias (#3280) was removed here in v16 (#3290) — the
    // driver-layer `execCtx.tenantId` knob is a separate axis and stays.
    organizationId: execCtx.tenantId,
    positions: execCtx.positions,
    accessToken: execCtx.accessToken,
    // Propagate system-elevated flag so hooks can distinguish engine
    // self-writes (e.g. approval status mirror) from genuine user writes.
    ...((execCtx as any).isSystem ? { isSystem: true } : {}),
    // Propagate the service-principal label (`ExecutionContext.actor`,
    // e.g. `svc:flow:<name>`) so a non-user write stays attributable in the
    // audit log — the writer's `userId ?? session.actor` fallback is dead
    // without this hop (the `ExecutionContext.actor` audit-attribution
    // contract, `@objectstack/spec` kernel/execution-context.zod.ts; #4366).
    ...(typeof (execCtx as any).actor === 'string' && (execCtx as any).actor
      ? { actor: (execCtx as any).actor }
      : {}),
    // Propagate the automation-suppression flag so the record-change trigger
    // can skip flow dispatch for seed/bulk writes (ADR: seed loads end-state
    // data, not user events). `skipAutomations` implies `skipTriggers` —
    // suppressing metadata hooks while still dispatching flows would leave
    // the "run automations & triggers" opt-out half-working (#2922).
    ...((execCtx as any).skipTriggers || (execCtx as any).skipAutomations ? { skipTriggers: true } : {}),
    // Propagate the full automation opt-out so `triggerHooks` can skip
    // metadata-bound hooks (import with "run automations" unchecked, undo).
    ...((execCtx as any).skipAutomations ? { skipAutomations: true } : {}),
    // Propagate the historical-import audit-preservation flag so the built-in
    // audit hook keeps a client-supplied updated_at/updated_by instead of
    // stamping now (#3493). Opt-in, server-set only.
    ...((execCtx as any).preserveAudit ? { preserveAudit: true } : {}),
  } as HookContext['session'];
  // Nothing to say about the caller → say nothing. An object whose every
  // property is `undefined` conveys no more than no session at all, and
  // returning it would turn "no caller" into "an anonymous caller".
  return Object.values(session as Record<string, unknown>).some((v) => v !== undefined)
    ? session
    : undefined;
}

/** The body of `ObjectQL#buildProvenance`; the method's docblock there is its contract. */
export function buildProvenance(execCtx?: ExecutionContext): HookContext['provenance'] {
  const flowRunId = (execCtx as any)?.flowRunId;
  const attributedUserId = (execCtx as any)?.attributedUserId;
  const performedByClientId = (execCtx as any)?.performedBy?.clientId;
  if (!flowRunId && !attributedUserId && !performedByClientId) return undefined;
  return {
    ...(flowRunId ? { flowRunId: String(flowRunId) } : {}),
    ...(attributedUserId ? { attributedUserId: String(attributedUserId) } : {}),
    ...(performedByClientId ? { performedByClientId: String(performedByClientId) } : {}),
  };
}

/** The body of `ObjectQL#buildEvalUser`; the method's docblock there is its contract. */
export function buildEvalUser(
  execCtx?: ExecutionContext,
): { id: string; positions: string[]; organizationId: string | null } | undefined {
  if (!execCtx || execCtx.userId == null) return undefined;
  return {
    id: String(execCtx.userId),
    positions: execCtx.positions ?? [],
    organizationId: execCtx.tenantId != null ? String(execCtx.tenantId) : null,
  };
}

/** The body of `ObjectQL#buildUser`; the method's docblock there is its contract. */
export function buildUser(execCtx?: ExecutionContext): HookContext['user'] {
  if (!execCtx || execCtx.userId == null) return undefined;
  return {
    id: String(execCtx.userId),
    ...(execCtx.email ? { email: execCtx.email } : {}),
    // Always equals `session.organizationId` (both from `execCtx.tenantId`).
    // Undefined on unscoped (platform/community) calls.
    ...(execCtx.tenantId != null ? { organizationId: String(execCtx.tenantId) } : {}),
  };
}
