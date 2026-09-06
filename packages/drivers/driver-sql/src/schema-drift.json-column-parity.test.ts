// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15771] The DETECTOR's JSON-class predicate is the WRITER's, and stays it.
 *
 * The defect was a fork, not a missing rule. `createColumn` gives a field a
 * json column when `JSON_COLUMN_TYPES.has(type)` — the type ALONE — and
 * `isJsonField`, the read-side deserializer, is `JSON_COLUMN_TYPES.has(type) ||
 * !!field.multiple`. `diffManagedTable`'s base-type branch asked only
 * `field.multiple === true`. So a SINGLE-VALUE JSON-class field (`file`,
 * `location`, `record`, `vector`, the option families) on a `varchar`/`text`
 * column was written as JSON by the writer and did not exist to the differ —
 * permanently, because the additive sync never revisits a column, and silently,
 * because nothing else reports it.
 *
 * Measured on the pre-fix tree, one `diffManagedTable` call per type: all
 * FIFTEEN JSON-class types the spec declares returned ZERO entries over a
 * `character varying(2048)` column on `postgres`, while the same column under a
 * `{ multiple: true }` field returned one in the same run.
 *
 * ## Why this file exists rather than a list in the source
 *
 * `sql-driver.ts` imports `schema-drift.ts`, so the differ cannot import the
 * writer's `JSON_COLUMN_TYPES` — the same cycle `UNBOUNDED_TEXT_FIELD_TYPES`
 * documents. {@link JSON_COLUMN_FIELD_TYPES} is therefore a second constant,
 * seeded from the SAME `@objectstack/spec` sets, and a second constant is only
 * as good as the pin that holds it equal. Both directions are load-bearing:
 *
 *   - `⊇` — a value-shape class added to the spec that reaches the writer but
 *     not the differ re-opens exactly this blind spot, by the door it came in.
 *   - `⊆` — a type listed here that the writer does NOT give a json column
 *     would be reported as needing a conversion to a column shape the platform
 *     would never create: a finding an operator can act on and be left with
 *     drift.
 *
 * The classification PROBES the driver rather than restating its cases (the
 * technique `schema-drift.unbounded-text-column.test.ts` and
 * `sql-driver-12017-bounded-string-spec-parity.test.ts` use), and the last case
 * probes the DIFFER's observable verdict rather than the constant, so the two
 * halves are compared where they actually meet.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { diffManagedTable, JSON_COLUMN_FIELD_TYPES, type PhysicalColumn } from './schema-drift.js';
import { dialectCell } from './live-dialect-matrix.testkit.js';

/** `SqlDriver.isJsonField` is protected — the writer's own predicate, exposed unchanged. */
class WriterProbe extends SqlDriver {
  asksJson(type: string, field: Record<string, unknown> = {}): boolean {
    return this.isJsonField(type, field);
  }
}

const STALE: PhysicalColumn[] = [{ name: 'doc', type: 'character varying', nullable: true, maxLength: 2048 }];

/** Does the DIFFER report the base-type divergence for this declaration? */
const differReports = (field: Record<string, unknown>): boolean =>
  diffManagedTable({ table: 'proj_task', fields: { doc: field } as never, columns: STALE, dialect: 'postgres' })
    .some((d) => d.op.type === 'manual_column_type_change');

describe('the JSON-class predicate the differ reads is the one the writer reads (#15771)', () => {
  let driver: WriterProbe;
  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it('holds the set equal to `isJsonField` over every FieldType the spec declares', () => {
    driver = new WriterProbe(dialectCell('sqlite').config());
    const types = FieldType.options as readonly string[];
    expect(types.length).toBeGreaterThan(40); // the spec registry really was read

    const writerSaysJson = types.filter((t) => driver.asksJson(t)).sort();
    const declared = [...JSON_COLUMN_FIELD_TYPES].filter((t) => types.includes(t)).sort();

    // Non-vacuity: the writer answered NO for a large part of the vocabulary,
    // so an equality between two everything-sets cannot pass for a measurement.
    expect(types.filter((t) => !driver.asksJson(t)).length).toBeGreaterThan(10);
    expect(writerSaysJson).toEqual(declared);
    expect(writerSaysJson.length).toBeGreaterThan(10);
  });

  it('the only NON-FieldType members are the two driver-internal aliases, and the writer owns them too', () => {
    driver = new WriterProbe(dialectCell('sqlite').config());
    const types = FieldType.options as readonly string[];

    // `object` / `array` name introspected external columns, not authorable
    // types — they are the one hand-written part of the set, so they are the
    // one part that can silently gain a third member.
    const aliases = [...JSON_COLUMN_FIELD_TYPES].filter((t) => !types.includes(t)).sort();
    expect(aliases).toEqual(['array', 'object']);
    for (const alias of aliases) expect(driver.asksJson(alias), alias).toBe(true);
  });

  it('the DIFFER agrees with the writer over the whole vocabulary, `multiple` and not', () => {
    // ⭐ The pin that matters: not "two constants match" but "the two halves
    // reach the same verdict about the same declaration". Probed through
    // `diffManagedTable`'s output, so it fails if the branch stops consulting
    // the set as much as if the set drifts.
    driver = new WriterProbe(dialectCell('sqlite').config());
    const types = FieldType.options as readonly string[];

    const disagreements: string[] = [];
    for (const type of types) {
      for (const multiple of [false, true]) {
        const field = multiple ? { type, multiple: true } : { type };
        const writer = driver.asksJson(type, field);
        if (writer !== differReports(field)) disagreements.push(`${type}${multiple ? ' multiple' : ''}`);
      }
    }
    expect(disagreements).toEqual([]);

    // Non-vacuity in both directions, in the same run: the loop above saw real
    // trues and real falses rather than passing over a uniform answer.
    expect(differReports({ type: 'file' })).toBe(true);
    expect(differReports({ type: 'string', multiple: true })).toBe(true);
    expect(differReports({ type: 'string' })).toBe(false);
    expect(differReports({ type: 'integer' })).toBe(false);
  });
});
