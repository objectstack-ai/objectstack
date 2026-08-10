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
 * HOW IT BITES, part 1: TypeScript's excess-property check on a FRESH object
 * literal. `posture` (ADR-0095 D2), `accessible_org_ids` (ADR-0105 D2) and
 * `org_user_ids` are fields of the envelope that the retired six-field shape
 * did not carry, so a literal naming them is rejected the moment the parameter
 * is annotated with anything that lacks them. Note this is the ONLY direction
 * that works: a `@ts-expect-error` asserting the reverse would be unsatisfied
 * and fail the build, because a narrow context IS assignable to a wide
 * parameter — see item 3 of the module doc on
 * `@objectstack/spec/contracts/sharing-service` for that boundary.
 *
 * HOW IT BITES, part 2 (#7218): type IDENTITY against the retired shape itself.
 * #7136's failure story was "the parameter narrows back to
 * `SharingExecutionContext`" — a type that no longer exists, since #7218
 * deleted it from the contract surface once all three implementations had been
 * re-annotated. Deleting the type does NOT delete the failure mode: the six
 * fields can be re-declared here under any name, and the literal checks above
 * only fire on the fields a given literal happens to spell. So the retired
 * shape is kept below as a local SPECIMEN and each parameter is refuted
 * against it. A re-narrowing is then red twice over, and neither check depends
 * on the retired export coming back.
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
 * [#7218] The RETIRED six-field shape, kept here as a SPECIMEN — a deliberate
 * COPY of the type `@objectstack/spec` exported as `SharingExecutionContext`
 * until #7218 deleted it (and this package re-exported until the same card).
 * Copied rather than imported on purpose: nothing may depend on the retired
 * name again, and a local copy is what lets this pin keep naming the shape it
 * refuses after the export is gone.
 *
 * ⛔ Not a vocabulary to reach for, and not exported.
 */
type RetiredSharingContextSpecimen = {
  userId?: string;
  tenantId?: string;
  positions?: string[];
  permissions?: string[];
  systemPermissions?: string[];
  isSystem?: boolean;
};

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
/** Compile error when the argument is not `false`. */
type Refute<T extends false> = T;

/**
 * NEGATIVE, at the type level: no enforcement parameter IS the retired shape.
 * Red the moment one is re-annotated with those six fields under any spelling
 * — the failure #7136's pin told as "narrows back to `SharingExecutionContext`",
 * restated so it no longer needs the deleted name to be checkable.
 */
type _NotTheRetiredShape = [
  Refute<Eq<ReadFilterContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<WriteGateContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<GrantContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<DefineRuleContext, RetiredSharingContextSpecimen>>,
];

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

  // ── NEGATIVE: none of these parameters IS the retired six-field shape. ───
  // The tuple is `[false, false, false, false]` exactly when every `Refute`
  // above holds; a parameter re-narrowed to the specimen makes its slot `true`
  // and this assignment stops compiling.
  const notTheRetiredShape: _NotTheRetiredShape = [false, false, false, false];
  void notTheRetiredShape;

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
