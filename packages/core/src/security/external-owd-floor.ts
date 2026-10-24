// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling of record 6355206139, letter B · ADR-0090 D11] The OWD seam for the
 * EXTERNAL rung, as vocabulary both of its halves read.
 *
 * ## The rule
 *
 * The rung admits explicit grants only: shares (share links included), sharing
 * rules, and position and permission-set grants with their RLS evaluated. It
 * never admits the internal OWD baseline. So, for an external principal, an
 * object's org-wide default is floored at owner_only: where a member reads every
 * row of a `public_read` / `public_read_write` object (or of a system object
 * that declares no model), an external reads the rows it owns and the rows
 * shared to it, as on a `private` one. A `controlled_by_parent` detail is not
 * floored here: its rows follow the master, which is (plugin-sharing exempts it).
 *
 * One thing lifts the floor, and it is a grant: when a position or
 * permission-set grant the external holds carries an RLS predicate (`using`)
 * for the object and the operation's class, the object's own model stands and
 * that predicate bounds the rows, exactly as it bounds a member's (a permission
 * set reading `supplier in current_user.<membership key>` reaches an external
 * as it reaches a member). A grant with no predicate opens the object, not its
 * rows.
 *
 * ## Who decides what
 *
 * `plugin-security` resolves the grants, so it answers "does a grant's RLS speak
 * for this object" and stamps the answer on the operation context, beside the
 * `__readScope` / `__writeScope` depth it already hands over (step 2.6 of its
 * CRUD middleware). `plugin-sharing` owns the OWD and applies the floor. Neither
 * depends on the other, so the names live here, in the package both import —
 * the reason `operation-private-keys.ts` gives for living here too.
 *
 * Each stamp carries the NAME of the object it was resolved for, never a bare
 * boolean: an envelope that reaches the sharing gate for another object (a
 * forwarded caller context, a stale stamp the middleware did not overwrite)
 * reads as "no grant speaks", which is the floor — the narrow direction, as an
 * absent depth leaves the owner-match at `own`. The read and write classes are
 * stamped apart, because a write-class policy is no evidence for a read.
 */

/** Stamp: the object a held grant's RLS speaks for on the READ class (`select`). */
export const EXTERNAL_READ_GRANT_KEY = '__externalReadGrant';

/** Stamp: the object a held grant's RLS speaks for on the WRITE class (`update` / `delete`). */
export const EXTERNAL_WRITE_GRANT_KEY = '__externalWriteGrant';

/**
 * Is `context` an EXTERNAL principal — the organization's `external`
 * population? Either carried value says so (`audience: 'external'`, or the
 * `EXTERNAL` posture rung the resolver derives for the same holders); reading
 * both is the narrow direction, since a hand-built context may carry one.
 * A guest is not one: it has no membership, and its own deny-all rule comes
 * first wherever it is asked.
 */
export function isExternalAudienceContext(context: unknown): boolean {
  if (context === null || typeof context !== 'object') return false;
  const c = context as { audience?: unknown; posture?: unknown };
  return c.audience === 'external' || c.posture === 'EXTERNAL';
}

/**
 * Did `plugin-security` stamp, for THIS object and class, that a held grant's
 * RLS speaks? `false` for an absent stamp, or one resolved for another object.
 */
export function externalGrantSpeaks(context: unknown, object: string, opClass: 'read' | 'write'): boolean {
  if (context === null || typeof context !== 'object') return false;
  const key = opClass === 'read' ? EXTERNAL_READ_GRANT_KEY : EXTERNAL_WRITE_GRANT_KEY;
  return (context as Record<string, unknown>)[key] === object;
}

/**
 * The org-wide default an operation of `opClass` meets on `object`: `model`
 * itself for an internal principal, and for an external one `'private'`
 * (owner_only) unless a held grant's RLS speaks for the object and class.
 * `model` is the effective model the sharing service resolved for the object.
 */
export function owdForAudience<M extends string>(
  model: M,
  context: unknown,
  object: string,
  opClass: 'read' | 'write',
): M | 'private' {
  if (model === 'private' || !isExternalAudienceContext(context)) return model;
  return externalGrantSpeaks(context, object, opClass) ? model : 'private';
}
