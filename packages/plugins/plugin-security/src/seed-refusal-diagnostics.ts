// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18091] The five remaining refusal diagnostics of the two declared-metadata
 * seeders — one wording, one token and one record PER SITE.
 *
 * ## What was wrong
 *
 * `bootstrapDeclaredCapabilities` and `bootstrapDeclaredPermissions` refuse to
 * write in five more places, and every one of those refusals was spelled
 * `logger?.warn?.(…)` — optionally chained TWICE, so a caller that injected no
 * logger got NO OUTPUT AT ALL. Measured on the pre-fix tree, each site driven
 * with no logger while all five console channels were spied:
 *
 * ```text
 *   curated platform capability refused   skippedPlatform = 1   lines = 0
 *   capability declaration unowned        skippedUnowned  = 1   lines = 0
 *   capability rows unreadable            unreadable      = 1   lines = 0
 *   permission set declaration unowned    (no counter)          lines = 0
 *   permission set rows unreadable        unreadable      = 1   lines = 0
 *   LIT CONTROL capability_name_collision skippedForeign  = 1   lines = 1
 *   LIT CONTROL permission_set_name_…     skippedForeign  = 1   lines = 1
 * ```
 *
 * The two lit controls are the already-repaired axes in the SAME harness, so
 * the zeros are a reading rather than an artefact of the probe.
 *
 * ⛔ Not one of the skips changes here. They are correct under ADR-0086 D4 (a
 * package never writes into a foreign record) and ADR-0086 D3 (a row that
 * cannot prove its owner makes uninstall undefined). The defect is only that
 * the refusal never reached the author who caused it.
 *
 * ## Why five diagnostics and not one
 *
 * #18023's delivery established the rule and it is applied here rather than
 * re-argued: the token, the record, the wording and the CONSEQUENCE are
 * site-specific — four of the six parts a refusal report is made of. The five
 * consequences below are genuinely different facts about the deployment:
 *
 *  - a curated-platform-name hijack still RESOLVES (the curated pass owns the
 *    row) and loses only the declaring package's authored metadata;
 *  - an unowned CAPABILITY declaration may resolve, may fall back to the
 *    back-compat derived placeholder, or may exist nowhere at all — three
 *    outcomes, decided by what already stands in `sys_capability`;
 *  - an unowned PERMISSION SET keeps every grant working (the evaluator
 *    resolves declared sets through the metadata registry) and loses only the
 *    RECORD — the Setup surface, the provenance axis and uninstall;
 *  - an unreadable read wrote nothing and compared nothing, so nothing is lost
 *    and nothing arrived either — and what "nothing arrived" costs differs
 *    again between the two tables.
 *
 * Wording them into one generic "declaration skipped" sentence would send every
 * author of the first kind hunting for a broken grant that is not broken.
 *
 * ## What IS shared
 *
 * Exactly one thing: WHERE the line goes. {@link reportThroughSink} carries the
 * delivery rule for all five, so this card adds one derivation rather than five
 * more copies of the two lines #17516 and #18023 each wrote out by hand.
 *
 * ## Why `event` and not `code`
 *
 * Every token below is a snake_case DATA VALUE, not an ADR-0112 error code: it
 * is never routed to `error.code`, never reaches a wire refusal, and travels as
 * the structured half of a warning about an artifact — the same discrimination
 * `CAPABILITY_NAME_COLLISION` and `PERMISSION_SET_NAME_COLLISION` already make.
 */

import { reportThroughSink, type CollisionReportSink } from './seed-refusal-sink.js';

export type { CollisionReportSink };

// ───────────────────────────────────────────────────────────────────────────
// Tokens — one grep string per refusal kind.
// ───────────────────────────────────────────────────────────────────────────

/** A package declared a capability whose name is a CURATED platform capability. */
export const CAPABILITY_PLATFORM_NAME_REFUSED = 'capability_platform_name_refused';

/** A declared capability carries no resolvable owning package. */
export const CAPABILITY_DECLARATION_UNOWNED = 'capability_declaration_unowned';

/** Declared capabilities left untouched because `sys_capability` could not be read. */
export const CAPABILITY_ROWS_UNREADABLE = 'capability_rows_unreadable';

/** A declared permission set carries no resolvable owning package. */
export const PERMISSION_SET_DECLARATION_UNOWNED = 'permission_set_declaration_unowned';

/** Declared sets left untouched because `sys_permission_set` could not be read. */
export const PERMISSION_SET_ROWS_UNREADABLE = 'permission_set_rows_unreadable';

