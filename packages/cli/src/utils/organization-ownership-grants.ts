// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The grant half of the ADR-0131 D10 ceremony, as one pure decision both
 * `--plan` and `--apply` take: which legacy grant (`permission_set` empty,
 * `permission_set_id` set) the verified rewrite names, and which it may not.
 *
 * ## Why a legacy grant can collide
 *
 * The grant's unique index is (`user_id`, `permission_set`,
 * `organization_id`) (C7b). A 17.x database's first v18 boot creates it, and
 * that same boot's organization-administrator sweep writes a NAMED grant for
 * every qualifying pair, beside the pair's legacy grant, which names nothing
 * and confers nothing. Naming the legacy grant then writes a second row of one
 * key: the index refuses it. So the rewrite names a legacy grant only when no
 * stored named grant, and no grant it names earlier in the same run, already
 * holds that user, set and organization (a NULL organization keyed with NULL,
 * as the write door keys it). The others are listed, both ids named, and kept:
 * which grant stays is the operator's call, and the ceremony deletes no grant.
 */

/** A grant written before the name column existed: it carries the legacy id only. */
export interface LegacyGrant {
  id: string;
  userId: string | null;
  organizationId: string | null;
  setId: string | null;
}

/** A grant that already names its set. */
export interface NamedGrant {
  id: string;
  userId: string | null;
  organizationId: string | null;
  name: string;
}

/** A legacy `sys_permission_set` row, as the rewrite reads it. */
export interface LegacySetRow {
  name: string | null;
  organizationId: string | null;
}

/** Why a legacy grant is not named. */
export type UnnamedReason = 'noId' | 'dangling' | 'crossOrganization' | 'unresolved';

/** A legacy grant the rewrite may not name: its name would duplicate `heldBy`. */
export interface GrantCollision {
  id: string;
  name: string;
  heldBy: string;
}

export interface GrantRewritePlan {
  /** The legacy grants to name, in id order. */
  name: Array<{ id: string; name: string }>;
  collisions: GrantCollision[];
  reasons: Record<UnnamedReason, string[]>;
}

/** The unique key of a grant; a NULL organization is one key, as the write door keys it. */
export function grantKey(userId: string | null, name: string, organizationId: string | null): string {
  return JSON.stringify([userId, name, organizationId]);
}

/**
 * Decide the rewrite. `resolves` answers whether the security catalog resolves
 * a name; `--plan`, which reads no catalog, passes none and counts every
 * derivable name.
 */
export function planGrantRewrite(
  legacy: readonly LegacyGrant[],
  named: readonly NamedGrant[],
  sets: ReadonlyMap<string, LegacySetRow>,
  resolves: (name: string) => boolean = () => true,
): GrantRewritePlan {
  const out: GrantRewritePlan = {
    name: [],
    collisions: [],
    reasons: { noId: [], dangling: [], crossOrganization: [], unresolved: [] },
  };
  const held = new Map<string, string>();
  for (const g of [...named].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = grantKey(g.userId, g.name, g.organizationId);
    if (!held.has(key)) held.set(key, g.id);
  }
  for (const grant of [...legacy].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!grant.setId) { out.reasons.noId.push(grant.id); continue; }
    const set = sets.get(grant.setId);
    if (!set?.name) { out.reasons.dangling.push(grant.id); continue; }
    // A name carries no organization: an organization's set row may be named
    // only by that organization's grants (the grant rule the resolver applies).
    if (set.organizationId !== null && set.organizationId !== grant.organizationId) {
      out.reasons.crossOrganization.push(grant.id);
      continue;
    }
    if (!resolves(set.name)) { out.reasons.unresolved.push(grant.id); continue; }
    const key = grantKey(grant.userId, set.name, grant.organizationId);
    const holder = held.get(key);
    if (holder !== undefined) {
      out.collisions.push({ id: grant.id, name: set.name, heldBy: holder });
      continue;
    }
    held.set(key, grant.id);
    out.name.push({ id: grant.id, name: set.name });
  }
  return out;
}

/** The blocker a collision list reads as: both ids, the reason, the remedy. */
export function grantCollisionBlocker(table: string, collisions: readonly GrantCollision[]): string {
  const listed = collisions.slice(0, 20).map((c) => `${c.id} (${c.name}, held by ${c.heldBy})`).join(', ');
  return (
    `${collisions.length} legacy grant(s) would name a permission set their user already holds in the same organization ` +
    `(${listed}${collisions.length > 20 ? ', …' : ''}). The unique index on ${table} (user_id, permission_set, ` +
    'organization_id) refuses the second row, so each is kept unnamed: it confers nothing, and none is deleted here. ' +
    'Which grant stays is yours: remove the legacy grant (or the one that holds the set), then re-run.'
  );
}
