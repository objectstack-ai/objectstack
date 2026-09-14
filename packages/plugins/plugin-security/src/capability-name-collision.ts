// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18023] The capability-name collision diagnostic — the CAPABILITY axis of
 * the refusal `permission-set-name-collision.ts` words for permission sets.
 *
 * ## What was wrong
 *
 * `bootstrapDeclaredCapabilities` refuses to write into a `sys_capability` row
 * another package owns (ADR-0086 D4: a package never writes into a foreign
 * record). That refusal is CORRECT and is unchanged here. What was wrong is
 * that it was INVISIBLE: the whole declaration vanished with
 * `out.skippedForeign += 1` and one `logger?.warn?.(…)` line — optionally
 * chained TWICE, so a caller that passed no logger produced no output at all.
 *
 * Measured on the pre-fix tree, driven through the seeder with a foreign-owned
 * row and no logger: `skippedForeign = 1`, author-visible console lines = 0
 * across all five channels, and `undefined` for the outcome's diagnostic
 * records. The permission-set axis, same harness, after its own repair landed:
 * 1 line. This module moves the capability axis to that lit reading.
 *
 * ## Why a PARALLEL module, and what it deliberately REUSES
 *
 * Four of the six things a collision report is made of are axis-SPECIFIC here:
 * the token, the record type, the wording and the consequence. Folding them
 * into a file named `permission-set-name-collision.ts` would make that name
 * lie, and renaming that file churns pins that landed one card ago.
 *
 * What is axis-INDEPENDENT is reused rather than re-derived — re-deriving it is
 * the drift the sibling module exists to prevent:
 *
 *  - {@link CollisionReportSink} — the minimal sink, imported from the sibling
 *    and re-exported here so a consumer of this axis never declares a second
 *    structural copy of it.
 *  - `permissionSetNameIsForeign` — THE owner-comparison predicate. The seeder
 *    calls it directly at the branch (see `bootstrap-declared-capabilities.ts`);
 *    it carries the axis it was first written for in its NAME, and one name for
 *    one derivation beats two names for one derivation.
 *
 * ⛔ What is NOT reused is `reportPermissionSetNameCollisions`: its message
 * states a permission-set consequence, and the consequence here is different
 * (below). Its sink discipline is restated in {@link reportCapabilityNameCollisions}
 * because that discipline IS the contract this card buys — not a derivation
 * that can drift, but two lines whose behaviour both axes pin independently.
 *
 * ## Why the consequence differs — the reason this is not a mechanical copy
 *
 * On the permission-set axis the ENTIRE declared set is not materialized: none
 * of its object, field, tab or system permissions are in effect. Here the name
 * still RESOLVES, because the standing row — the other package's — answers for
 * it, and `upsertPackageCapability` therefore reports the name as materialized
 * so the back-compat derivation does not clobber that row (#4967 Part 1).
 *
 * So what is lost is narrower and needs saying precisely, or the author is sent
 * hunting for a broken grant that is not broken:
 *
 *  - the declaring package's authored `label`, `description` and `scope` are
 *    NOT applied — the registry keeps the OWNING package's;
 *  - `sys_capability.package_id` attributes the capability to the owner, so the
 *    declaring package's ADR-0086 D3 provenance claim over it does not exist;
 *  - grants naming the capability keep working, which is why nothing else in
 *    the system ever reports this.
 *
 * ⛔ This module states nothing about uninstall taking the row away:
 * `cleanupPackagePermissions` covers `sys_permission_set` and does not touch
 * `sys_capability` today, so a diagnostic claiming a disappearing capability
 * would be words the runtime does not back.
 *
 * ## Why `event` and not `code`
 *
 * {@link CAPABILITY_NAME_COLLISION} is a snake_case DATA VALUE, not an ADR-0112
 * error code: it is never routed to `error.code`, never reaches a wire refusal,
 * and travels as the structured half of a warning about an artifact — the same
 * discrimination `PERMISSION_SET_NAME_COLLISION` and the sibling
 * `position_name_fold_grant` token already make in this package.
 */

import type { CollisionReportSink } from './permission-set-name-collision.js';

export type { CollisionReportSink };

/**
 * The stable token stamped on every capability-name-collision report, so an
 * operator can grep ONE string for every dropped capability declaration.
 *
 * Exported for the same reason its permission-set sibling is: the compile-time
 * door (`os build` / `os validate`, and the author-time capability rule in
 * `@objectstack/lint`) must consume this rather than re-spell the literal.
 */
export const CAPABILITY_NAME_COLLISION = 'capability_name_collision';

/** One declared capability whose declaration was NOT applied because another package owns its name. */
export interface CapabilityNameCollisionDiagnostic {
  /** Always {@link CAPABILITY_NAME_COLLISION}. */
  readonly event: typeof CAPABILITY_NAME_COLLISION;
  /**
   * Never `error`: the platform refuses the write and carries on, and the
   * refusal direction is CLOSED for the DECLARATION — nothing of the declaring
   * package's is written anywhere. ⚠️ Were a path ever measured in which the
   * owner's retained `scope` ALLOWS an access the declaration would have
   * refused, that is a different severity and a different card.
   */
  readonly severity: 'warning';
  /** The declared capability's name — the `sys_capability.name` that collided. */
  readonly name: string;
  /** The package whose declaration was dropped. */
  readonly declaredBy: string;
  /**
   * The package that owns the standing row. `null` when the row is
   * package-managed but carries no `package_id` — an unowned row is still not
   * ours to write, and saying so is more useful than printing `undefined`.
   */
  readonly ownedBy: string | null;
  /**
   * The bootstrap permission set(s) that GRANT this capability via
   * `systemPermissions[]` — the blast radius, named rather than left for the
   * author to find. Empty when nothing grants it, which is itself the useful
   * fact: the sibling `unownedRefusalMessage` in the seeder makes the same
   * distinction, off the same index.
   */
  readonly grantedBy: readonly string[];
  readonly message: string;
  readonly fix: string;
}

/**
 * Word ONE collision. Callers decide reachability (see the seeder's
 * package-managed branch); this only words the finding, so every door that
 * raises it prints the same sentence.
 */
export function capabilityNameCollisionDiagnostic(input: {
  name: string;
  declaredBy: string;
  ownedBy?: string | null;
  grantedBy?: readonly string[];
}): CapabilityNameCollisionDiagnostic {
  const ownedBy = input.ownedBy ?? null;
  const owner = ownedBy ?? '(a package-managed row with no package_id)';
  const grantedBy = [...(input.grantedBy ?? [])];
  const blastRadius = grantedBy.length > 0
    ? `Permission set(s) granting it: ${grantedBy.join(', ')} — those grants keep resolving, ` +
      `against a capability this package does not own.`
    : `No bootstrap permission set grants it, so nothing is denied today — but the ` +
      `declaration is still inert.`;
  return {
    event: CAPABILITY_NAME_COLLISION,
    severity: 'warning',
    name: input.name,
    declaredBy: input.declaredBy,
    ownedBy,
    grantedBy,
    message:
      `Package "${input.declaredBy}" declares capability "${input.name}", but that capability ` +
      `name is already owned by ${owner}. The declaration was NOT applied — a package never ` +
      `writes into a foreign record (ADR-0086 D4) — so the registry keeps the owning package's ` +
      `label, description and scope, and sys_capability attributes the capability to ${owner}, ` +
      `not to "${input.declaredBy}". The name still resolves, which is why nothing else reports ` +
      `this. ${blastRadius}`,
    fix:
      `Rename the capability in package "${input.declaredBy}" to a name it owns (prefix it with ` +
      `the package's own module prefix), or — if the two packages genuinely co-own this ` +
      `namespace (ADR-0130 D1) — have exactly one of them declare it and let the other depend ` +
      `on it.`,
  };
}

/** One line carrying the whole finding — the text every door prints. */
export function formatCapabilityNameCollisionDiagnostic(
  d: CapabilityNameCollisionDiagnostic,
): string {
  return `[security] [${d.event}] ${d.message} Fix: ${d.fix}`;
}

/**
 * Report every collision one seeding pass found — the half that makes the
 * refusal reach the author.
 *
 * ⛔ NOT `logger?.warn?.(…)`. That is the defect this module exists to remove:
 * with no sink injected it evaluates to nothing at all, and the declaration
 * disappears with only a counter moved. A caller that passes no sink gets
 * `console.warn`, for the reason #10556's ruling gives — loud until a host
 * injects one.
 *
 * ⛔ NOT `(logger?.warn ?? console.warn)(…)` either: that evaluates to a bare
 * function and calls it with `this === undefined`, and a class-based host sink
 * (`@objectstack/core`'s `ObjectLogger`) reaches for `this` and throws. The
 * property-access call form below keeps the receiver — the same measured
 * conclusion `logSeedDurabilityFailure` and `reportPermissionSetNameCollisions`
 * both record.
 *
 * ONE line per pass, not one per dropped capability: a package that collides on
 * its whole declaration would otherwise bury its own remedy. Every diagnostic
 * travels in the structured meta beside it, and the caller gets the records
 * themselves on the pass outcome, so nothing is summarised away.
 *
 * `warn`, not `error`: this is FUNCTIONAL degradation — the deployment is
 * visibly less attributable than it was authored to be. Nothing claimed to be
 * persisted silently failed to land; the write was deliberately never attempted.
 */
export function reportCapabilityNameCollisions(
  logger: CollisionReportSink | undefined,
  collisions: readonly CapabilityNameCollisionDiagnostic[],
): void {
  if (collisions.length === 0) return;
  const n = collisions.length;
  const message =
    `[security] [${CAPABILITY_NAME_COLLISION}] ${n} declared ` +
    `capabilit${n === 1 ? 'y was' : 'ies were'} NOT applied — another package already owns ` +
    `${n === 1 ? 'that capability name' : 'those capability names'} (ADR-0086 D4). ` +
    `The declaring package's authored label, description and scope are NOT in effect, and the ` +
    `capabilit${n === 1 ? 'y is' : 'ies are'} attributed to the owning package.`;
  const meta = {
    event: CAPABILITY_NAME_COLLISION,
    collisions: collisions.map((d) => ({
      name: d.name,
      declaredBy: d.declaredBy,
      ownedBy: d.ownedBy,
      grantedBy: [...d.grantedBy],
      fix: d.fix,
    })),
  };
  if (logger) logger.warn(message, meta);
  else console.warn(message, meta);
}
