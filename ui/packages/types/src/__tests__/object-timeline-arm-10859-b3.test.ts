/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-timeline` has a zod arm in `AnyComponentSchema` (objectui#10859,
 * batch 3).
 *
 * ## The defect this pins
 *
 * `object-timeline` is registered (`@object-ui/plugin-timeline`), curated by
 * ADR-0080 as a public block (`PUBLIC_BLOCKS` in `@object-ui/core`), and since
 * `@objectstack/spec` 17.5.0 declared by the spec's
 * `ComponentPropsMap['object-timeline']` row — and `AnyComponentSchema` carried
 * no arm for it, so `safeValidateSchema`, and `objectui validate` with it,
 * refused every document naming it with `invalid_union` at `type`.
 *
 * The arm is built the way batch 2 built `object-metric` and
 * `object-master-detail-form` (route A: a spec `ComponentPropsMap` row counts
 * as a published declaration, and `properties` is judged by reference), so this
 * file holds the same things `registered-type-arms-10859-b2.test.ts` holds for
 * those two, plus what differs here: the node's `dataSource` binding, and a row
 * that carries spec defaults the import boundary has to strip.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` block below is TYPE-level: `tsc -p tsconfig.test.json`
 * (the third leg of this package's `type-check` script) reads it, and vitest —
 * which strips types — does not. The `describe` blocks are RUNTIME and vitest
 * reads them. A green run of either one alone says nothing about the other.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ElementDataSourceSchema as SpecElementDataSourceSchema,
  ObjectTimelinePropsSchema as SpecObjectTimelinePropsSchema,
  type ObjectTimelineProps as SpecObjectTimelineProps,
} from '@objectstack/spec/ui';

