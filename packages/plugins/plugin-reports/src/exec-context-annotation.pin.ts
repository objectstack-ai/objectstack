// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7135 — compile-time pin for the CONTEXT type this plugin's report methods
 * accept, and for what `OwnerContextResolver` is required to return.
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
 * #7135's failure story was "the parameter narrows back to the six-field
 * `SharingExecutionContext`" — a type that no longer exists, since #7218
 * deleted it from the contract surface once all three implementations had been
 * re-annotated. Deleting the type does NOT delete the failure mode: the six
 * fields can be re-declared here under any name, and the literal checks above
 * only fire on the fields a given literal happens to spell. So the retired
 * shape is kept below as a local SPECIMEN and each parameter is refuted
 * against it. A re-narrowing is then red twice over, and neither check depends
 * on the retired export coming back.
 *
 * WHY A `.pin.ts` AND NOT A `*.test.ts`: unlike its sibling packages,
 * `packages/plugins/plugin-reports/tsconfig.json` does NOT exclude
 * `**\/*.test.ts` (measured on this card — `plugin-approvals` and
 * `plugin-sharing` both do), so a pin in a test file here would in fact be
 * read by `tsc --noEmit`. The `.pin.ts` convention is kept anyway: it does not
 * depend on that exclusion staying absent, it survives a vitest-only run that
 * never type-checks, and it keeps both halves of this card's pin identical in
 * shape. It is imported by nothing, so tsup (entry `src/index.ts`) never
 * bundles it into `dist`.
 */

import type { ReportService, OwnerContextResolver } from './report-service.js';

type SaveReportContext = Parameters<ReportService['saveReport']>[1];
type RunContext = Parameters<ReportService['run']>[1];
type GetReportContext = Parameters<ReportService['getReport']>[1];
type ScheduleReportContext = Parameters<ReportService['scheduleReport']>[1];
type ListSchedulesContext = Parameters<ReportService['listSchedules']>[1];

/**
 * What a scheduled run executes AS. `resolveOwnerContext` resolves a saved
 * report's owner into a real, RLS-bearing context so the digest sees the rows
 * the owner would see interactively (#2849 / #2980); typing its result as the
 * envelope is what lets `executeReport` read the whole thing it was handed.
 */
type ResolvedOwnerContext = NonNullable<Awaited<ReturnType<OwnerContextResolver>>>;

/**
 * [#7218] The RETIRED six-field shape, kept here as a SPECIMEN — a deliberate
 * COPY of the type `@objectstack/spec` exported as `SharingExecutionContext`
 * until #7218 deleted it. Copied rather than imported on purpose: nothing may
 * depend on the retired name again, and a local copy is what lets this pin keep
 * naming the shape it refuses after the export is gone.
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
 * NEGATIVE, at the type level: neither the method parameters nor what the owner
 * resolver hands back IS the retired shape. Red the moment one is re-annotated
 * with those six fields under any spelling — the failure #7135's pin told as
 * "narrows back to `SharingExecutionContext`", restated so it no longer needs
 * the deleted name to be checkable. `ResolvedOwnerContext` is included because a
 * scheduled run adjudicates on whatever the resolver's RETURN type says it has.
 */
type _NotTheRetiredShape = [
  Refute<Eq<SaveReportContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<RunContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<GetReportContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<ScheduleReportContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<ListSchedulesContext, RetiredSharingContextSpecimen>>,
  Refute<Eq<ResolvedOwnerContext, RetiredSharingContextSpecimen>>,
];

/**
 * Never called — every line below is a type-level assertion evaluated by
 * `tsc --noEmit`. The parameters are taken as arguments rather than read off a
 * live service so the pin needs no instance and no import cycle.
 */
export function __pinReportsTakesTheFullEnvelope(
  saveReport: (input: never, context: SaveReportContext) => unknown,
  run: (reportId: string, context: RunContext) => unknown,
  getReport: (reportId: string, context: GetReportContext) => unknown,
  scheduleReport: (input: never, context: ScheduleReportContext) => unknown,
  listSchedules: (filter: undefined, context: ListSchedulesContext) => unknown,
  ownerContext: ResolvedOwnerContext,
): void {
  // ── POSITIVE: fields that exist ONLY on the full envelope, no cast. ───────
  saveReport(undefined as never, { userId: 'u1', posture: 'MEMBER' });
  run('rep_1', { userId: 'u1', posture: 'TENANT_ADMIN', accessible_org_ids: ['org_a'] });
  getReport('rep_1', { userId: 'u1', org_user_ids: ['u1', 'u2'] });
  scheduleReport(undefined as never, { userId: 'u1', accessible_org_ids: ['org_a'] });
  listSchedules(undefined, { userId: 'u1', posture: 'PLATFORM_ADMIN' });

  // The resolver hands back what it RESOLVED. Reading a field the six-field
  // shape never had is what pins that: a scheduled run adjudicates on the
  // whole envelope or it is not running as the owner at all.
  const posture: ResolvedOwnerContext['posture'] = ownerContext.posture;
  void posture;

  // ── NEGATIVE: none of these types IS the retired six-field shape. ────────
  // The tuple is all-`false` exactly when every `Refute` above holds; a
  // parameter (or the resolver's return type) re-narrowed to the specimen makes
  // its slot `true` and this assignment stops compiling.
  const notTheRetiredShape: _NotTheRetiredShape = [false, false, false, false, false, false];
  void notTheRetiredShape;

  // ── NEGATIVE: widening must not have degenerated into `any`. ─────────────
  // A parameter erased to `any` would swallow every positive above just as
  // happily, so the pin is only worth its weight if wrong input still fails.
  // @ts-expect-error 'SUPERUSER' is not an ADR-0095 posture rung
  run('rep_1', { userId: 'u1', posture: 'SUPERUSER' });
  // @ts-expect-error `userId` is a string on the envelope, not a number
  getReport('rep_1', { userId: 42 });
  // @ts-expect-error `accessible_org_ids` is a string[], not a bare string
  listSchedules(undefined, { accessible_org_ids: 'org_a' });
  // @ts-expect-error `organizationId` is NOT a field of the envelope — that
  // spelling has its own history (#5858 / `check:org-identifier`) and was held
  // out of #7135 on purpose.
  saveReport(undefined as never, { organizationId: 'org_a' });
}
