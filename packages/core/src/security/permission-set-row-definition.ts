// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D10, ADR-0094 D4] A `sys_permission_set` row, turned into the
 * permission-set DEFINITION it carries.
 *
 * The security catalog's one home is environment metadata (ADR-0131 D3). A
 * permission set an administrator authored in Setup before that move is a row
 * and nothing else, and the upgrade ceremony (`os migrate`, C7b) converts it:
 * it reads the row, calls this function, and saves the answer through the
 * metadata door. ⛔ Never at boot: a conversion that ran on every start would be
 * the dual source ADR-0131 D10 retires.
 *
 * The function is pure: one row in, one body out — no engine, no I/O. It is
 * the logic the security plugin's boot backfill applies today
 * (`permissionSetBodyFromRow`), held here so the ceremony and that plugin read
 * one mapping; the plugin's copy is deleted when its boot module is.
 *
 * The mapping is the inverse of the row shape the security plugin projects a
 * definition into: the snake_case facet columns, stored as JSON text, become
 * the camelCase body keys —
 *
 *  - `name` → `name`; `label` → `label`, falling back to the name when the
 *    column is `null` or absent;
 *  - `description` → `description`, only when the column is neither `null`
 *    nor absent;
 *  - `object_permissions` → `objects` (default `{}`), `field_permissions` →
 *    `fields` (`{}`), `system_permissions` → `systemPermissions` (`[]`),
 *    `row_level_security` → `rowLevelSecurity` (`[]`), `tab_permissions` →
 *    `tabPermissions` (`{}`). A column that is JSON text is parsed; one a
 *    driver already parsed is taken as it is; a `null` or absent column, an
 *    empty string, JSON `null`, or text that does not parse answers the
 *    default;
 *  - `admin_scope` → `adminScope` (ADR-0090 D12), only when the column is
 *    truthy and reads to a truthy value.
 *
 * The body is built from those columns alone, so a row's state and provenance
 * columns (`active`, `managed_by`, `customized`, the timestamps) are not a
 * definition and never travel into one. It then keeps only the keys
 * `PermissionSetSchema` declares, read from the schema's own shape, never
 * transcribed, so the door never meets an unrecognized key; a spec key renamed
 * away would drop out here, which is why the pin asserts every key above
 * survives.
 *
 * ⛔ It is not validation. A row whose stored facet JSON is off-contract still
 * answers a body; the metadata door's validation is what refuses it, and
 * reporting that refusal is the ceremony's.
 */

import { PermissionSetSchema } from '@objectstack/spec/security';

/**
 * One `sys_permission_set` row, as the mapping reads it. Every other column a
 * row carries is accepted and ignored.
 */
export interface PermissionSetRowForDefinition {
  readonly name?: unknown;
  readonly label?: unknown;
  readonly description?: unknown;
  readonly object_permissions?: unknown;
  readonly field_permissions?: unknown;
  readonly system_permissions?: unknown;
  readonly row_level_security?: unknown;
  readonly tab_permissions?: unknown;
  readonly admin_scope?: unknown;
  readonly [column: string]: unknown;
}

/** A facet column as stored: JSON text is parsed, a parsed value is kept, anything unreadable is the default. */
const parseMaybeJson = (value: unknown, fallback: unknown): unknown => {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    const parsed = JSON.parse(value === '' ? 'null' : value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * The body keys `PermissionSetSchema` declares. Resolved on first use, not at
 * module load: the schema is a lazy proxy, and touching `.shape` at import
 * would materialize it for every process that merely loads this module.
 */
let cachedSpecBodyKeys: ReadonlySet<string> | null = null;
function permissionSpecBodyKeys(): ReadonlySet<string> {
  return (cachedSpecBodyKeys ??= new Set(
    Object.keys((PermissionSetSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {}),
  ));
}

/**
 * The permission-set definition one `sys_permission_set` row carries (module
 * doc). Deterministic: the same row answers the same body, key for key and in
 * the same key order. A `null` or absent row answers the body of a row with
 * every column absent.
 */
export function permissionSetDefinitionFromRow(
  row: PermissionSetRowForDefinition | null | undefined,
): Record<string, unknown> {
  const adminScope = row?.admin_scope ? parseMaybeJson(row.admin_scope, undefined) : undefined;
  const candidate: Record<string, unknown> = {
    name: row?.name,
    label: row?.label ?? row?.name,
    ...(row?.description != null ? { description: row.description } : {}),
    objects: parseMaybeJson(row?.object_permissions, {}),
    fields: parseMaybeJson(row?.field_permissions, {}),
    systemPermissions: parseMaybeJson(row?.system_permissions, []),
    rowLevelSecurity: parseMaybeJson(row?.row_level_security, []),
    tabPermissions: parseMaybeJson(row?.tab_permissions, {}),
    ...(adminScope ? { adminScope } : {}),
  };
  const keys = permissionSpecBodyKeys();
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (keys.has(key)) body[key] = value;
  }
  return body;
}
