// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7135 — compile-time pin for the CONTEXT type this plugin's enforcement
 * methods accept.
 *
 * #6523 converged 36 contract signatures onto the full `ExecutionContext` (the
 * #6206 ruling: enforcement adjudicates on the whole `resolveAuthzContext`
 * envelope, never a per-site subset). #7135 is the services half of the #7070
 * consumer split — the implementations here now annotate their own parameters
 * with that same envelope instead of the six-field shape they used to name.
 *
 * WHY THIS FILE EXISTS AT ALL. That convergence has no runtime behaviour and
 * no compiler pressure in either direction: the values were always complete,
 * and the narrow annotation is STRUCTURALLY ASSIGNABLE to the wide one, so
 * re-narrowing any of these parameters compiles, ships, and passes every test
 * in this package. Nothing would notice. This module is the one thing that
 * does — every declaration below is red exactly when a parameter narrows back.
 *
 * HOW IT BITES: TypeScript's excess-property check on a FRESH object literal.
 * `posture` (ADR-0095 D2), `accessible_org_ids` (ADR-0105 D2) and
 * `org_user_ids` are fields of the envelope that the retired six-field shape
 * did not carry, so a literal naming them is rejected the moment the parameter
 * is annotated with anything that lacks them. Note this is the ONLY direction
 * that works: a `@ts-expect-error` asserting the reverse would be unsatisfied
 * and fail the build, because a narrow context IS assignable to a wide
 * parameter — the boundary the retired type's own doc block records.
 *
 * WHY A `.pin.ts` AND NOT A `*.test.ts`: `packages/plugins/plugin-approvals/
 * tsconfig.json` excludes `**\/*.test.ts` (measured on this card, and the same
 * exclusion `plugin-sharing` carries — see #7136 / PR #7140), so no tsc
 * program the `typecheck` script runs would ever read a pin written in a test
 * file here: it would be a phantom check that stays green however this file is
 * broken (AGENTS.md, #5286's `PINS_CHECKED`). This file IS in that program. It
 * is imported by nothing, so tsup (entry `src/index.ts`) never bundles it into
 * `dist`.
 */

import type { ApprovalService } from './approval-service.js';

type GetRequestContext = Parameters<ApprovalService['getRequest']>[1];
type DecideContext = Parameters<ApprovalService['decide']>[2];
type ListActionsContext = Parameters<ApprovalService['listActions']>[1];
type AuthorizeFileReadContext = Parameters<ApprovalService['authorizeFileRead']>[1];
type OpenNodeRequestContext = Parameters<ApprovalService['openNodeRequest']>[1];
type ListRequestsContext = Parameters<ApprovalService['listRequests']>[1];

/**
 * Never called — every line below is a type-level assertion evaluated by
 * `tsc --noEmit`. The parameters are taken as arguments rather than read off a
 * live service so the pin needs no instance and no import cycle.
 */
export function __pinApprovalsTakesTheFullEnvelope(
  getRequest: (requestId: string, context: GetRequestContext) => unknown,
  decide: (requestId: string, input: never, context: DecideContext) => unknown,
  listActions: (requestId: string, context: ListActionsContext) => unknown,
  authorizeFileRead: (actionId: string, context: AuthorizeFileReadContext) => unknown,
  openNodeRequest: (input: never, context: OpenNodeRequestContext) => unknown,
  listRequests: (filter: undefined, context: ListRequestsContext) => unknown,
): void {
  // ── POSITIVE: fields that exist ONLY on the full envelope, no cast. ───────
  //
  // `posture` is the load-bearing one for THIS package: `isOverrideActor()`
  // reads it to decide whether a platform/tenant admin may release a stuck
  // approval, and until #7135 that read was an unchecked `(context as any)`.
  getRequest('req_1', { userId: 'u1', posture: 'PLATFORM_ADMIN' });
  decide('req_1', undefined as never, { userId: 'u1', posture: 'TENANT_ADMIN', org_user_ids: ['u1', 'u2'] });
  listActions('req_1', { userId: 'u1', accessible_org_ids: ['org_a'] });
  authorizeFileRead('act_1', { userId: 'u1', posture: 'MEMBER' });
  openNodeRequest(undefined as never, { userId: 'u1', posture: 'MEMBER', accessible_org_ids: ['org_a'] });
  listRequests(undefined, { userId: 'u1', org_user_ids: ['u1'] });

  // ── NEGATIVE: widening must not have degenerated into `any`. ─────────────
  // A parameter erased to `any` would swallow every positive above just as
  // happily, so the pin is only worth its weight if wrong input still fails.
  // @ts-expect-error 'SUPERUSER' is not an ADR-0095 posture rung
  getRequest('req_1', { userId: 'u1', posture: 'SUPERUSER' });
  // @ts-expect-error `userId` is a string on the envelope, not a number
  listActions('req_1', { userId: 42 });
  // @ts-expect-error `accessible_org_ids` is a string[], not a bare string
  authorizeFileRead('act_1', { accessible_org_ids: 'org_a' });
  // @ts-expect-error `organizationId` is NOT a field of the envelope — that
  // spelling has its own history (#5858 / `check:org-identifier`) and was held
  // out of #7135 on purpose. The reads of it left in `approval-service.ts` are
  // still cast, and this line is why they have to be.
  decide('req_1', undefined as never, { organizationId: 'org_a' });
}
