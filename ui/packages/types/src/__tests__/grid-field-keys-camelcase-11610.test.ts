/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `grid` widget's eight field-level keys are camelCase, and their retired
 * snake_case spellings are REFUSED BY NAME (objectui#11610).
 *
 * `@objectstack/spec`'s runtime form field can only declare camelCase config
 * keys, so `min_rows`, `max_rows`, `allow_add`, `allow_delete`,
 * `allow_reorder`, `total_field`, `add_label` and `sort_field` became
 * `minRows`, `maxRows`, `allowAdd`, `allowDelete`, `allowReorder`,
 * `totalField`, `addLabel` and `sortField` in one move. The old spellings
 * retired at once, with no alias window and no dual read: each stays DECLARED
 * so that it is refused by name with the camelCase key to write, rather than
 * stripped in silence. `GRID_FIELD_RETIRED_KEYS` is the one list.
 *
 * What this file holds, per face of `@object-ui/types`:
 *
 *   1. zod — the form-field mirror, the tolerant face (`safeValidateSchema`)
 *      and the strict authoring face (the `objectui validate` door) each answer
 *      a snake_case key with exactly one `invalid_type` issue at that key,
 *      whose message names the camelCase replacement; the camelCase key with
 *      the same value parses on all three (the lit control);
 *   2. TypeScript — each tombstone refuses an authored value, and a DELETION
 *      GUARD per member that does not lean on an index signature: an `Equal`
 *      row on the member's type (`undefined` for a `?: never` member, a
 *      compile error once the member is gone from `GridFieldMetadata`, and the
 *      index signature's `any` once it is gone from `FormField`), plus a
 *      `keyof` membership row on `FormField`. A `@ts-expect-error` over a
 *      fresh literal alone cannot do this on `GridFieldMetadata`: with the
 *      tombstone deleted the key is still refused, as an excess property, and
 *      the directive swallows that error instead (the objectui#8347 lesson).
 *      Type-level rows are read by `tsc -p tsconfig.test.json` only.
 *
 * The widget's face — `GridField` drawing a named refusal instead of the grid
 * — is pinned in `packages/fields`, in `GridField.retiredSnakeKeys-11610.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { GRID_FIELD_RETIRED_KEYS, type GridFieldRetiredKey } from '../index.js';
import type { BaseFieldMetadata, GridFieldMetadata } from '../field-types.js';
import type { FormField } from '../form.js';
import { FormFieldSchema } from '../zod/form.zod.js';
import { StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string };

/** A grid value of the camelCase key's declared type, which the snake_case key used to carry too. */
const VALUE: Record<GridFieldRetiredKey, unknown> = {
  min_rows: 1,
  max_rows: 20,
  allow_add: false,
  allow_delete: false,
  allow_reorder: false,
  total_field: 'amount',
  add_label: 'Add line',
  sort_field: 'position',
};

const RETIRED = Object.entries(GRID_FIELD_RETIRED_KEYS) as Array<[GridFieldRetiredKey, string]>;

const gridEntry = (extra: Record<string, unknown>) => ({
  name: 'lines',
  label: 'Lines',
  type: 'grid',
  columns: [{ name: 'product', type: 'text' }, { name: 'amount', type: 'currency' }],
  ...extra,
});
const formWith = (extra: Record<string, unknown>) => ({ type: 'form', fields: [gridEntry(extra)] });

/** The three zod doors, each with the document it parses and the path the entry sits at. */
const DOORS: ReadonlyArray<readonly [string, (extra: Record<string, unknown>) => z.ZodSafeParseResult<unknown>, PropertyKey[]]> = [
  ['the form-field mirror', (extra) => FormFieldSchema.safeParse(gridEntry(extra)), []],
  ['the tolerant face (`safeValidateSchema`)', (extra) => safeValidateSchema(formWith(extra)), ['fields', 0]],
  ['the strict authoring face', (extra) => StrictAnyComponentSchema.safeParse(formWith(extra)), ['fields', 0]],
];

const issuesOf = (result: z.ZodSafeParseResult<unknown>): Issue[] | null =>
  result.success ? null : (result.error.issues as unknown as Issue[]);

describe('objectui#11610 — `GRID_FIELD_RETIRED_KEYS` is the rename map', () => {
  it('maps the eight snake_case spellings to the eight camelCase keys, one to one', () => {
    expect(Object.keys(GRID_FIELD_RETIRED_KEYS)).toEqual([
      'min_rows', 'max_rows', 'allow_add', 'allow_delete', 'allow_reorder', 'total_field', 'add_label', 'sort_field',
    ]);
    expect(Object.values(GRID_FIELD_RETIRED_KEYS)).toEqual([
      'minRows', 'maxRows', 'allowAdd', 'allowDelete', 'allowReorder', 'totalField', 'addLabel', 'sortField',
    ]);
  });
});

describe.each(DOORS)('objectui#11610 — %s', (_door, parse, at) => {
  it.each(RETIRED)('refuses `%s` BY NAME, naming `%s` as the key to write', (snake, camel) => {
    const issues = issuesOf(parse({ [snake]: VALUE[snake] }));
    expect(issues, `${snake} must not parse`).not.toBeNull();
    expect(issues!.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'invalid_type', path: [...at, snake] }]);
    expect(issues![0].message).toContain(`Did you mean \`${snake}\` → \`${camel}\`?`);
  });

  it.each(RETIRED)('LIT CONTROL: `%s`\'s value parses under `%s`, and is kept', (snake, camel) => {
    const result = parse({ [camel]: VALUE[snake] });
    expect(issuesOf(result)).toBeNull();
  });

  it('refuses a snake_case key whatever its value: the refusal is by name, not by type', () => {
    for (const [snake] of RETIRED) {
      for (const value of [0, 'x', true, null]) {
        const issues = issuesOf(parse({ [snake]: value }));
        expect(issues?.map((i) => i.path.join('.')), `${snake}: ${String(value)}`).toEqual([[...at, snake].join('.')]);
      }
    }
  });
});

