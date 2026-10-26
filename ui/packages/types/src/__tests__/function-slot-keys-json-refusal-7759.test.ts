/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The four NON-`on*` function-valued keys the zod mirrors declared as a bare
 * `z.function()` now REFUSE BY NAME (objectui#7759 group E, ruling
 * 「E 组按 #6124 直接派」 — the objectui#6124 shape applied to the keys that
 * ruling's Q4 → B had kept out of its `on*` sweep).
 *
 * ## The defect
 *
 * zod 4 gives a `z.function()` mirror an opaque input brand that no concrete
 * signature equals, so each of these mirrors ACCEPTED ANY CALLABLE where the
 * TypeScript declaration states one signature — the WIDER direction's
 * FUNCTION-SLOT class in `zod-mirror-parity.test.ts`. And on the JSON face the
 * key could never be satisfied at all: an authored value got zod's bare
 * `invalid_type … expected function`, naming nothing about why.
 *
 * ## The disposition, measured per key on the read sites
 *
 *   - `TableColumnSchema.cell` — RUNTIME SLOT: `data-table` calls
 *     `col.cell(cellValue, row)`; `ObjectGrid` and `VirtualGrid` call it too.
 *   - `DataTableSchema.renderCellEditor` — RUNTIME SLOT: `data-table` reads
 *     `schema.renderCellEditor` and calls it; `ObjectGrid` supplies it.
 *   - `FieldConstraintsSchema.validate` — RUNTIME SLOT: the form renderer
 *     spreads `validation` into react-hook-form's `rules` and keeps a supplied
 *     `validate` function running beside its own `required` entry.
 *   - `FieldConditionSchema.custom` — RETIRED: the form renderer's
 *     `legacyConditionToCel` reads `field` / `equals` / `notEquals` / `in` and
 *     never `custom`, and nothing else reads `FieldCondition`; a supplied
 *     function never ran. The TypeScript member is a `?: never` tombstone.
 *
 * The zod face is `handlerKeyRefusal()` for all four, exactly as for the
 * objectui#6124 keys; the pins below mirror
 * `./handler-keys-json-refusal-6124.test.ts`.
 *
 * ## Red-first
 *
 * On the base (`origin/main` `d16d0e977`) every behaviour pin below fails: an
 * authored value is refused with `invalid_type`, not `custom`; a live function
 * parses GREEN; the description does not carry the guidance; and
 * `tsc -p tsconfig.test.json` reports TS2344 on the `RetiredIsNever` line
 * (`custom` is still a function type).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { DataTableSchema as DataTableZod, TableColumnSchema as TableColumnZod } from '../zod/data-display.zod';
import {
  FieldConditionSchema as FieldConditionZod,
  FieldConstraintsSchema as FieldConstraintsZod,
  FormFieldSchema as FormFieldZod,
} from '../zod/form.zod';
import type { DataTableSchema, TableColumn } from '../data-display';
import type { FieldCondition, FieldValidationRules } from '../form';

type Site = readonly [schema: string, key: string, mirror: z.ZodObject<z.ZodRawShape>];

const RUNTIME_SLOT: readonly Site[] = [
  ['TableColumnSchema', 'cell', TableColumnZod],
  ['DataTableSchema', 'renderCellEditor', DataTableZod as unknown as z.ZodObject<z.ZodRawShape>],
  ['FieldConstraintsSchema', 'validate', FieldConstraintsZod],
];

const RETIRED: readonly Site[] = [['FieldConditionSchema', 'custom', FieldConditionZod]];

const ALL_SITES: readonly Site[] = [...RUNTIME_SLOT, ...RETIRED];

const describeOf = (mirror: z.ZodObject<z.ZodRawShape>, key: string): string | undefined =>
  (mirror.shape[key] as { description?: string } | undefined)?.description;

/** The member's own declaration, lifted out of its object, so a refusal can
 *  only be about the key under test (the objectui#6124 pin's isolation). */
const pickKey = (mirror: z.ZodObject<z.ZodRawShape>, key: string) => z.object({ [key]: mirror.shape[key] });

const JSON_VALUES: readonly unknown[] = [
  { action: 'toast', title: 'Saved' },
  'function (v) { return true; }',
  true,
];
const LIVE_FUNCTION = () => undefined;

/* ── Census ──────────────────────────────────────────────────────────────── */

describe('census: no mirror declares a key as a bare z.function() (objectui#7759 group E)', () => {
  it('the anchored `key: z.function(` census over every zod mirror finds 0 sites', () => {
    const zodDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'zod');
    const files = readdirSync(zodDir).filter((f) => f.endsWith('.zod.ts'));
    expect(files).toContain('form.zod.ts');
    const anchored = /^\s*[A-Za-z_$][\w$]*: z\.function\(/gm;
    const hits = files.flatMap((f) =>
      [...readFileSync(join(zodDir, f), 'utf8').matchAll(anchored)].map((m) => `${f}: ${m[0].trim()}`),
    );
    expect(hits).toEqual([]);
    // Positive control: the regex matches the spelling the four sites had.
    expect("  validate: z.function().optional().describe('x'),".match(anchored)).not.toBeNull();
  });

  it.each(ALL_SITES)('%s.%s is still DECLARED on the mirror shape, carrying the objectui#6124 guidance', (_schema, key, mirror) => {
    // `.shape`, not `safeParse`: a deleted key would be silently STRIPPED by a
    // non-strict object (or KEPT by `.passthrough()`), so a parse-based
    // declaration pin stays green through the deletion it exists to catch.
    expect(mirror.shape[key]).toBeDefined();
    expect(describeOf(mirror, key)).toContain('objectui#6124');
    expect(describeOf(mirror, key)).toContain(`\`${key}\``);
  });
});

/* ── Behaviour: refused by name ───────────────────────────────────────────── */

describe('a JSON author is refused BY NAME, not with zod\'s bare invalid_type', () => {
  for (const value of JSON_VALUES) {
    it.each(ALL_SITES)(`%s.%s refuses the JSON value ${JSON.stringify(value)} with its own guidance`, (_schema, key, mirror) => {
      const result = pickKey(mirror, key).safeParse({ [key]: value });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues).toHaveLength(1);
      const [issue] = result.error.issues;
      expect(issue.code).toBe('custom');
      expect(issue.path).toEqual([key]);
      expect(issue.message).toContain(`\`${key}\``);
      expect(issue.message).not.toContain('expected function');
      // One string feeds both author-facing channels.
      expect(issue.message).toBe(describeOf(mirror, key));
    });
  }

  it.each(ALL_SITES)('%s.%s refuses a LIVE FUNCTION too — the JSON mirror is not the programmatic channel', (_schema, key, mirror) => {
    const result = pickKey(mirror, key).safeParse({ [key]: LIVE_FUNCTION });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', [key]]]);
  });

  it.each(ALL_SITES)('%s.%s — the isolated shape parses GREEN without the key (the arm is optional)', (_schema, key, mirror) => {
    expect(pickKey(mirror, key).safeParse({}).success).toBe(true);
  });

  it('the guidance wording states the measured disposition', () => {
    for (const [, key, mirror] of RUNTIME_SLOT) {
      expect(describeOf(mirror, key), key).toContain('RUNTIME SLOT');
      expect(describeOf(mirror, key), key).not.toContain('RETIRED');
    }
    for (const [, key, mirror] of RETIRED) {
      expect(describeOf(mirror, key), key).toContain('RETIRED (objectui#6124');
      expect(describeOf(mirror, key), key).not.toContain('RUNTIME SLOT');
    }
  });
});