/**
 * Severity is `warning` on all five for the #4632 reason: this is FUNCTIONAL
 * degradation, never a durability failure. Nothing claimed to be persisted
 * silently failed to land.
 */
type RefusalSeverity = 'warning';

/** The shape every diagnostic in this module shares — ⛔ the wording is not part of it. */
interface SeedRefusalDiagnosticBase {
  readonly severity: RefusalSeverity;
  readonly message: string;
  readonly fix: string;
}

// ───────────────────────────────────────────────────────────────────────────
// SITE 1 — a package declares a CURATED platform capability name.
// ───────────────────────────────────────────────────────────────────────────

/** One declared capability refused because its name is platform-curated. */
export interface CapabilityPlatformNameRefusedDiagnostic extends SeedRefusalDiagnosticBase {
  readonly event: typeof CAPABILITY_PLATFORM_NAME_REFUSED;
  /** The declared capability's name — a member of `PLATFORM_CAPABILITY_NAMES`. */
  readonly name: string;
  /**
   * The package whose declaration was dropped. `null` when the declaration
   * carries no resolvable owner either: this refusal is decided BEFORE the
   * owner check, so both faults can be true of one declaration and printing
   * `undefined` at an author is not an option.
   */
  readonly declaredBy: string | null;
  /** The bootstrap permission set(s) granting it — the blast radius, named. */
  readonly grantedBy: readonly string[];
}

/**
 * Word the curated-name refusal.
 *
 * ⚠️ The consequence differs from a foreign-owner collision even though both
 * end in "the declaration was not applied": the curated pass of
 * `bootstrapSystemCapabilities` seeds every curated name UNCONDITIONALLY, so
 * the row is there whatever this seeder decides. Nothing is denied. What the
 * author loses is the authored label/description/scope and the ADR-0086 D3
 * provenance claim — and the remedy is not "co-own the namespace" (the
 * ADR-0130 D1 escape the collision diagnostic offers) but "rename", because a
 * curated platform name is never available to a package on any terms.
 */
export function capabilityPlatformNameRefusedDiagnostic(input: {
  name: string;
  declaredBy?: string | null;
  grantedBy?: readonly string[];
}): CapabilityPlatformNameRefusedDiagnostic {
  const declaredBy = input.declaredBy ?? null;
  const declarer = declaredBy ?? '(a declaration with no owning package)';
  const grantedBy = [...(input.grantedBy ?? [])];
  const blastRadius = grantedBy.length > 0
    ? `Permission set(s) granting it: ${grantedBy.join(', ')} — those grants keep resolving, ` +
      `against the PLATFORM's capability rather than this package's declaration.`
    : `No bootstrap permission set grants it, so nothing is denied today — but the declaration ` +
      `is still inert.`;
  return {
    event: CAPABILITY_PLATFORM_NAME_REFUSED,
    severity: 'warning',
    name: input.name,
    declaredBy,
    grantedBy,
    message:
      `[security] [${CAPABILITY_PLATFORM_NAME_REFUSED}] Package ${declarer} declares capability ` +
      `"${input.name}", but that name is a CURATED PLATFORM capability. The declaration was NOT ` +
      `applied — a package must never redefine a platform-owned capability — so the curated pass ` +
      `keeps the sys_capability row, the declaring package's authored label, description and ` +
      `scope are not in effect, and the capability carries no package provenance (ADR-0086 D3). ` +
      `The name still resolves against the curated row, which is why nothing else reports this. ` +
      `${blastRadius}`,
    fix:
      `Rename the capability in package ${declarer} to a name it owns (prefix it with the ` +
      `package's own module prefix). ⛔ A curated platform name is not co-ownable: unlike a ` +
      `package-to-package collision (ADR-0130 D1) there is no arrangement under which a package ` +
      `may declare it.`,
  };
}

