// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27862 — `POST /organization/update-member-role` says which permission set
 * the role change granted.
 *
 * ## The defect
 *
 * Raising a member to `admin` or `owner` grants an org-admin permission set as
 * a side effect: `plugin-security`'s `sys_member` middleware reconciles the
 * pair inside the same request and writes a `sys_user_permission_set` row
 * naming `organization_admin` or `organization_admin_no_bypass` (by posture,
 * ADR-0105 D4). The route still answered the member row alone, so the console's
 * Change Role / Make Owner actions toasted "Member role updated" and the
 * administrator later found a set on the user's Permission Sets tab that
 * nobody visibly assigned.
 *
 * ## What this does
 *
 * A successful answer whose role change left the member holding an org-admin
 * set it did not hold before the request gains two top-level members beside
 * the row's own columns, the shape #27843 gave invite-member:
 *
 * - `outcome: 'permission_set_granted'`;
 * - `grantedPermissionSet: { name, label }` — the set's catalog name and its
 *   catalog `label` (the name when the definition carries none).
 *
 * The console reads it through `ActionSchema.outcomeMessages`, so the copy can
 * name `${result.grantedPermissionSet.label}`. A role change that grants
 * nothing (a demotion, admin → owner, member → external) answers exactly the
 * row, as before.
 *
 * ## How "granted" is read
 *
 * Measured, not inferred from the role: the global `before` hook reads the
 * target pair's org-admin grants (by the two set names) and stashes them on the
 * request's endpoint context; the `after` hook reads them again and names a set
 * present after and absent before. ⛔ It decides nothing about what is granted
 * and writes nothing: the reconciler in `plugin-security` stays the one writer.
 *
 * Every read fails toward silence. A read that throws, a member that cannot be
 * found, or a stash that did not survive to the `after` hook leaves the answer
 * exactly as the vendor wrote it — a missing line, never a wrong one.
 */

import { securityCatalogReaderOf } from '@objectstack/core';
import { GRANT_SET_NAME_FIELD, grantSetNameOf } from './grant-set-name.js';
import { ORGANIZATION_ADMIN_SET_NAMES } from './organization-delete.js';

/** better-auth's role-change route (Change Role and Make Owner both call it). */
export const UPDATE_MEMBER_ROLE_PATH = '/organization/update-member-role';

/** The `outcome` an answer carries when its role change granted a set. */
export const PERMISSION_SET_GRANTED_OUTCOME = 'permission_set_granted';

/** The request-context key the `before` hook stashes the pre-change grants under. */
const STASH_KEY = '__osRoleChangeGrantsBefore';

/** The org-admin set names a role change can grant. */
export const ROLE_CHANGE_GRANTABLE_SETS: readonly string[] = ORGANIZATION_ADMIN_SET_NAMES;

/** The reads both hooks make. Each may throw; the callers swallow it. */
export interface RoleChangeGrantDeps {
  /** The `sys_member` row's pair, or `undefined` when no row has that id. */
  readMemberPair(memberId: string): Promise<{ userId: string; organizationId: string } | undefined>;
  /** The names among {@link ROLE_CHANGE_GRANTABLE_SETS} the pair holds a grant of. */
  readGrantedSetNames(userId: string, organizationId: string): Promise<string[]>;
  /** The set's catalog label, or `undefined` when the catalog names none. */
  readSetLabel(name: string): Promise<string | undefined>;
}

/** A system-context reader of the engine (`withSystemReadContext`). */
interface SystemReader {
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
}

/**
 * The reads bound to an engine: `sys` is its system-context reader, `engine`
 * the object the security plugin bound its catalog to.
 */
export function roleChangeGrantDepsFor(engine: object, sys: SystemReader): RoleChangeGrantDeps {
  const rowsOf = async (object: string, query: Record<string, unknown>): Promise<any[]> => {
    const rows = await sys.find(object, query);
    return Array.isArray(rows) ? rows : [];
  };
  return {
    readMemberPair: async (memberId) => {
      const [row] = await rowsOf('sys_member', { where: { id: memberId }, limit: 1 });
      const userId = row?.user_id;
      const organizationId = row?.organization_id;
      return typeof userId === 'string' && userId && typeof organizationId === 'string' && organizationId
        ? { userId, organizationId }
        : undefined;
    },
    readGrantedSetNames: async (userId, organizationId) => {
      const rows = await rowsOf('sys_user_permission_set', {
        where: {
          user_id: userId,
          organization_id: organizationId,
          [GRANT_SET_NAME_FIELD]: { $in: [...ROLE_CHANGE_GRANTABLE_SETS] },
        },
        limit: 10,
      });
      return [...new Set(rows.map(grantSetNameOf).filter((n): n is string => n !== undefined))];
    },
    readSetLabel: async (name) => {
      const entry = await securityCatalogReaderOf(engine)?.resolve('permission', name);
      const label = entry?.definition?.label;
      return typeof label === 'string' && label.trim() !== '' ? label : undefined;
    },
  };
}

interface GrantsBefore {
  userId: string;
  organizationId: string;
  names: string[];
}

async function isRefusal(returned: unknown): Promise<boolean> {
  try {
    const { isAPIError } = await import('better-auth/api');
    return isAPIError(returned);
  } catch {
    return returned instanceof Error;
  }
}

/**
 * `before` hook: stash the target pair's org-admin grants. A no-op on every
 * other path. Never throws.
 */
export async function snapshotRoleChangeGrants(ctx: any, deps: RoleChangeGrantDeps): Promise<void> {
  try {
    if (ctx?.path !== UPDATE_MEMBER_ROLE_PATH || !ctx.context) return;
    const memberId = ctx?.body?.memberId;
    if (typeof memberId !== 'string' || memberId === '') return;
    const pair = await deps.readMemberPair(memberId);
    if (!pair) return;
    const names = await deps.readGrantedSetNames(pair.userId, pair.organizationId);
    const stash: GrantsBefore = { ...pair, names };
    ctx.context[STASH_KEY] = stash;
  } catch {
    /* no stash: the answer stays exactly as the vendor writes it */
  }
}

/**
 * `after` hook: name the set the role change granted on a successful answer.
 * A no-op on every other path, on a refusal, and when nothing new is held.
 * Never throws.
 */
export async function stampRoleChangeGrantedSet(ctx: any, deps: RoleChangeGrantDeps): Promise<void> {
  try {
    if (ctx?.path !== UPDATE_MEMBER_ROLE_PATH) return;
    const before = ctx?.context?.[STASH_KEY] as GrantsBefore | undefined;
    if (ctx?.context) delete ctx.context[STASH_KEY];
    if (!before) return;
    const returned = ctx?.context?.returned;
    if (!returned || typeof returned !== 'object' || Array.isArray(returned)) return;
    if (await isRefusal(returned)) return;
    const after = await deps.readGrantedSetNames(before.userId, before.organizationId);
    const granted = after.find((name) => !before.names.includes(name));
    if (!granted) return;
    const label = (await deps.readSetLabel(granted)) ?? granted;
    Object.assign(returned as Record<string, unknown>, {
      outcome: PERMISSION_SET_GRANTED_OUTCOME,
      grantedPermissionSet: { name: granted, label },
    });
  } catch {
    /* leave the answer exactly as the vendor route wrote it */
  }
}
