// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17516] The set-name collision diagnostic — ONE derivation, ONE wording, for
 * every door that has to tell an author their declared permission set was not
 * materialized.
 *
 * ## What was wrong
 *
 * `bootstrapDeclaredPermissions` refuses to write into a `sys_permission_set`
 * row another package owns (ADR-0086 D4: a package never writes into a foreign
 * record). That refusal is CORRECT and is unchanged here. What was wrong is
 * that it was INVISIBLE: the whole declared set vanished with an internal
 * counter incremented and one `logger?.warn?.(…)` line — optionally chained
 * TWICE, so a caller that passed no logger produced no output at all. The
 * comment at that branch said "refuse loudly"; nothing about it was loud, and
 * nothing was written back anywhere an author could read it.
 *
 * That is the #10556 doctrine's own failure shape, one surface over: a report
 * channel that is silent by declaration. The maintainer ruling there
 * (2026-08-24) rejected silent-by-declaration and made `SecurityPlugin`'s own
 * sink console-backed by default — loud until a host injects one.
 * {@link reportPermissionSetNameCollisions} carries the same guarantee for this
 * refusal, which is why it takes a possibly-absent sink and still prints.
 *
 * ## Why a module, and not two call sites
 *
 * The precedent this card names is #14553's `navigationContributions` fix: a
 * diagnostic raised at BOTH doors — runtime and compile (`os build` /
 * `os validate`) — behind ONE shared predicate so the two cannot drift. A
 * compile-time door that called a collision fine while the runtime dropped the
 * set would be indistinguishable, to the author, from the silence being fixed
 * here.
 *
 * ⚠️ Only the RUNTIME door is built here. The compile-time door lives in
 * `packages/cli` (`domain:cli`), a different lane, and this change deliberately
 * does not reach into it. What this module exists to guarantee is that when
 * that door is built it consumes {@link permissionSetNameIsForeign} and
 * {@link permissionSetNameCollisionDiagnostic} rather than re-deriving either —
 * which is why both, and the wording, are exported from the package entry
 * rather than kept module-private.
 *
 * ## Why `event` and not `code`
 *
 * {@link PERMISSION_SET_NAME_COLLISION} is a snake_case DATA VALUE, not an
 * ADR-0112 error code: it is never routed to `error.code`, never reaches a
 * wire refusal, and travels as the structured half of a warning about an
 * artifact. That is the discrimination the sibling `position_name_fold_grant`
 * and `platform_owner_wall_bypass` tokens in `security-plugin.ts` already make
 * in this package, and it is why the stamp below is spelled `event:` rather
 * than `code:` — ⛔ a `code:` position here would be claiming a vocabulary this
 * value is not in.
 */

/**
 * The minimal sink this module reports through.
 *
 * Structurally satisfied by both `ProjectionLogger` and the catalog's
 * `SeedLogger` — declared here rather than imported so this module stays a leaf
 * and `permission-set-projection.ts` can name the diagnostic type without a
 * cycle. `warn` is non-optional for the #9754 reason its two siblings give: a
 * fallback channel that may itself be absent is not a fallback.
 */
export interface CollisionReportSink {
  warn: (message: string, meta?: Record<string, any>) => void;
}

/**
 * The stable token stamped on every set-name-collision report, so an operator
 * can grep ONE string for every silently-dropped permission set.
 *
 * Exported — unlike the sibling `position_name_fold_grant`, which is
 * deliberately package-private because nothing outside ever consumes it. This
 * one has a second consumer by construction: the compile-time door this card's
 * precedent requires. A door that re-spells the literal is the drift the shared
 * derivation exists to prevent.
 */
export const PERMISSION_SET_NAME_COLLISION = 'permission_set_name_collision';

/** One declared permission set that was NOT materialized because another package owns its name. */
export interface PermissionSetNameCollisionDiagnostic {
  /** Always {@link PERMISSION_SET_NAME_COLLISION}. */
  readonly event: typeof PERMISSION_SET_NAME_COLLISION;
  /**
   * Never `error`: the platform refuses the write and carries on, and the
   * failure direction is CLOSED — the set is not installed, so nothing is
   * over-granted. ⚠️ Were a path ever measured in which this drop ALLOWS an
   * access that should have been refused, that is a different severity and a
   * different card.
   */
  readonly severity: 'warning';
  /** The declared set's name — the `sys_permission_set.name` that collided. */
  readonly name: string;
  /** The package whose declaration was dropped. */
  readonly declaredBy: string;
  /**
   * The package that owns the standing row. `null` when the row is
   * package-managed but carries no `package_id` — an unowned row is still not
   * ours to write, and saying so is more useful than printing `undefined`.
   */
  readonly ownedBy: string | null;
  /** The organization whose catalog pass hit this, when the pass was scoped. */
  readonly organizationId?: string;
  readonly message: string;
  readonly fix: string;
}

