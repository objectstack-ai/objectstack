// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D10] A `sys_position` row, turned into the position DEFINITION
 * it carries.
 *
 * The security catalog's one home is environment metadata (ADR-0131 D3). A
 * position an administrator created in Setup before that move is a row and
 * nothing else, and the upgrade ceremony (`os migrate`, C7b) converts it: it
 * reads the row, calls this function, and saves the answer through the
 * metadata door. ⛔ Never at boot: a conversion that ran on every start would be
 * the dual source ADR-0131 D10 retires.
 *
 * The function is pure: one row in, one body out — no engine, no I/O. It is
 * the mapping the security plugin's row-only position backfill applied until
 * C3 stage 8 retired that boot module, held here as the one mapping the
 * ceremony reads.
 *
 * The definition is the four `PositionSchema` keys the row has columns for, in
 * this key order:
 *
 *  - `name` → `name`, as stored;
 *  - `label` → `label` when it is a non-empty string, else the name;
 *  - `description` → `description` only when it is a non-empty string: the
 *    schema declares it optional, not nullable, so a `null` or empty column is
 *    absent, never `null`;
 *  - `delegatable` → `delegatable`, always present: `true` for a stored
 *    `true`, `1`, `'1'` or `'true'`, and `false` for anything else, an absent
 *    column included.
 *
 * `active` and `is_default` are row state — no `PositionSchema` key carries
 * them — and never travel; neither does any provenance or timestamp column.
 * The position's `permissionSets` are not a column either: the junction rows
 * that bound them convert through `convertPositionBindingRows`.
 *
 * ⛔ It is not validation, and it does not judge the name. A name outside the
 * metadata door's item-name grammar still answers a body; the door's own
 * validation refuses it, and reporting that refusal is the ceremony's. Nor
 * does it reconcile rows: where two organizations' rows of one name answer
 * different definitions, which one the environment keeps is the ceremony's to
 * report, never this function's to pick.
 */

/**
 * One `sys_position` row, as the mapping reads it. Every other column a row
 * carries is accepted and ignored.
 */
export interface PositionRowForDefinition {
  readonly name?: unknown;
  readonly label?: unknown;
  readonly description?: unknown;
  readonly delegatable?: unknown;
  readonly [column: string]: unknown;
}

/**
 * The position definition one `sys_position` row carries (module doc).
 * Deterministic: the same row answers the same body, key for key and in the
 * same key order, so two rows' bodies compare equal exactly when their
 * serializations do.
 */
export function positionDefinitionFromRow(row: PositionRowForDefinition): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: row.name,
    label: typeof row.label === 'string' && row.label !== '' ? row.label : row.name,
  };
  if (typeof row.description === 'string' && row.description !== '') body.description = row.description;
  body.delegatable =
    row.delegatable === true || row.delegatable === 1 || row.delegatable === '1' || row.delegatable === 'true';
  return body;
}
