// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] A `private` `synced` object that no sharing rule grants read
 * on: no member can read a row of it.
 *
 * ## The mechanism this warns about
 *
 * A pull writes a `synced` object's rows with no person owner: attribution is
 * the run, never an owner (ADR-0153 D4). On `sharingModel: 'private'` record
 * sharing scopes a member's reads by `owner_id` plus the shares that reach
 * them, so an owner-less row is read by a member only when a share grants it.
 * Measured on the epic (G4): a `private` target listed 0 of 100 rows to a
 * member whose permission set grants `allowRead`. Without this warning the
 * author learns it from an empty list.
 *
 * D4 states the verdict this rule reports, verbatim: "A `private` `synced`
 * object with no sharing rule that grants read is warned at author time,
 * because an owner-scoped model over owner-less rows reads to no member (G4)."
 *
 * ## What "grants read" means here
 *
 * A stack-declared sharing rule (`stack.sharingRules[]`) grants read on the
 * object when all three hold:
 *
 *  - its `object` names the object;
 *  - it is not `active: false` (the runtime skips an inactive rule, so it
 *    grants nothing);
 *  - its `accessLevel` is `read` or `edit`, or is absent (the schema default
 *    is `read`). Both levels grant read: `edit` is read and write.
 *
 * Any recipient counts, and any `condition`. Whether the condition lowers is
 * `validateSharingRuleEnforceability`'s question, reported there as an error;
 * judging it again here would report one defect twice.
 *
 * ## Deliberately not judged
 *
 *  - An UNSET `sharingModel` on a `synced` object. It is already the
 *    `security-owd-unset` error, whose fix line for a `synced` object is the
 *    same {@link SYNCED_OBJECT_WAY_OUT} this rule prints: one finding, not two.
 *  - Any model other than `private`. `public_read` and `public_read_write` do
 *    not scope reads by owner; `controlled_by_parent` reads the master's
 *    access. A value outside the canonical four is `security-owd-alias`'s
 *    finding.
 *  - A permission set's read depth (`readScope: 'org'`, `viewAllRecords`) on
 *    the object. Those reach owner-less rows too, but D4 names the sharing
 *    rule as the remedy and this rule reports D4's verdict as written.
 *  - `objectExtensions`. An extension carries neither `sharingModel` nor
 *    `managedBy` (`ObjectExtensionSchema` is strict), and sharing rules are a
 *    stack collection, so no extension changes the verdict.
 *
 * Advisory (warning), never a refusal: the stack is valid, a sharing rule may
 * arrive from another installed package, and refusing it would narrow the
 * published accept set.
 */

import { recordsOf } from './object-graph.js';
import { SYNCED_OBJECT_WAY_OUT } from './validate-security-posture.js';

export type SyncedPrivateReadabilitySeverity = 'warning';

export interface SyncedPrivateReadabilityFinding {
  severity: SyncedPrivateReadabilitySeverity;
  rule: string;
  /** Human-readable location, e.g. `object "erp_order_copy"`. */
  where: string;
  /** Config path, e.g. `objects[3].sharingModel`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const SECURITY_SYNCED_PRIVATE_UNREADABLE = 'security-synced-private-unreadable';

type AnyRec = Record<string, unknown>;

/** The access levels that grant read; an absent level is the schema default, `read`. */
const READ_GRANTING_LEVELS: ReadonlySet<unknown> = new Set(['read', 'edit', undefined]);

/** The object names some stack-declared sharing rule grants read on. */
function objectsGrantedRead(stack: AnyRec): ReadonlySet<string> {
  const granted = new Set<string>();
  for (const rule of recordsOf(stack.sharingRules)) {
    if (rule.active === false) continue;
    if (!READ_GRANTING_LEVELS.has(rule.accessLevel)) continue;
    if (typeof rule.object === 'string' && rule.object.length > 0) granted.add(rule.object);
  }
  return granted;
}

export function validateSyncedPrivateReadability(stack: AnyRec): SyncedPrivateReadabilityFinding[] {
  const out: SyncedPrivateReadabilityFinding[] = [];
  if (!stack || typeof stack !== 'object') return out;
  const objects = recordsOf(stack.objects);
  if (!objects.some((obj) => obj.managedBy === 'synced' && obj.sharingModel === 'private')) return out;
  const granted = objectsGrantedRead(stack);

  objects.forEach((obj, i) => {
    if (obj.managedBy !== 'synced' || obj.sharingModel !== 'private') return;
    const name = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    if (granted.has(name)) return;
    out.push({
      severity: 'warning',
      rule: SECURITY_SYNCED_PRIVATE_UNREADABLE,
      where: `object "${name}"`,
      path: `objects[${i}].sharingModel`,
      // One verdict sentence and one fix; the mechanism and what counts as a
      // read-granting rule are `os explain security-synced-private-unreadable`.
      message:
        `synced object on sharingModel 'private' has no sharing rule that grants read on it; a pull writes ` +
        `its rows with no person owner, and 'private' shows a member only the rows they own or a share grants them`,
      hint: SYNCED_OBJECT_WAY_OUT,
    });
  });

  return out;
}
