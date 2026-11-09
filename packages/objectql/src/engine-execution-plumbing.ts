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
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * Build a HookContext.session from ExecutionContext — WHO is calling.
 *
 * Returns `undefined` when the context yields nothing session-worthy, which
 * keeps `!ctx.session` meaning exactly one thing for hooks: "no identity
 * envelope was supplied" — the bare-kernel / programmatic call that
 * caller-gating hooks skip for. A context carrying only write PROVENANCE
 * (`{ flowRunId }`, all an identity-less flow run has — #3712) is such a
 * case: it says what produced the write, not who is calling, and surfaces
 * through {@link buildProvenance} instead. Every real transport resolves
 * `positions` into the context, so an anonymous HTTP request still yields a
 * session and stays gated.
 */
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
  if (!Object.values(session as Record<string, unknown>).some((v) => v !== undefined)) return undefined;
  // [#26170] The caller's locale rides on a session that exists, so the
  // sandboxed body runner can answer a declared hook refusal in the caller's
  // language. It is asked AFTER the presence test on purpose: a locale alone
  // says how to speak, not who is speaking, and must not turn "no caller"
  // into a session either.
  const locale = (execCtx as { locale?: unknown }).locale;
  if (typeof locale === 'string' && locale.length > 0) (session as { locale?: string }).locale = locale;
  return session;
}

/**
 * Build the HookContext.provenance envelope — WHERE this write came from.
 *
 * Deliberately separate from {@link buildSession}: provenance is server-
 * stamped, evaluated by no security middleware, and can exist with no
 * identity beside it. A schedule-triggered flow run resolves no principal
 * yet still owns its writes, and that is the case the approvals record lock
 * needs to recognize (#3456 / #3712).
 *
 * `attributedUserId` rides the SAME envelope for the same reason (#4586):
 * a better-auth-originated write authorizes as the system, so the human who
 * triggered it must reach the audit writer WITHOUT appearing in `session` —
 * where every caller-gating hook would read them as the caller. Attribution
 * here, authorization in `session`/`isSystem`, never the two mixed.
 *
 * `performedByClientId` rides it for the THIRD time on the same reasoning
 * (#17022, ADR-0090 D10 rule 4): an MCP OAuth agent's write authorizes as
 * the human it acts for, so the acting client can only reach the audit
 * writer through a channel that is not `session` — putting it there would
 * make every caller-gating hook read the client as the caller, which is the
 * opposite of what the delegation means. This copy list is the whole reason
 * the field is not inert: `HookContext` is built from a CLOSED literal whose
 * `provenance` value is exactly what this function returns, so a key
 * declared on `hook.zod.ts` and missing here is declared and never
 * populated (ADR-0049).
 *
 * `impersonatedBy` rides it for the FOURTH time: an impersonation session's
 * write authorizes as the impersonated user, so the administrator at the
 * keyboard reaches the audit writer here and never through `session`, where
 * every caller-gating hook would read the administrator as the caller.
 */
export function buildProvenance(execCtx?: ExecutionContext): HookContext['provenance'] {
  const flowRunId = (execCtx as any)?.flowRunId;
  const attributedUserId = (execCtx as any)?.attributedUserId;
  const performedByClientId = (execCtx as any)?.performedBy?.clientId;
  const impersonatedBy = (execCtx as any)?.impersonatedBy;
  if (!flowRunId && !attributedUserId && !performedByClientId && !impersonatedBy) return undefined;
  return {
    ...(flowRunId ? { flowRunId: String(flowRunId) } : {}),
    ...(attributedUserId ? { attributedUserId: String(attributedUserId) } : {}),
    ...(performedByClientId ? { performedByClientId: String(performedByClientId) } : {}),
    ...(impersonatedBy ? { impersonatedBy: String(impersonatedBy) } : {}),
  };
}

/**
 * Build the acting-user object (ADR-0068 EvalUser shape) surfaced to
 * validation-time predicates as `current_user` — notably per-option
 * `visibleWhen` authorization gating (objectui#2284). Returns undefined for
 * system / unauthenticated writes, where membership predicates then fail-open.
 */
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

/**
 * Build the `HookContext.user` shortcut — the ergonomic "current user"
 * object surfaced to JS hooks. Carries `organizationId` (the blessed name
 * for the caller's active org, identical to `session.organizationId` and
 * `current_user.organizationId`) so a hook author who needs "the current org
 * to filter by" writes `ctx.user.organizationId` with zero relearning (#3280).
 *
 * Returns undefined for system / unauthenticated writes (no acting user) —
 * hooks that need an org regardless of a resolved user read
 * `ctx.session.organizationId`, which is populated whenever a session is.
 */
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
