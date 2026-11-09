// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] The agent ceiling, held at evaluation: whatever its permission
 * sets say, an agent principal never carries View All or Modify All, the
 * destructive class, a system permission, a superuser wildcard or an admin
 * scope.
 *
 * ## Why at evaluation
 *
 * An AI service account's grants are ordinary assignments
 * (`sys_user_permission_set`, `sys_user_position`), and a set can be edited
 * after it was assigned. The refusal at assignment
 * (`agent-account-grant-refusal.ts`) is the loud, early answer; this clamp is
 * the guarantee. It runs where every evaluator reads an execution context's
 * sets — `resolvePermissionSetsForContextUnmemoized`
 * (`security-plugin-permission-sets.ts`), the one choke point — for every
 * agent principal, the account and the OAuth-delegated agent alike. The
 * first-party OAuth ceiling sets (`MCP_AGENT_PERMISSION_SETS`) carry none of
 * these bits, so the clamp changes nothing for them.
 *
 * ## What it clears
 *
 * On every `objects` entry, the wildcard `'*'` included: `viewAllRecords`,
 * `modifyAllRecords` and the destructive class's grant keys
 * ({@link DESTRUCTIVE_CLASS_KEYS}, `permission-evaluator.ts`). With the two
 * bypass bits gone a `'*'` entry is no longer a superuser wildcard: the
 * evaluator applies it to a private object only when it carries them
 * (ADR-0066 D2), and the field merge's superuser vote reads the same two
 * bits. On the set: `systemPermissions` (emptied) and `adminScope` (removed),
 * in both the definition and the row spellings the delegated-administration
 * gate reads.
 *
 * Every other key is left as authored: the CRUD bits, export, depth, field
 * masks, tabs and row-level security are ordinary grants under the ceiling.
 *
 * ## What it never does
 *
 * It never mutates a set it is handed: the resolved sets are shared with the
 * metadata and bootstrap catalogs. A set that needs no clamp is returned as
 * the same object; one that does is a fresh copy.
 */

import type { PermissionSet } from '@objectstack/spec/security';
import { DESTRUCTIVE_CLASS_KEYS } from './permission-evaluator.js';

/** The object-entry bits the ceiling clears: the two bypass bits, then the destructive class. */
export const AGENT_CEILING_OBJECT_KEYS: readonly string[] = Object.freeze([
  'viewAllRecords',
  'modifyAllRecords',
  ...DESTRUCTIVE_CLASS_KEYS,
]);

/** The set-level keys the ceiling clears, each in its definition and its row spelling. */
const SYSTEM_PERMISSION_KEYS = ['systemPermissions', 'system_permissions'] as const;
const ADMIN_SCOPE_KEYS = ['adminScope', 'admin_scope'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A JSON-string column, read the way the delegated-administration gate reads it. */
function parsed(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function nonEmptyList(v: unknown): boolean {
  const list = parsed(v);
  return Array.isArray(list) && list.length > 0;
}

function present(v: unknown): boolean {
  const value = parsed(v);
  return value !== undefined && value !== null && value !== '' && value !== false;
}

/**
 * What in `set` breaches the agent ceiling, one phrase per bit, in a stable
 * order: `objects.<object>.<key>`, then `systemPermissions`, then
 * `adminScope`. Empty when the set is within it.
 */
export function agentCeilingBreaches(set: unknown): string[] {
  if (!isRecord(set)) return [];
  const out: string[] = [];
  const objects = parsed(set.objects);
  if (isRecord(objects)) {
    for (const [object, entry] of Object.entries(objects)) {
      if (!isRecord(entry)) continue;
      for (const key of AGENT_CEILING_OBJECT_KEYS) {
        if (entry[key] === true) out.push(`objects.${object}.${key}`);
      }
    }
  }
  if (SYSTEM_PERMISSION_KEYS.some((k) => nonEmptyList(set[k]))) out.push('systemPermissions');
  if (ADMIN_SCOPE_KEYS.some((k) => present(set[k]))) out.push('adminScope');
  return out;
}

/**
 * `set` under the agent ceiling. The same object when nothing in it breaches
 * the ceiling, a fresh copy with the breaching bits cleared when something
 * does.
 */
export function clampPermissionSetToAgentCeiling(set: PermissionSet): PermissionSet {
  if (agentCeilingBreaches(set).length === 0) return set;
  const out: Record<string, unknown> = { ...(set as unknown as Record<string, unknown>) };
  const objects = parsed(out.objects);
  if (isRecord(objects)) {
    const clamped: Record<string, unknown> = {};
    for (const [object, entry] of Object.entries(objects)) {
      if (!isRecord(entry)) {
        clamped[object] = entry;
        continue;
      }
      const next: Record<string, unknown> = { ...entry };
      for (const key of AGENT_CEILING_OBJECT_KEYS) {
        if (next[key] === true) next[key] = false;
      }
      clamped[object] = next;
    }
    out.objects = clamped;
  }
  for (const key of SYSTEM_PERMISSION_KEYS) {
    if (key in out) out[key] = [];
  }
  for (const key of ADMIN_SCOPE_KEYS) delete out[key];
  return out as unknown as PermissionSet;
}

/** Every set under the agent ceiling ({@link clampPermissionSetToAgentCeiling}), in order. */
export function clampPermissionSetsToAgentCeiling(sets: readonly PermissionSet[]): PermissionSet[] {
  return sets.map(clampPermissionSetToAgentCeiling);
}