/* ── The refusal reaches the documents that NEST these shapes ─────────────── */

describe('the nested faces refuse at the nested path', () => {
  it('a form field authoring `validation.validate` is refused at that path', () => {
    const result = FormFieldZod.safeParse({ name: 'email', validation: { required: true, validate: 'isEmail' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['validation', 'validate']]]);
  });

  it('a form field authoring `condition.custom` is refused at that path', () => {
    const result = FormFieldZod.safeParse({ name: 'email', condition: { field: 'kind', custom: 'x => true' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['condition', 'custom']]]);
  });

  it('a data-table column authoring `cell` is refused at that path', () => {
    const result = DataTableZod.safeParse({
      type: 'data-table',
      columns: [{ header: 'Amount', accessorKey: 'amount', cell: '{{value}}' }],
      data: [],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['columns', 0, 'cell']]]);
  });

  it('the same documents parse GREEN once the function-slot keys are left out', () => {
    expect(
      FormFieldZod.safeParse({
        name: 'email',
        validation: { required: true, minLength: { value: 3, message: 'At least 3' } },
        condition: { field: 'kind', equals: 'person' },
      }).success,
    ).toBe(true);
    expect(
      DataTableZod.safeParse({
        type: 'data-table',
        columns: [{ header: 'Amount', accessorKey: 'amount' }],
        data: [],
      }).success,
    ).toBe(true);
  });
});

/* ── The TypeScript face, judged by `tsc -p tsconfig.test.json` ──────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** `?: never` reads as exactly `undefined` off the interface. */
type RetiredIsNever<T> = Equal<T, undefined>;

/** A runtime slot keeps a callable member. */
type KeepsFunction<T> = [Extract<NonNullable<T>, (...args: never[]) => unknown>] extends [never]
  ? false
  : true;

export type assertionRuntimeSlotsKeepTheirFunctionType = [
  Expect<KeepsFunction<TableColumn['cell']>>,
  Expect<KeepsFunction<DataTableSchema['renderCellEditor']>>,
  Expect<KeepsFunction<FieldValidationRules['validate']>>,
];

export type assertionRetiredKeyIsTombstoned = [Expect<RetiredIsNever<FieldCondition['custom']>>];
