// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D4, E6] The two writer-stamped columns of `sys_activity` the
 * withheld-row rule is a predicate over, and the ONE derivation that stamps
 * them.
 *
 *  - `changed_fields` — the key set of the recorded change: for an update (both
 *    `metadata.old` and `metadata.new` are records) the union of their keys,
 *    sorted; `[]` for every other row (a create, a delete, an app's note, a row
 *    with no recorded change). `null` is UNSTAMPED.
 *  - `milestone_key` — for a fired milestone the CRUD mirror declared
 *    (`metadata.kind === 'milestone'` beside its `text_sources` declaration),
 *    one sorted text key of every field the object's `activityMilestones`
 *    declaration watched at write time (the declaration's `text_sources.kind`
 *    list); `null` for every other row.
 *
 * ## One derivation
 *
 * {@link planActivityStamp} is the only function that decides either column.
 * The CRUD mirror (`audit-writers.ts`) calls it on the metadata it writes, the
 * `sys_activity` before-insert hook ({@link installActivityStampHook}) calls it
 * on every inserted row, so a writer other than the mirror is stamped the same
 * way, and the stored-row backfill (`activity-changed-fields-backfill.ts`)
 * calls it on the rows at rest. Stored rows and new rows are judged by one
 * rule.
 *
 * ## A row it cannot judge stays unstamped
 *
 * A milestone row the mirror declared with no readable watched-field list (the
 * shape the field redaction calls `'unknown'` provenance) cannot be keyed, so
 * the planner answers `null` and both columns stay `null`. The read rule
 * (`activity-field-redaction.ts`) withholds an unstamped row from every
 * non-system reader: ADR-0139 D4's answer for an unjudged row is closed.
 *
 * ## The key
 *
 * {@link milestoneKeyOf} — the distinct watched field names, sorted, joined by
 * `,`. A field name is a machine name, so the separator cannot occur inside
 * one; a list naming anything else is not keyed. The read rule compares a
 * row's key with the key of the parent object's CURRENT declaration
 * ({@link declaredMilestoneWatchedFields}), the same function the mirror
 * derives the row's list from, so a row written under the declaration that is
 * in force compares equal.
 */

import { isRecord } from './served-fields.js';

/**
 * The `metadata` key under which the CRUD mirror declares which PARENT fields
 * each text column was composed from: `{ summary: string[], record_label:
 * string[] }`. Written by `audit-writers.ts`, read (and stripped) by the field
 * redaction — one name, imported by every half. Defined here, below the
 * redaction, so the planner and the redaction share it without an import cycle.
 */
export const ACTIVITY_TEXT_SOURCES_KEY = 'text_sources';

/**
 * [#22771] The `metadata` key a row's DOMAIN kind rides in. ADR-0052 §5: "`type`
 * stays domain-NEUTRAL … Domain kind rides in `metadata.kind`." So a fired
 * milestone keeps the `type` its declaration names (`completed`, or `updated`
 * when it names none) and says what it is here, which is how a reader tells a
 * "Case resolved" milestone from a finished task.
 */
export const ACTIVITY_KIND_KEY = 'kind';

/** [#22771] The kind the CRUD mirror stamps on a row a declared `activityMilestones` entry fired (ADR-0052 §5b.2). */
export const ACTIVITY_MILESTONE_KIND = 'milestone';

/** The column the key set of a row's recorded change is stamped in. */
export const ACTIVITY_CHANGED_FIELDS_COLUMN = 'changed_fields';

/** The column a fired milestone's watched-field key is stamped in. Never served. */
export const ACTIVITY_MILESTONE_KEY_COLUMN = 'milestone_key';

/** The two stamped columns, in one list for the redaction and the query guard. */
export const ACTIVITY_STAMPED_COLUMNS = [ACTIVITY_CHANGED_FIELDS_COLUMN, ACTIVITY_MILESTONE_KEY_COLUMN] as const;

/** What a row is stamped with. */
export interface ActivityStamp {
  changed_fields: string[];
  milestone_key: string | null;
}

/** Field machine-name shape (`FieldSchema.name` in packages/spec). */
const FIELD_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * The key of a watched-field list: the distinct names, sorted, joined by `,`.
 * `null` for an empty list, and for a list naming anything that is not a field
 * machine name (it cannot be keyed without ambiguity).
 */
export function milestoneKeyOf(fields: readonly unknown[]): string | null {
  if (!fields.every((f) => typeof f === 'string' && FIELD_NAME_RE.test(f))) return null;
  const names = [...new Set(fields as string[])].sort();
  return names.length > 0 ? names.join(',') : null;
}

