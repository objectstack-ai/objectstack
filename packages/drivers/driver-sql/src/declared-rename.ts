// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared rename carries the old column's values to the new key.
 *
 * Epic cloud#3652, ruling Q3 「默认拒绝，需显式映射（推荐）」 and D3 「写进清单
 * renamedFrom」: a package author declares a rename on the field
 * (`renamedFrom: ['old_key']`, `packages/spec/src/data/field.zod.ts`), and every
 * installer's upgrade applies it. Schema sync is otherwise additive
 * (`schema-drift.ts`): without this step the renamed field is a new, empty
 * column beside the old one, and the values stay behind.
 *
 * ## The rule, read from the new metadata and the physical table only
 *
 * A field `b` declaring `renamedFrom: ['a', …]` is carried from `a` when the
 * table has a column for `a`, none for `b`, and the object no longer declares
 * `a`. Because the rule reads nothing else, it is idempotent — a second sync
 * finds `b` and no `a`, and does nothing — and it is the same on every path
 * that reaches the driver's sync: the install door, a boot on a new artifact,
 * `os start` / `os dev`, and `os migrate apply`.
 *
 * ## What is refused, before any write
 *
 * The planner refuses a declaration it cannot honour without guessing, and
 * names the field, the old key and the reason. Nothing on the table changes:
 *
 * - `platform_column` — the old key is a column the platform owns (`id`,
 *   `created_at`, `updated_at`, the table's tenant column, or a driver-owned
 *   hash shadow). Those names are never in an author's `fields` map, so under
 *   the carry rule they would move the primary key or an audit column into an
 *   author's field;
 * - `live_key` — the old key is a field the object still declares. The spec
 *   refuses that within one declaration (`refuseDishonestRenamedFrom`), but an
 *   object extension's fields are merged after it, so the merged map can still
 *   carry one; the carry would otherwise be silently a no-op;
 * - `claimed_twice` — two fields of the merged object claim the same old key;
 * - `both_columns` — the old column and the new one both exist: a half-done
 *   state no rule can resolve without choosing which values to keep;
 * - `several_old_columns` — two old keys in one list both still have columns;
 * - `destructive_type` — the old column, read under the new declaration, is a
 *   change the drift categories call `destructive` (the driver's own
 *   {@link diffManagedTable}, judged by the caller that can read the column);
 * - `index_cannot_follow` — an index keyed on the old column cannot follow it
 *   (a MySQL hash-shadow carrier: its generated column references the old
 *   column by name, and MySQL refuses to rename such a column).
 *
 * A transport that cannot rename a column at all (`SqlDriver.declaredRenameLimit`)
 * is refused by the caller, before this planner runs.
 *
 * It carries no ADR-0112 `code`, for the reason `existing-table-refusal.ts`
 * gives: the boot sync and `os migrate apply` report the refusal's text, and
 * the install door answers it with its own body refusal.
 */

import { BUILTIN_COLUMNS, fieldHasColumn, isHashShadowColumn } from './schema-drift.js';

/** One column the sync carries: `from` is renamed to `to`, values and all. */
export interface DeclaredRenameCarry {
  table: string;
  /** The installed key: the column that holds the values. */
  from: string;
  /** The new key: the field that declares `renamedFrom`. */
  to: string;
}

/** Why a declared rename is refused. See the module header for each. */
export type DeclaredRenameRefusalReason =
  | 'platform_column'
  | 'live_key'
  | 'claimed_twice'
  | 'both_columns'
  | 'several_old_columns'
  | 'destructive_type'
  | 'index_cannot_follow'
  | 'transport';

/** One refused declaration: the field, the old key(s) and the reason, in words. */
export interface DeclaredRenameRefusalEntry {
  table: string;
  /** The field that declares `renamedFrom`. */
  field: string;
  /** The old key(s) the refusal is about. */
  from: string[];
  reason: DeclaredRenameRefusalReason;
  /** One sentence: what was refused and why. */
  message: string;
}

/** The planner's answer for one table. */
export interface DeclaredRenamePlan {
  carries: DeclaredRenameCarry[];
  refusals: DeclaredRenameRefusalEntry[];
}

/**
 * The columns a `renamedFrom` entry may never name: the builtin columns, the
 * table's tenant column, and any driver-owned hash shadow.
 */
export function isPlatformOwnedColumn(name: string, tenantField: string | null | undefined): boolean {
  return BUILTIN_COLUMNS.has(name) || (!!tenantField && name === tenantField) || isHashShadowColumn(name);
}

/** The `renamedFrom` entries a field declares, strings only, in order. */
export function renamedFromOf(def: unknown): string[] {
  const list = (def as { renamedFrom?: unknown } | null | undefined)?.renamedFrom;
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string' && k !== '') : [];
}

const quote = (keys: readonly string[]): string => keys.map((k) => `'${k}'`).join(', ');

/**
 * Plan the declared renames of one table from the object's fields and the
 * columns the table has. Pure: the reads are the caller's.
 *
 * `liveKeys` is the set of keys the object declares once the upgrade is in
 * place — the merged map's keys by default. The install door passes the map
 * the upgrade will leave, which can differ from `fields` when the declaring
 * package is an extension of another package's object.
 */
