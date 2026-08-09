// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7136 — compile-time pin for the CONTEXT type this plugin's enforcement
 * methods accept.
 *
 * #6523 converged 36 contract signatures onto the full `ExecutionContext` (the
 * #6206 ruling: enforcement adjudicates on the whole `resolveAuthzContext`
 * envelope, never a per-site subset). #7136 is the consumer half — the
 * implementations here now annotate their own parameters with that same
 * envelope instead of the six-field shape they used to name.
 *
 * WHY THIS FILE EXISTS AT ALL. That convergence has no runtime behaviour and no
 * compiler pressure in either direction: the values were always complete, and
 * the narrow annotation is STRUCTURALLY ASSIGNABLE to the wide one, so
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
 * parameter — the boundary `SharingExecutionContext`'s own doc block records.
 *
 * WHY A `.pin.ts` AND NOT A `*.test.ts`: `packages/plugins/plugin-sharing/
 * tsconfig.json` excludes `**\/*.test.ts` (a measured TEST_DEBT of 3 in
 * `scripts/check-type-check-coverage.mjs`), so no tsc program the `typecheck`
 * script runs would ever read a pin written in a test file here — it would be
 * a phantom check that stays green however this file is broken (AGENTS.md,
 * #5286's `PINS_CHECKED`; #6212 measured the same hole on driver-mongodb).
 * This file IS in that program. It is imported by nothing, so tsup (entry
 * `src/index.ts`) never bundles it into `dist`, exactly like the sibling
 * `.testkit.ts`.
 */

import type { SharingService } from './sharing-service.js';
import type { SharingRuleService } from './sharing-rule-service.js';
import type { bootRequestContext } from './exec-context-seam.testkit.js';

type ReadFilterContext = Parameters<SharingService['buildReadFilter']>[1];
type WriteGateContext = Parameters<SharingService['checkEdit']>[2];
type GrantContext = Parameters<SharingService['grant']>[1];
type DefineRuleContext = Parameters<SharingRuleService['defineRule']>[1];

/** What the seam hands a test — the resolved envelope, not a projection of it. */
type SeamContext = Awaited<ReturnType<typeof bootRequestContext>>;

/**
 * Never called — every line below is a type-level assertion evaluated by
 * `tsc --noEmit`. The parameters are taken as arguments rather than read off a
 * live service so the pin needs no instance and no import cycle.
 */
export function __pinEnforcementTakesTheFullEnvelope(
  buildReadFilter: (object: string, context: ReadFilterContext) => unknown,
  checkEdit: (object: string, recordId: string, context: WriteGateContext) => unknown,
  grant: (input: never, context: GrantContext) => unknown,
  defineRule: (input: never, context: DefineRuleContext) => unknown,
  seamContext: SeamContext,
): void {
  // ── POSITIVE: fields that exist ONLY on the full envelope, no cast. ───────
  buildReadFilter('account', { userId: 'u1', posture: 'MEMBER', accessible_org_ids: ['org_a'] });
  checkEdit('account', 'a1', { userId: 'u1', posture: 'TENANT_ADMIN', org_user_ids: ['u1', 'u2'] });
  grant(undefined as never, { userId: 'u1', posture: 'PLATFORM_ADMIN' });
  defineRule(undefined as never, { userId: 'u1', accessible_org_ids: ['org_a'] });

  // The seam resolves a REAL context and returns it AS RESOLVED. Reading a
  // field the six-field shape never had is what pins that: the double cast
  // this card deleted (`as unknown as`) would have hidden any drift here.
  const posture: SeamContext['posture'] = seamContext.posture;
  void posture;

  // ── NEGATIVE: widening must not have degenerated into `any`. ─────────────
  // A parameter erased to `any` would swallow every positive above just as
  // happily, so the pin is only worth its weight if wrong input still fails.
  // @ts-expect-error 'SUPERUSER' is not an ADR-0095 posture rung
  buildReadFilter('account', { userId: 'u1', posture: 'SUPERUSER' });
  // @ts-expect-error `userId` is a string on the envelope, not a number
  checkEdit('account', 'a1', { userId: 42 });
  // @ts-expect-error `accessible_org_ids` is a string[], not a bare string
  defineRule(undefined as never, { accessible_org_ids: 'org_a' });
  // @ts-expect-error `organizationId` is NOT a field of the envelope — that
  // spelling has its own history (#5858 / `check:org-identifier`) and was held
  // out of #7136 on purpose. The three reads of it left in `sharing-rule-
  // service.ts` are still cast, and this line is why they have to be.
  grant(undefined as never, { organizationId: 'org_a' });
}