describe('objectui#11610 — the camelCase keys are kept by the tolerant parse', () => {
  it('a grid entry carrying all eight camelCase keys parses on the tolerant face with every value kept', () => {
    const camel = Object.fromEntries(RETIRED.map(([snake, key]) => [key, VALUE[snake]]));
    const parsed = safeValidateSchema(formWith(camel));
    expect(parsed.success).toBe(true);
    expect(parsed.success && (parsed.data as { fields: Record<string, unknown>[] }).fields[0]).toMatchObject(camel);
  });
});

/* ── 2. TypeScript face (read by `tsc -p tsconfig.test.json` only) ──────── */

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type DeclaredKeysOf<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
type GridOwnKeys = Exclude<keyof GridFieldMetadata, keyof BaseFieldMetadata>;
/** `GridFieldMetadata`'s own members typed `undefined` alone: its `?: never` tombstones. */
type GridTombstones = { [K in GridOwnKeys]-?: Equal<GridFieldMetadata[K], undefined> extends true ? K : never }[GridOwnKeys];

/** The map's keys ARE the tombstones and its values ARE the live camelCase keys — no more, no fewer. */
export type assertionRetiredMapMatchesTheType = [
  Expect<Equal<GridFieldRetiredKey, GridTombstones>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)[GridFieldRetiredKey], Exclude<GridOwnKeys, GridTombstones | 'columns'>>>,
  // LIT CONTROL: the tombstone set is not empty, and holds no live key.
  Expect<Equal<Extract<GridTombstones, 'min_rows' | 'minRows'>, 'min_rows'>>,
];

/** Each pair, exactly. */
export type assertionRenamePairs = [
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['min_rows'], 'minRows'>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['max_rows'], 'maxRows'>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['allow_add'], 'allowAdd'>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['allow_delete'], 'allowDelete'>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['allow_reorder'], 'allowReorder'>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['total_field'], 'totalField'>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['add_label'], 'addLabel'>>,
  Expect<Equal<(typeof GRID_FIELD_RETIRED_KEYS)['sort_field'], 'sortField'>>,
];

/**
 * DELETION GUARDS on `GridFieldMetadata`, one row per tombstone. Deleting the
 * member turns its row into TS2339 (no such property), whatever the
 * `@ts-expect-error` rows below then do.
 */
export type assertionGridTombstonesStayDeclared = [
  Expect<Equal<GridFieldMetadata['min_rows'], undefined>>,
  Expect<Equal<GridFieldMetadata['max_rows'], undefined>>,
  Expect<Equal<GridFieldMetadata['allow_add'], undefined>>,
  Expect<Equal<GridFieldMetadata['allow_delete'], undefined>>,
  Expect<Equal<GridFieldMetadata['allow_reorder'], undefined>>,
  Expect<Equal<GridFieldMetadata['total_field'], undefined>>,
  Expect<Equal<GridFieldMetadata['add_label'], undefined>>,
  Expect<Equal<GridFieldMetadata['sort_field'], undefined>>,
];