export function planDeclaredRenames(args: {
  table: string;
  fields: Record<string, unknown>;
  physicalColumns: ReadonlySet<string>;
  tenantField?: string | null;
  liveKeys?: Iterable<string>;
}): DeclaredRenamePlan {
  const { table, fields, physicalColumns } = args;
  const tenantField = args.tenantField ?? null;
  const live = new Set(args.liveKeys ?? Object.keys(fields));
  const carries: DeclaredRenameCarry[] = [];
  const refusals: DeclaredRenameRefusalEntry[] = [];
  const claimedBy = new Map<string, string>();
  const refuse = (field: string, from: string[], reason: DeclaredRenameRefusalReason, why: string): void => {
    refusals.push({ table, field, from, reason, message: `${table}.${field} declares \`renamedFrom\` ${quote(from)}: ${why}` });
  };

  for (const [field, def] of Object.entries(fields)) {
    const entries = renamedFromOf(def);
    if (entries.length === 0) continue;
    // A builtin key is never a field the sync materialises (the builtin
    // collision warning says so), and a virtual field has no column to carry
    // values into: neither is a rename target.
    if (BUILTIN_COLUMNS.has(field) || !fieldHasColumn((def ?? {}) as Record<string, any>)) continue;

    const usable: string[] = [];
    let refused = false;
    for (const old of entries) {
      if (isPlatformOwnedColumn(old, tenantField)) {
        refuse(field, [old], 'platform_column',
          `'${old}' is a column the platform owns (the record id, an audit timestamp, the tenant column or a `
          + 'driver-owned index column), never an earlier key of a field, so its values are never carried. Remove the '
          + 'entry from `renamedFrom`.');
        refused = true;
        continue;
      }
      if (live.has(old)) {
        refuse(field, [old], 'live_key',
          `'${old}' is still a field of this object once the upgrade is in place (declared by the object or by an `
          + 'extension of it), so it is not an earlier key of this field. Remove the entry, or remove the field that '
          + 'still declares it.');
        refused = true;
        continue;
      }
      const first = claimedBy.get(old);
      if (first !== undefined) {
        refuse(field, [old], 'claimed_twice',
          `'${old}' is also claimed by the field '${first}' of this object; an old key carries into one field only. `
          + 'Remove it from one of the two lists.');
        refused = true;
        continue;
      }
      claimedBy.set(old, field);
      usable.push(old);
    }
    if (refused) continue;

    const present = usable.filter((old) => physicalColumns.has(old));
    if (present.length === 0) continue;
    if (physicalColumns.has(field)) {
      refuse(field, present, 'both_columns',
        `the table has a column for ${quote(present)} and one for '${field}' too — a half-done rename, and carrying `
        + 'would have to choose whose values to keep. Nothing was changed. Move the values you keep into one column '
        + 'by hand and drop the other, then sync again.');
      continue;
    }
    if (present.length > 1) {
      refuse(field, present, 'several_old_columns',
        `the table still has a column for each of ${quote(present)}, so which one holds the values of '${field}' `
        + 'cannot be told. Nothing was changed. Drop the column that does not, then sync again.');
      continue;
    }
    carries.push({ table, from: present[0]!, to: field });
  }
  return { carries, refusals };
}

/**
 * Thrown by the sync (`SqlDriver.carryDeclaredRenames`) when a table's declared
 * renames are refused. Raised before any DDL on that table: no column is
 * renamed, added or dropped.
 */
export class DeclaredRenameRefusal extends Error {
  constructor(
    readonly table: string,
    readonly refusals: DeclaredRenameRefusalEntry[],
  ) {
    super(renderDeclaredRenameRefusal(table, refusals));
    this.name = 'DeclaredRenameRefusal';
  }
}

/**
 * The refusal's prose: each refused declaration, then what was left alone.
 * Exported so the pins read the renderer the sync throws through.
 */
export function renderDeclaredRenameRefusal(table: string, refusals: readonly DeclaredRenameRefusalEntry[]): string {
  return (
    `Schema sync REFUSED for the table '${table}': ${refusals.map((r) => r.message).join(' ')} `
    + 'Nothing was changed on this table: no column was renamed, added or dropped, and every row keeps its values.'
  );
}

/** A knex-shaped runner: the driver's `knex` or a transaction of it. */
type RawRunner = { raw(sql: string, bindings?: readonly unknown[]): Promise<unknown> };

/**
 * Rename the planned columns, all or none. PostgreSQL and SQLite (3.25+) run
 * `ALTER TABLE … RENAME COLUMN` inside one transaction, since their DDL is
 * transactional; MySQL (8.0+) commits each DDL statement on its own, so every
 * rename of the table goes into ONE `ALTER TABLE` statement, which is atomic.
 * Each dialect keeps the column's type, constraints and data, and rewrites the
 * indexes that key on it.
 */
export async function executeDeclaredRenames(
  knex: RawRunner & { transaction<T>(fn: (trx: RawRunner) => Promise<T>): Promise<T> },
  dialect: 'sqlite' | 'postgres' | 'mysql',
  table: string,
  carries: ReadonlyArray<Pick<DeclaredRenameCarry, 'from' | 'to'>>,
): Promise<void> {
  if (carries.length === 0) return;
  if (dialect === 'mysql') {
    await knex.raw(
      `alter table ?? ${carries.map(() => 'rename column ?? to ??').join(', ')}`,
      [table, ...carries.flatMap((c) => [c.from, c.to])],
    );
    return;
  }
  await knex.transaction(async (trx) => {
    for (const c of carries) await trx.raw('alter table ?? rename column ?? to ??', [table, c.from, c.to]);
  });
}
