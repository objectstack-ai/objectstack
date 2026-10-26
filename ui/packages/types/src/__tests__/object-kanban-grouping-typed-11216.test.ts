/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11216 — `object-kanban` declares `grouping` as `@objectstack/spec`'s
 * `GroupingConfigSchema`, by reference, on both faces of this package.
 *
 * ## The defect
 *
 * `ObjectKanban` reads `grouping.fields[0].field` as the fallback for
 * `swimlaneField`, and the spec's `ComponentPropsMap['object-kanban']` row has
 * typed `grouping` as the list view's own `GroupingConfigSchema` since the
 * release this repository installs. This package's `object-kanban` arm did not
 * declare the key, so its two runtime faces and the spec gave three answers for
 * one document:
 *
 *   - the STRICT authoring face refused a well-formed `grouping` by name
 *     (`unrecognized_keys`), which is narrower than the protocol;
 *   - the tolerant face kept ANY value unjudged through `BaseSchema`'s
 *     `.passthrough()`, including the shapes the spec row refuses;
 *   - the spec row accepted the well-formed config and refused the rest.
 *
 * ## What each block below holds
 *
 *   1. a well-formed config parses on both faces and is kept as authored —
 *      the spec's `order` and `collapsed` defaults are not materialised into
 *      the document (`stripImportedDefaults`, as `object-grid` spells it);
 *   2. each shape the spec row refuses is refused on both faces, AT `grouping`,
 *      with the code the spec row gives it, and a control that differs only in
 *      the key name parses on the tolerant face — so the refusal is the
 *      declaration and not the document;
 *   3. the verdicts are the spec row's own: over one corpus, both faces accept
 *      exactly what `ComponentPropsMap['object-kanban'].shape.grouping` accepts;
 *   4. the TypeScript twin types the member as the spec row does (type-level,
 *      read by `tsc -p tsconfig.test.json` only; vitest does not typecheck).
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import type { GroupingConfig, ObjectKanbanProps as SpecObjectKanbanProps } from '@objectstack/spec/ui';
import { ObjectKanbanSchema } from '../zod/objectql.zod';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import type { ObjectKanbanSchema as TsObjectKanbanSchema } from '../objectql';

/** Compile-time truth assertion, erased at runtime — only `tsc` checks these. */
type Expect<T extends true> = T;
/** Compile-time equality, exact in both directions; `any` equals nothing but `any`. */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

/* ── 4. The TypeScript face: the member is the spec row's type ─────────────── */

export type _GroupingIsTheKanbanRows = Expect<
  Equal<TsObjectKanbanSchema['grouping'], SpecObjectKanbanProps['grouping']>
>;
/** Spelled out as well, so both faces drifting to one wrong type cannot pass. */
export type _GroupingIsTheSpecGroupingConfig = Expect<Equal<TsObjectKanbanSchema['grouping'], GroupingConfig | undefined>>;

/* ── The runtime faces ────────────────────────────────────────────────────── */

type Issue = { code: string; path: PropertyKey[]; keys?: string[]; errors?: Issue[][] };

/**
 * Every issue in the tree, union arms included, as `path` + `code`. An
 * `unrecognized_keys` issue is reported once per key, at the key itself, so a
 * refusal by name says WHICH name.
 */
const flatIssues = (issues: readonly Issue[] | undefined, prefix: PropertyKey[] = []): Array<{ path: string; code: string }> => {
  const out: Array<{ path: string; code: string }> = [];
  for (const issue of issues ?? []) {
    const at = [...prefix, ...issue.path];
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys ?? []) out.push({ path: [...at, k].map(String).join('.'), code: issue.code });
    } else {
      out.push({ path: at.map(String).join('.'), code: issue.code });
    }
    for (const arm of issue.errors ?? []) out.push(...flatIssues(arm, at));
  }
  return out;
};

const issuesOf = (schema: z.ZodType, doc: unknown) => {
  const r = schema.safeParse(doc);
  return r.success ? [] : flatIssues(r.error.issues as unknown as Issue[]);
};

const BOARD = { type: 'object-kanban', objectName: 'tasks', groupBy: 'status' } as const;

/** The fixture `structuredKeysAreDeclaredAndHonoured-8313` row 4 authors. */
const WELL_FORMED = { fields: [{ field: 'owner' }] };

const FACES = [
  ['the tolerant arm (ObjectKanbanSchema)', ObjectKanbanSchema],
  ['the tolerant union (AnyComponentSchema)', AnyComponentSchema],
  ['the strict authoring face (StrictAnyComponentSchema)', StrictAnyComponentSchema],
] as const;