/**
 * THE shared predicate: is the standing row's owner a DIFFERENT package from
 * the one declaring this set?
 *
 * Both doors ask exactly this question and must get exactly this answer.
 *
 * ⚠️ Deliberately asks only about OWNERS, because that is the only datum the
 * two doors certainly share: the runtime door reads `package_id` off a
 * `sys_permission_set` row, while a compile-time door composing one artifact
 * reads it off whichever declaration claimed the name first. Folding the row's
 * `managed_by` check in here would make the predicate unanswerable from a
 * declaration — the caller decides that a row is package-managed at all
 * (env-authored rows are a different branch entirely and are never clobbered),
 * and then asks this.
 *
 * ⚠️ A nullish owner is FOREIGN, not "ours". A package-managed row with no
 * `package_id` is the exact ambiguity ADR-0086 D3 exists to remove, and
 * adopting it on a name match would be a package writing into a record it
 * cannot prove it owns. This preserves the behaviour the branch already had —
 * ⛔ this card changes what the author is TOLD, never what is skipped.
 */
export function permissionSetNameIsForeign(
  ownerPackageId: string | null | undefined,
  declaringPackageId: string | null | undefined,
): boolean {
  return (ownerPackageId ?? null) !== (declaringPackageId ?? null);
}

/**
 * Word ONE collision. Callers decide reachability (see the seeder's
 * package-managed branch); this only words the finding, so both doors print
 * the same sentence.
 */
export function permissionSetNameCollisionDiagnostic(input: {
  name: string;
  declaredBy: string;
  ownedBy?: string | null;
  organizationId?: string;
}): PermissionSetNameCollisionDiagnostic {
  const ownedBy = input.ownedBy ?? null;
  const owner = ownedBy ?? '(a package-managed row with no package_id)';
  return {
    event: PERMISSION_SET_NAME_COLLISION,
    severity: 'warning',
    name: input.name,
    declaredBy: input.declaredBy,
    ownedBy,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    message:
      `Package "${input.declaredBy}" declares permission set "${input.name}", but that set name is ` +
      `already owned by ${owner}. The ENTIRE declared set was NOT materialized — a package never ` +
      `writes into a foreign record (ADR-0086 D4) — so none of its object, field, tab or system ` +
      `permissions are in effect, and nothing else reports this.`,
    fix:
      `Rename the set in package "${input.declaredBy}" to a name it owns (prefix it with the ` +
      `package's own module prefix), or — if the two packages genuinely co-own this namespace ` +
      `(ADR-0130 D1) — have exactly one of them declare the set and let the other depend on it.`,
  };
}

/** One line carrying the whole finding — the text every door prints. */
export function formatPermissionSetNameCollisionDiagnostic(
  d: PermissionSetNameCollisionDiagnostic,
): string {
  return `[security] [${d.event}] ${d.message} Fix: ${d.fix}`;
}

/**
 * Report every collision one catalog pass found — the half that makes the
 * refusal reach the author.
 *
 * ⛔ NOT `logger?.warn?.(…)`. That is the defect this module exists to remove:
 * with no sink injected it evaluates to nothing at all, and the set disappears
 * with only a counter moved. A caller that passes no sink gets `console.warn`,
 * for the reason #10556's ruling gives — loud until a host injects one.
 *
 * ⛔ NOT `(logger?.warn ?? console.warn)(…)` either: that evaluates to a bare
 * function and calls it with `this === undefined`, and a class-based host sink
 * (`@objectstack/core`'s `ObjectLogger`) reaches for `this` and throws. The
 * property-access call form below keeps the receiver — the same measured
 * conclusion `logSeedDurabilityFailure` records next door.
 *
 * ONE line per pass, not one per dropped set: a package that collides on its
 * whole declaration would otherwise bury its own remedy. Every diagnostic
 * travels in the structured meta beside it, and the caller gets the records
 * themselves on the pass outcome, so nothing is summarised away.
 *
 * `warn`, not `error`: this is a FUNCTIONAL degradation in the AGENTS.md sense
 * — the deployment is visibly smaller than it was authored to be, and the next
 * principal who needs the grant is refused. Nothing claimed to be persisted
 * silently failed to land; the write was deliberately never attempted.
 */
export function reportPermissionSetNameCollisions(
  logger: CollisionReportSink | undefined,
  collisions: readonly PermissionSetNameCollisionDiagnostic[],
  organizationId?: string,
): void {
  if (collisions.length === 0) return;
  const n = collisions.length;
  const message =
    `[security] [${PERMISSION_SET_NAME_COLLISION}] ${n} declared permission ` +
    `set${n === 1 ? ' was' : 's were'} NOT materialized — another package already owns ` +
    `${n === 1 ? 'that set name' : 'those set names'} (ADR-0086 D4). ` +
    `The declaring package's permissions are NOT in effect.`;
  const meta = {
    event: PERMISSION_SET_NAME_COLLISION,
    ...(organizationId ? { organization: organizationId } : {}),
    collisions: collisions.map((d) => ({
      name: d.name,
      declaredBy: d.declaredBy,
      ownedBy: d.ownedBy,
      fix: d.fix,
    })),
  };
  if (logger) logger.warn(message, meta);
  else console.warn(message, meta);
}