import {
  ObjectQLPublicBlockComponentSchema,
  ObjectTimelineBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

/* ── Type-level parity: the `tsc` channel ────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The arm's own shape. */
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;

/**
 * The bag accepts exactly the spec's published props type (absent allowed),
 * the node's binding accepts exactly the spec's element binding, and neither
 * content channel accepts anything.
 */
export type assertionTimelineArmIsTheRow = [
  Expect<Equal<InputOf<ShapeOf<typeof ObjectTimelineBlockSchema>['properties']>, SpecObjectTimelineProps | undefined>>,
  Expect<
    Equal<
      InputOf<ShapeOf<typeof ObjectTimelineBlockSchema>['dataSource']>,
      z.input<typeof SpecElementDataSourceSchema> | undefined
    >
  >,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectTimelineBlockSchema>['children']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectTimelineBlockSchema>['body']>, undefined>>,
];

/** Non-vacuity: a bag narrower than the spec's props type is not Equal to it. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<{ objectName?: string } | undefined, SpecObjectTimelineProps | undefined>, false>>,
];

/* ── Runtime: the documents that were refused ────────────────────────────── */

/**
 * A spec-shaped document using most of the row: the object, the nested
 * `timeline` config, a filter, a sort, a window, a layout and a navigation
 * mode. Its lit control is the spec's own row, below.
 */
const SPEC_SHAPED = {
  type: 'object-timeline',
  properties: {
    objectName: 'project_task',
    timeline: { startDateField: 'start_date', endDateField: 'due_date', titleField: 'name', groupByField: 'status' },
    filter: [{ field: 'status', operator: 'not_equals', value: 'done' }],
    sort: [{ field: 'start_date', order: 'asc' }],
    limit: 50,
    variant: 'horizontal',
    dateFormat: 'short',
    descriptionField: 'summary',
    navigation: { mode: 'drawer' },
  },
};

/** The same block bound through the node's `dataSource`, the spec's per-element binding. */
const BOUND = {
  type: 'object-timeline',
  dataSource: { object: 'project_task', filter: [{ field: 'owner', operator: 'equals', value: 'ada' }], limit: 20 },
  properties: { timeline: { startDateField: 'start_date', titleField: 'name' } },
};

/** The first issue of a refused parse, or a message that says it was not refused. */
function firstIssue(result: ReturnType<typeof safeValidateSchema>) {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error.issues[0];
}

describe('object-timeline validates (objectui#10859 batch 3)', () => {
  it.each([
    ['the bare node', { type: 'object-timeline' }],
    ['a spec-shaped bag', SPEC_SHAPED],
    ['a node bound through `dataSource`', BOUND],
  ] as const)('%s is accepted by safeValidateSchema and by the strict authoring face', (_label, doc) => {
    const tolerant = safeValidateSchema(doc);
    expect(tolerant.success, JSON.stringify(tolerant.success ? null : tolerant.error.issues)).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
  });

  it('the spec-shaped fixture is spec-valid by the spec\'s own row (lit control)', () => {
    expect(SpecObjectTimelinePropsSchema.safeParse(SPEC_SHAPED.properties).success).toBe(true);
    expect(SpecElementDataSourceSchema.safeParse(BOUND.dataSource).success).toBe(true);
  });

  it('reaches the arm at a child slot too — a page holding the block', () => {
    const page = { type: 'page', children: [SPEC_SHAPED, BOUND] };
    expect(safeValidateSchema(page).success).toBe(true);
  });

  it('authors no default into the document: the row\'s `timeline.scale` default is stripped (objectui#8317)', () => {
    const doc = { type: 'object-timeline', properties: { timeline: { startDateField: 's', titleField: 't' } } };
    // Control: the spec's own row writes a default `scale` into its output.
    const specOut = SpecObjectTimelinePropsSchema.parse(doc.properties) as { timeline: Record<string, unknown> };
    expect(specOut.timeline.scale).toBeDefined();
    // This face validates and writes nothing.
    const result = safeValidateSchema(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const out = result.data as unknown as { properties: { timeline: Record<string, unknown> } };
    expect(Object.keys(out.properties.timeline).sort()).toEqual(['startDateField', 'titleField']);
  });
});

describe('the object-timeline arm is closed where its declaration is (objectui#10859 batch 3)', () => {
  it('an undeclared node key is refused on the strict face, by name — the strictness control', () => {
    const doc = { type: 'object-timeline', inventedKey10859b3: true };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, JSON.stringify(strict.error.issues)).toBeDefined();
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey10859b3']);
    // The rendering face keeps its `.passthrough()`, as on every other arm.
    expect(safeValidateSchema(doc).success).toBe(true);
  });

  it.each([
    ['an invented key', 'inventedKey10859b3'],
    // The row leaves the flat field spellings beside `timeline` out on purpose
    // (the spec's record for the row: the runtime handoff `ListView` composes,
    // not a second authoring spelling), so the bag refuses one by name.
    ['a flat field spelling the row leaves out', 'titleField'],
  ] as const)('%s inside the bag is refused on the TOLERANT face, by name', (_label, key) => {
    const doc = { type: 'object-timeline', properties: { objectName: 'task', [key]: 'name' } };
    const issue = firstIssue(safeValidateSchema(doc));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual([key]);
  });

  it.each([
    ['variant', { variant: 'grid' }, ['properties', 'variant'], 'invalid_value'],
    ['dateFormat', { dateFormat: 'relative' }, ['properties', 'dateFormat'], 'invalid_value'],
    ['limit', { limit: '50' }, ['properties', 'limit'], 'invalid_type'],
    ['timeline.titleField', { timeline: { startDateField: 's' } }, ['properties', 'timeline', 'titleField'], 'invalid_type'],
  ] as const)('a spec-invalid `%s` is refused at that member', (_key, bag, path, code) => {
    const issue = firstIssue(safeValidateSchema({ type: 'object-timeline', properties: bag }));
    expect(issue.code).toBe(code);
    expect(issue.path).toEqual(path);
  });

  it('`dataSource` is judged as the spec binding on both faces, and a misspelling beside it is refused by name', () => {
    const adapterShaped = { type: 'object-timeline', dataSource: 'objectstack' };
    expect(safeValidateSchema(adapterShaped).success).toBe(false);
    expect(StrictAnyComponentSchema.safeParse(adapterShaped).success).toBe(false);
    const misspelt = { ...BOUND, dataSourc: BOUND.dataSource };
    const strict = StrictAnyComponentSchema.safeParse(misspelt);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['dataSourc']);
  });

  it.each(['body', 'children'] as const)('refuses the `%s` content channel by name (objectui#9256)', (key) => {
    const issue = firstIssue(safeValidateSchema({ type: 'object-timeline', [key]: [{ type: 'text', content: 'x' }] }));
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('`object-timeline`');
  });
});

describe('the object-timeline arm reads the row by reference (objectui#10859 batch 3)', () => {
  it('the bag is the spec row, through the import boundary', () => {
    const bag = ObjectTimelineBlockSchema.shape.properties.unwrap();
    const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    // The same members, read off the installed spec on every run — not a
    // transcribed list that could drift from it.
    expect(keysOf(bag)).toEqual(keysOf(SpecObjectTimelinePropsSchema));
    expect(keysOf(bag).length).toBeGreaterThan(10);
    // The row carries spec defaults, so the boundary hands back a rebuilt copy
    // rather than the export itself — and that copy accepts exactly what the
    // spec's row accepts.
    for (const probe of [
      {},
      { objectName: 'order' },
      { inventedKey10859b3: 1 },
      { objectName: 7 },
      { variant: 'gantt', items: [] },
      { timeline: { startDateField: 's', titleField: 't', scale: 'week' } },
      { timeline: { startDateField: 's', titleField: 't', scale: 'decade' } },
      { navigation: { mode: 'drawer', width: 480 } },
    ]) {
      expect(bag.safeParse(probe).success, JSON.stringify(probe)).toBe(SpecObjectTimelinePropsSchema.safeParse(probe).success);
    }
  });

  it('is reachable from AnyComponentSchema through its category union', () => {
    const literals = ObjectQLPublicBlockComponentSchema.options.map((arm) => arm.shape.type.value);
    expect(literals).toContain('object-timeline');
  });
});