/** Report one curated-name refusal so it reaches the author with no sink injected. */
export function reportCapabilityPlatformNameRefused(
  logger: CollisionReportSink | undefined,
  d: CapabilityPlatformNameRefusedDiagnostic,
): void {
  reportThroughSink(logger, `${d.message} Fix: ${d.fix}`, {
    event: d.event,
    name: d.name,
    declaredBy: d.declaredBy,
    grantedBy: [...d.grantedBy],
    fix: d.fix,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// SITE 2 — a declared CAPABILITY with no resolvable owning package.
// ───────────────────────────────────────────────────────────────────────────

/** One declared capability refused for want of an owning package. */
export interface CapabilityDeclarationUnownedDiagnostic extends SeedRefusalDiagnosticBase {
  readonly event: typeof CAPABILITY_DECLARATION_UNOWNED;
  readonly name: string;
  /** The bootstrap permission set(s) granting it. */
  readonly grantedBy: readonly string[];
  /** Whether a `sys_capability` row already resolves the name — it decides the consequence. */
  readonly hasRow: boolean;
}

/**
 * Word the unowned-capability refusal.
 *
 * ⚠️ [#4967 Part 3] The three-way consequence below is LOAD-BEARING and is
 * preserved verbatim from the sentence this card found at the call site: a
 * seeder-side warn that names the capability but not the permission set(s) that
 * grant it does not tell the reader what happened. `hasRow` is the reason the
 * existence read is taken BEFORE the refusal rather than after it.
 */
export function capabilityDeclarationUnownedDiagnostic(input: {
  name: string;
  grantedBy?: readonly string[];
  hasRow: boolean;
}): CapabilityDeclarationUnownedDiagnostic {
  const grantedBy = [...(input.grantedBy ?? [])];
  const granted = grantedBy.length > 0
    ? `granted by ${grantedBy.join(', ')}`
    : 'granted by no bootstrap permission set';
  const consequence = input.hasRow
    ? 'an existing sys_capability row already resolves it and is left as-is — the declaration adds no package provenance'
    : grantedBy.length > 0
      ? 'falls back to the back-compat derived placeholder — the grant resolves, but with no package provenance (ADR-0086 D3: uninstall undefined)'
      : 'nothing derives it either — the capability is materialized nowhere';
  return {
    event: CAPABILITY_DECLARATION_UNOWNED,
    severity: 'warning',
    name: input.name,
    grantedBy,
    hasRow: input.hasRow,
    message:
      `[security] [${CAPABILITY_DECLARATION_UNOWNED}] declared capability "${input.name}" has no ` +
      `owning package (${granted}): ${consequence}`,
    fix:
      `Stamp the declaring package on the capability — the SchemaRegistry's _packageId ` +
      `(ADR-0010), or the spec-level packageId (ADR-0086 D3) as the author-declared fallback. ` +
      `A package-managed row with no package_id is the ambiguity ADR-0086 D3 removes, which is ` +
      `why this seeder writes none.`,
  };
}

/** Report one unowned-capability refusal so it reaches the author with no sink injected. */
export function reportCapabilityDeclarationUnowned(
  logger: CollisionReportSink | undefined,
  d: CapabilityDeclarationUnownedDiagnostic,
): void {
  reportThroughSink(logger, `${d.message}. Fix: ${d.fix}`, {
    event: d.event,
    name: d.name,
    grantedBy: [...d.grantedBy],
    hasRow: d.hasRow,
    fix: d.fix,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// SITE 3 — declared capabilities whose rows could not be READ.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Report the unreadable-rows summary for the capability pass.
 *
 * ONE line per pass with the count, never a line per name: a database that is
 * down refuses every name at once and a warn each is a flood that buries its
 * own meaning.
 *
 * ⚠️ The consequence has to be SAID. "Unreadable" alone states none, and the
 * two halves differ: a genuinely new declaration among these names has no row
 * at all, while one whose stored metadata drifted from the shipped declaration
 * keeps the stale value. Nothing was written, so nothing is lost — the next
 * boot with a readable database does both — but until then the registry does
 * not reflect what these packages declare.
 *
 * ⛔ This one is deliberately NOT exported from the package entry: unlike the
 * two refusals an author can cause, an unreadable database is a runtime
 * condition no compile-time door can raise, so there is no second consumer by
 * construction (the discrimination `position_name_fold_grant` already makes).
 */
export function reportCapabilityRowsUnreadable(
  logger: CollisionReportSink | undefined,
  input: { unreadable: number; total: number },
): void {
  reportThroughSink(
    logger,
    `[security] [${CAPABILITY_ROWS_UNREADABLE}] declared capabilities left untouched — their ` +
      `sys_capability rows could not be read. ${input.unreadable} of ${input.total} declaration(s) ` +
      `were neither created nor reconciled: a genuinely new one among them has no sys_capability ` +
      `row, and one whose stored label, description or scope has drifted from the shipped ` +
      `declaration keeps the stale value. Nothing was written and nothing is lost — the next boot ` +
      `with a readable database does both — but until then the registry does not reflect what ` +
      `these packages declare.`,
    { event: CAPABILITY_ROWS_UNREADABLE, unreadable: input.unreadable, total: input.total },
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SITE 4 — a declared PERMISSION SET with no resolvable owning package.
// ───────────────────────────────────────────────────────────────────────────

/** One declared permission set refused for want of an owning package. */
export interface PermissionSetDeclarationUnownedDiagnostic extends SeedRefusalDiagnosticBase {
  readonly event: typeof PERMISSION_SET_DECLARATION_UNOWNED;
  readonly name: string;
  /** The organization whose pass refused it, when the walled per-organization door is in force. */
  readonly organizationId?: string;
}

/**
 * Word the unowned-permission-set refusal.
 *
 * ⚠️ The consequence is NOT the capability axis'. `stack.permissions` has
 * always been runtime-ENFORCED — the evaluator resolves declared sets through
 * the metadata registry — so every grant in the refused set keeps working. What
 * is lost is the RECORD (ADR-0086 D5, the ADR-0078 inert-metadata smell this
 * seeder exists to close): the Setup admin surface reads `sys_permission_set`
 * and cannot see the set, there is no provenance axis for it, and uninstall
 * (`cleanupPackagePermissions`) has nothing to reap. An author told "not
 * materialized" and left to guess will go looking for a denied user who does
 * not exist.
 */
export function permissionSetDeclarationUnownedDiagnostic(input: {
  name: string;
  organizationId?: string;
}): PermissionSetDeclarationUnownedDiagnostic {
  return {
    event: PERMISSION_SET_DECLARATION_UNOWNED,
    severity: 'warning',
    name: input.name,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    message:
      `[security] [${PERMISSION_SET_DECLARATION_UNOWNED}] declared permission set ` +
      `"${input.name}" has no owning package — not materialized. A managed_by:'package' row ` +
      `without a package_id is the ambiguity ADR-0086 D3 removes, so no row is written. The ` +
      `evaluator still resolves the DECLARED set through the metadata registry, so its object, ` +
      `field, tab and system permissions all keep working — what is missing is the RECORD: the ` +
      `Setup admin surface reads sys_permission_set and cannot see this set, it carries no ` +
      `provenance axis, and uninstall has nothing to reap (ADR-0086 D5).`,
    fix:
      `Stamp the declaring package on the set — the SchemaRegistry's _packageId (ADR-0010), or ` +
      `the spec-level packageId (ADR-0086 D3) as the author-declared fallback.`,
  };
}

/** Report one unowned-set refusal so it reaches the author with no sink injected. */
export function reportPermissionSetDeclarationUnowned(
  logger: CollisionReportSink | undefined,
  d: PermissionSetDeclarationUnownedDiagnostic,
): void {
  reportThroughSink(logger, `${d.message} Fix: ${d.fix}`, {
    event: d.event,
    name: d.name,
    ...(d.organizationId ? { organization: d.organizationId } : {}),
    fix: d.fix,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// SITE 5 — declared permission sets whose rows could not be READ.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Report the unreadable-rows summary for the permission-set pass.
 *
 * ⚠️ Said once with the count, and the consequence spelled out for the SAME
 * reason as the capability summary and with a DIFFERENT content: silence here
 * reads exactly like "everything was already in order". The declared sets stay
 * runtime-enforced through the metadata registry, so nothing is denied — what
 * did not happen is the materialization, and a drifted row keeps its stale
 * grants until a boot that can read the table.
 *
 * ⛔ Package-private for the same reason as its capability sibling: an
 * unreadable database is a runtime condition, not an authoring fault.
 */
export function reportPermissionSetRowsUnreadable(
  logger: CollisionReportSink | undefined,
  input: { unreadable: number; total: number; organizationId?: string },
): void {
  reportThroughSink(
    logger,
    `[security] [${PERMISSION_SET_ROWS_UNREADABLE}] declared permission sets left untouched — ` +
      `their records could not be read. ${input.unreadable} of ${input.total} declared set(s) ` +
      `were neither seeded nor reconciled: a genuinely new set has no sys_permission_set row, so ` +
      `the Setup admin surface cannot see it and uninstall has nothing to reap (ADR-0086 D5), and ` +
      `a set whose stored grants drifted from the shipped declaration keeps the stale row. The ` +
      `evaluator still resolves the DECLARED sets through the metadata registry, so no grant is ` +
      `denied today; the next boot with a readable database materializes them.`,
    {
      event: PERMISSION_SET_ROWS_UNREADABLE,
      unreadable: input.unreadable,
      total: input.total,
      ...(input.organizationId ? { organization: input.organizationId } : {}),
    },
  );
}