/**
 * Every field an object's `activityMilestones` declaration watches, in
 * declaration order, distinct: the list the CRUD mirror declares a fired
 * milestone's kind from. An entry is asked when it names a `field` and a
 * `summary` (the mirror's own test). `[]` when the object declares none.
 */
export function declaredMilestoneWatchedFields(objectDef: unknown): string[] {
  const milestones = isRecord(objectDef) ? objectDef.activityMilestones : undefined;
  if (!Array.isArray(milestones)) return [];
  const asked = milestones.filter(
    (m): m is { field: string } => isRecord(m) && typeof m.field === 'string' && typeof m.summary === 'string',
  );
  return [...new Set(asked.map((m) => m.field))];
}

/** Parse a stored `metadata` value: a JSON object, or `null` for anything else. */
function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The stamp for one activity row, from its `metadata` (the stored string, or
 * the object a writer is about to serialize) — or `null` when the row cannot
 * be judged and must stay unstamped (module header). Pure.
 */
export function planActivityStamp(metadata: unknown): ActivityStamp | null {
  const parsed = parseMetadata(metadata);
  if (!parsed) return { changed_fields: [], milestone_key: null };

  const before = parsed.old;
  const after = parsed.new;
  const changed_fields =
    isRecord(before) && isRecord(after) ? [...new Set([...Object.keys(before), ...Object.keys(after)])].sort() : [];

  let milestone_key: string | null = null;
  if (parsed[ACTIVITY_KIND_KEY] === ACTIVITY_MILESTONE_KIND && ACTIVITY_TEXT_SOURCES_KEY in parsed) {
    const declared = parsed[ACTIVITY_TEXT_SOURCES_KEY];
    const list = isRecord(declared) ? declared[ACTIVITY_KIND_KEY] : undefined;
    if (!Array.isArray(list)) return null;
    if (list.length > 0) {
      milestone_key = milestoneKeyOf(list);
      if (milestone_key === null) return null;
    }
  }
  return { changed_fields, milestone_key };
}

/** The engine slice the stamping hook registers on, and reads the registered `sys_activity` from. */
export interface ActivityStampHookEngine {
  registerHook(event: string, handler: (ctx: any) => void | Promise<void>, options?: { object?: string; packageId?: string }): void;
  getSchema?(object: string): unknown;
}

/**
 * Whether the REGISTERED `sys_activity` declares both stamped columns. Read on
 * every call, never cached: a composition that registers its own earlier
 * definition of the object (a test harness, a host override) has no column to
 * stamp, and an insert naming one would be refused as an unknown field.
 */
export function declaresActivityStampColumns(engine: { getSchema?(object: string): unknown }): boolean {
  let fields: unknown;
  try {
    const schema = typeof engine.getSchema === 'function' ? engine.getSchema('sys_activity') : undefined;
    fields = isRecord(schema) ? schema.fields : undefined;
  } catch {
    return false;
  }
  return isRecord(fields) && ACTIVITY_STAMPED_COLUMNS.every((column) => column in fields);
}

/** Stamp one row in place: the planner's answer, over whatever the writer sent. */
export function stampActivityRow(row: Record<string, unknown>): void {
  const stamp = planActivityStamp(row.metadata);
  row[ACTIVITY_CHANGED_FIELDS_COLUMN] = stamp ? stamp.changed_fields : null;
  row[ACTIVITY_MILESTONE_KEY_COLUMN] = stamp ? stamp.milestone_key : null;
}

/**
 * [ADR-0139 E6, Q2 = b] Install the `sys_activity` before-insert hook that
 * stamps both columns on every inserted row, whoever writes it: the CRUD
 * mirror, an app's own server action, the seed loader. The planner's answer is
 * the platform's value and is assigned over a writer's own (the engine's
 * create-side `readonly` strip leaves `sys_` objects to their own guards, so
 * this is the guard): a stamp can never disagree with the row's metadata, and
 * a row the planner cannot judge is stored unstamped.
 */
export function installActivityStampHook(engine: ActivityStampHookEngine, packageId: string): void {
  engine.registerHook(
    'beforeInsert',
    (ctx: any) => {
      if (!declaresActivityStampColumns(engine)) return;
      const data = ctx?.input?.data;
      for (const row of Array.isArray(data) ? data : [data]) if (isRecord(row)) stampActivityRow(row);
    },
    { object: 'sys_activity', packageId },
  );
}