/**
 * The shapes the card names as the spec row's refusals, each with the path and
 * code the spec row gives it (measured on the installed release, below in
 * block 3, rather than copied from its source).
 */
const REFUSED = [
  ['a padded field name', { fields: [{ field: '  x  ' }] }, 'grouping.fields.0.field', 'custom'],
  ['a bare string', 'owner', 'grouping', 'invalid_type'],
  ['an empty `fields` list', { fields: [] }, 'grouping.fields', 'too_small'],
  ['an undeclared key on the config', { fields: [{ field: 'owner' }], bogus11216: 1 }, 'grouping.bogus11216', 'unrecognized_keys'],
  ['an undeclared key on a field entry', { fields: [{ field: 'owner', bogus11216: 1 }] }, 'grouping.fields.0.bogus11216', 'unrecognized_keys'],
] as const;

describe('object-kanban grouping — a well-formed config parses (objectui#11216)', () => {
  it.each(FACES)('%s accepts { fields: [{ field }] }', (_label, schema) => {
    expect(issuesOf(schema, { ...BOARD, grouping: WELL_FORMED })).toEqual([]);
  });

  it.each(FACES)('%s accepts every member the spec declares (`field`, `order`, `collapsed`) on two entries', (_label, schema) => {
    const grouping = { fields: [{ field: 'owner', order: 'desc', collapsed: true }, { field: 'region' }] };
    expect(issuesOf(schema, { ...BOARD, grouping })).toEqual([]);
  });

  it('the parsed document keeps the config AS AUTHORED: the spec defaults are not materialised', () => {
    const r = ObjectKanbanSchema.safeParse({ ...BOARD, grouping: WELL_FORMED });
    expect(r.success && (r.data as Record<string, unknown>).grouping).toEqual(WELL_FORMED);
  });

  it('CONTROL — the strict face still refuses a misspelled sibling by name, so it did not open up', () => {
    expect(issuesOf(StrictAnyComponentSchema, { ...BOARD, grouping: WELL_FORMED, groupingx: WELL_FORMED }))
      .toEqual([{ path: 'groupingx', code: 'unrecognized_keys' }]);
  });
});

describe('object-kanban grouping — the spec row refusals hold on both faces (objectui#11216)', () => {
  const ROWS = FACES.flatMap(([label, schema]) => REFUSED.map(([what, value, path, code]) => [label, what, schema, value, path, code] as const));

  it.each(ROWS)('%s refuses %s, at the key', (_label, _what, schema, value, path, code) => {
    expect(issuesOf(schema, { ...BOARD, grouping: value })).toContainEqual({ path, code });
  });

  it.each(REFUSED)('CONTROL — %s under an undeclared key is kept by the tolerant arm, so the refusal is the declaration', (_what, value) => {
    expect(issuesOf(ObjectKanbanSchema, { ...BOARD, groupingUndeclared11216: value })).toEqual([]);
  });
});

describe('object-kanban grouping — the verdicts are the spec row\'s own (objectui#11216)', () => {
  const specRow = (ComponentPropsMap['object-kanban'] as unknown as z.ZodObject<Record<string, z.ZodType>>).shape.grouping;

  const CORPUS: ReadonlyArray<readonly [string, unknown]> = [
    ['well-formed', WELL_FORMED],
    ['all members, two entries', { fields: [{ field: 'owner', order: 'asc', collapsed: false }, { field: 'region', order: 'desc' }] }],
    ...REFUSED.map(([what, value]) => [what, value] as const),
    ['a bad `order`', { fields: [{ field: 'owner', order: 'up' }] }],
    ['a non-boolean `collapsed`', { fields: [{ field: 'owner', collapsed: 'yes' }] }],
    ['a field entry with no `field`', { fields: [{ order: 'asc' }] }],
    ['an array instead of the config', [{ field: 'owner' }]],
  ];

  it('the spec row is typed (non-vacuity: it refuses a bare string)', () => {
    expect(specRow).toBeDefined();
    expect(specRow.safeParse('owner').success).toBe(false);
  });

  it.each(CORPUS)('%s: both faces return the spec row\'s verdict', (_what, value) => {
    const spec = specRow.safeParse(value).success;
    expect(ObjectKanbanSchema.safeParse({ ...BOARD, grouping: value }).success).toBe(spec);
    expect(StrictAnyComponentSchema.safeParse({ ...BOARD, grouping: value }).success).toBe(spec);
  });
});
