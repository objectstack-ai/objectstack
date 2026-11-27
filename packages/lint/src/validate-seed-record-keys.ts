// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A seed record key, or a seed `columns` key, that is not a column of the
 * dataset's object (#35143, Seeds and actions family).
 *
 * ## Why
 *
 * The seed load writes each record through the engine's insert, and the
 * engine's declared-field door refuses a payload key the object does not have
 * (`INVALID_FIELD` / 400, `engine-insert.ts`). The load runs in partial mode,
 * so the record is culled and the rest land: the build reads as passed and the
 * first sign is a `[Seeder] … dropped record(s)` line at boot.
 *
 * `defineSeed` already refuses such a key when it runs (`assertSeedKeysDeclared`
 * in `@objectstack/spec/data`). A dataset written without it — a plain
 * `data: [{ object, records }]` entry in the stack, or a `seed` saved through the
 * runtime publish door — was judged by nothing until the load. This rule is the
 * same question asked of every dataset, before the load: the column set is the
 * engine's own declared set for the insert door — the object's fields as served
 * (an object extension may add one), the system columns the platform injects on
 * THAT object (`injectedColumnsFor`, the registry's own plan), and the columns
 * every physical table carries whether declared or not (`id`, `created_at`,
 * `updated_at`: the engine's `PLATFORM_PROVISIONED_COLUMNS`, mirrored here and
 * pinned to it by test). So an object built with `systemFields: false` still
 * admits `created_at`, because the engine's door does; `defineSeed` refuses it
 * for its own reason, which this rule does not claim. An object with an empty
 * field map is not judged: the engine's door has no opinion on it either.
 *
 * A `columns` key that names no column is refused for `defineSeed`'s reason:
 * the policy governs nothing, and the column it was meant for keeps the
 * `always` default.
 *
 * Not judged: a dataset whose object the stack (or, at the publish door, the
 * deployment) does not hold, which is `object-reference-unknown`'s question; and
 * an object whose field map is not readable.
 */

import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';

import { recordsOf } from './object-graph.js';
import { injectedColumnsFor } from './system-fields.js';

type AnyRec = Record<string, unknown>;

/**
 * The columns the engine provisions on every physical table and its insert
 * door accepts undeclared (`PLATFORM_PROVISIONED_COLUMNS`,
 * `packages/objectql/src/declared-read-columns.ts`). Mirrored, not imported:
 * `@objectstack/objectql` depends on this package. The test pins the two
 * lists equal by reading that source.
 */
const ENGINE_PROVISIONED_COLUMNS = ['id', 'created_at', 'updated_at'] as const;

export const SEED_RECORD_UNKNOWN_FIELD = 'seed-record-unknown-field';

export interface SeedRecordKeyFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The column names of one served object: its fields (array or record form) and
 * the system columns the platform injects on it.
 */
function columnsOf(obj: AnyRec): Set<string> | undefined {
  const declared = obj.fields;
  let names: string[];
  if (Array.isArray(declared)) {
    names = declared.filter(isRec).map((f) => f.name).filter((n): n is string => typeof n === 'string');
  } else if (isRec(declared)) {
    names = Object.keys(declared);
  } else {
    return undefined;
  }
  if (names.length === 0) return undefined;
  return new Set([...names, ...injectedColumnsFor(obj), ...ENGINE_PROVISIONED_COLUMNS]);
}

/**
 * Every seed key that names no column of its dataset's object.
 *
 * @param servedObjects The objects as served — the stack's own with its object
 *   extensions folded in (the CLI), or the deployment's served objects (the
 *   runtime publish gate). Defaults to `stack.objects`.
 */
export function validateSeedRecordKeys(stack: AnyRec, servedObjects?: readonly unknown[]): SeedRecordKeyFinding[] {
  const findings: SeedRecordKeyFinding[] = [];
  if (!isRec(stack) || !Array.isArray(stack.data)) return findings;

  const columnsByObject = new Map<string, Set<string> | undefined>();
  for (const obj of recordsOf(servedObjects ?? stack.objects)) {
    if (typeof obj.name !== 'string' || columnsByObject.has(obj.name)) continue;
    columnsByObject.set(obj.name, columnsOf(obj));
  }

  stack.data.forEach((dataset: unknown, di: number) => {
    if (!isRec(dataset) || typeof dataset.object !== 'string') return;
    const object = dataset.object;
    const columns = columnsByObject.get(object);
    if (!columns) return;
    const known = [...columns];

    const report = (key: string, path: string, where: string, surface: 'record' | 'columns'): void => {
      if (columns.has(key)) return;
      const suggestion = formatSuggestion(findClosestMatches(key, known));
      findings.push({
        severity: 'error',
        rule: SEED_RECORD_UNKNOWN_FIELD,
        where,
        path,
        message:
          surface === 'record'
            ? `seed key "${key}" is not a field of "${object}", so the seed load refuses this record ` +
              '(the engine refuses a key the object does not declare) and drops it while the rest load.'
            : `seed \`columns\` key "${key}" is not a field of "${object}", so its policy governs nothing and ` +
              'the column it was meant for keeps the `always` default.',
        hint:
          `${suggestion ? `${suggestion} ` : ''}Fix the key's spelling, declare the field "${key}" on "${object}", ` +
          'or remove the key.',
      });
    };

    const reported = new Set<string>();
    recordsOf(dataset.records).forEach((record, ri) => {
      for (const key of Object.keys(record)) {
        // One finding per dataset and key: a misspelt key is usually misspelt
        // on every record, and the record index of the first names it.
        if (reported.has(key)) continue;
        if (columns.has(key)) continue;
        reported.add(key);
        report(key, `data[${di}].records[${ri}].${key}`, `seed "${object}" · records[${ri}]`, 'record');
      }
    });
    if (isRec(dataset.columns)) {
      for (const key of Object.keys(dataset.columns)) {
        report(key, `data[${di}].columns.${key}`, `seed "${object}" · columns`, 'columns');
      }
    }
  });

  return findings;
}