/**
 * DELETION GUARDS on `FormField`, which carries an index signature: deleting a
 * tombstone there makes the member the signature's `any`, so the `Equal` row
 * fails, and the `keyof` row fails because the key is no longer DECLARED.
 */
export type assertionFormFieldTombstonesStayDeclared = [
  Expect<Equal<Extract<DeclaredKeysOf<FormField>, GridFieldRetiredKey>, GridFieldRetiredKey>>,
  Expect<Equal<FormField['min_rows'], undefined>>,
  Expect<Equal<FormField['max_rows'], undefined>>,
  Expect<Equal<FormField['allow_add'], undefined>>,
  Expect<Equal<FormField['allow_delete'], undefined>>,
  Expect<Equal<FormField['allow_reorder'], undefined>>,
  Expect<Equal<FormField['total_field'], undefined>>,
  Expect<Equal<FormField['add_label'], undefined>>,
  Expect<Equal<FormField['sort_field'], undefined>>,
];

/** The camelCase keys are live on both faces: a declared value type, not the tombstone's `undefined`. */
export type assertionCamelKeysAreLive = [
  Expect<Equal<GridFieldMetadata['minRows'], number | undefined>>,
  Expect<Equal<GridFieldMetadata['allowAdd'], boolean | undefined>>,
  Expect<Equal<GridFieldMetadata['totalField'], string | undefined>>,
  Expect<Equal<FormField['maxRows'], number | undefined>>,
  Expect<Equal<FormField['addLabel'], string | undefined>>,
  Expect<Equal<FormField['sortField'], string | undefined>>,
];

/* The refusals an author meets at the authoring site. */
const base = { type: 'grid', name: 'lines' } as const;
// @ts-expect-error objectui#11610 — `min_rows` is retired; write `minRows`.
export const gridMinRows: GridFieldMetadata = { ...base, min_rows: 1 };
// @ts-expect-error objectui#11610 — `max_rows` is retired; write `maxRows`.
export const gridMaxRows: GridFieldMetadata = { ...base, max_rows: 20 };
// @ts-expect-error objectui#11610 — `allow_add` is retired; write `allowAdd`.
export const gridAllowAdd: GridFieldMetadata = { ...base, allow_add: false };
// @ts-expect-error objectui#11610 — `allow_delete` is retired; write `allowDelete`.
export const gridAllowDelete: GridFieldMetadata = { ...base, allow_delete: false };
// @ts-expect-error objectui#11610 — `allow_reorder` is retired; write `allowReorder`.
export const gridAllowReorder: GridFieldMetadata = { ...base, allow_reorder: false };
// @ts-expect-error objectui#11610 — `total_field` is retired; write `totalField`.
export const gridTotalField: GridFieldMetadata = { ...base, total_field: 'amount' };
// @ts-expect-error objectui#11610 — `add_label` is retired; write `addLabel`.
export const gridAddLabel: GridFieldMetadata = { ...base, add_label: 'Add line' };
// @ts-expect-error objectui#11610 — `sort_field` is retired; write `sortField`.
export const gridSortField: GridFieldMetadata = { ...base, sort_field: 'position' };

// @ts-expect-error objectui#11610 — on the form-field face too: `min_rows` is retired; write `minRows`.
export const entryMinRows: FormField = { name: 'lines', type: 'grid', min_rows: 1 };
// @ts-expect-error objectui#11610 — `allow_add` is retired; write `allowAdd`.
export const entryAllowAdd: FormField = { name: 'lines', type: 'grid', allow_add: false };
// @ts-expect-error objectui#11610 — `total_field` is retired; write `totalField`.
export const entryTotalField: FormField = { name: 'lines', type: 'grid', total_field: 'amount' };
// @ts-expect-error objectui#11610 — `sort_field` is retired; write `sortField`.
export const entrySortField: FormField = { name: 'lines', type: 'grid', sort_field: 'position' };

/** LIT CONTROL for the directives above: the camelCase keys compile on both faces. */
export const gridCamel: GridFieldMetadata = {
  ...base,
  minRows: 1,
  maxRows: 20,
  allowAdd: false,
  allowDelete: false,
  allowReorder: false,
  totalField: 'amount',
  addLabel: 'Add line',
  sortField: 'position',
};
export const entryCamel: FormField = { name: 'lines', type: 'grid', minRows: 1, allowAdd: false, totalField: 'amount', sortField: 'position' };
