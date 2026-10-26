/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A padded grouping field name is refused by every objectui validation face
 * that declares `grouping`, before any renderer is handed it (objectui#7347).
 *
 * ## The defect, and why the fix is not in this repository
 *
 * `grouping.fields[].field` has two readers that used to disagree about
 * whitespace. `collectGroupingFieldRefs` (`@object-ui/core`) trims the name
 * before it reaches `$select`; the grid, gallery and kanban renderers look the
 * RAW name up on every row. A view grouped by `'  business_unit  '` therefore
 * asked the server for `business_unit` and then read a key no row carried: one
 * `(empty)` group (or one `Uncategorized` lane) holding every record, no error,
 * no warning. It read as a true statement about the data.
 *
 * Ruling C on objectui#7347 (batch #110 item 5) put the fix at the PRODUCER:
 * `@objectstack/spec`'s `GroupingFieldSchema.field` refuses a padded name
 * (objectstack-ai/objectstack#17360, released in the spec version this
 * repository's lockfile resolves) — a refusal, ⛔ not a `.trim()`, which would
 * have made the two spellings silently equal. The same ruling kept the
 * harvester's trim as defence and refused per-reader normalization in grid,
 * gallery and kanban. So this repository's half is not code: it is this pin,
 * holding that the producer's refusal actually reaches objectui's faces.
 *
 * ## What could lose it on the way in
 *
 * The refusal is a `superRefine` installed on the spec's `field` string. Every
 * objectui face that declares `grouping` imports it BY REFERENCE through
 * `stripImportedDefaults` (`../zod/imported-defaults.ts`), which clones and
 * rebuilds imported nodes to remove their defaults. A rebuild that dropped a
 * node's `def.checks` would keep the shape and silently lose the refusal —
 * the class that module's own docblock warns about. Nothing but a parse can
 * tell the two apart, so each face is parsed below, on both sides of the line:
 * the unpadded control must parse green (the fixture is otherwise valid), and
 * each padded spelling must fail with exactly ONE issue, a `custom` issue at
 * the entry's `field`. The message is the spec's text and is ⛔ not pinned
 * here; code and path are.
 *
 * ## Which faces — derived, not listed
 *
 * The set of union arms that declare `grouping` is read off
 * `AnyComponentSchema` by the census at the foot of this file, and must equal
 * the fixture table's keys. An arm that starts declaring `grouping` turns the
 * census red until it gets a row here — so the pin cannot quietly stop
 * covering a face.
 *
 * ⚠️ The census counts DECLARED `grouping` only. A node whose mirror does not
 * declare the key is outside this pin: the tolerant face passes an undeclared
 * key through unjudged (`BaseSchema` is `.passthrough()`), and the strict face
 * refuses it by name. Which nodes those are is re-derived by the parity
 * ledger's `UnmirroredDeclared` entries in `zod-mirror-parity.test.ts`, not
 * written here.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { GroupingFieldSchema as SpecGroupingFieldSchema } from '@objectstack/spec/ui';
import {
  AnyComponentSchema,
  ListViewBlockSchema,
  ObjectGridBlockSchema,
  ObjectGallerySchema,
  ObjectKanbanSchema,
  ObjectViewSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import { internals, isZodType, type WalkableDef } from '../zod/node-derivation.js';

type Issue = { code: string; path: PropertyKey[] };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };

const issuesOf = (r: Parsed): readonly Issue[] => (r.success ? [] : r.error!.issues);
const codeAndPath = (r: Parsed) => issuesOf(r).map((i) => ({ code: i.code, path: i.path }));

const CLEAN = 'business_unit';
/** Both sides (the card's own spelling), then each side alone. */
const PADDED = ['  business_unit  ', ' business_unit', 'business_unit '] as const;

type Entry = { field: string };

interface DeclaringArm {
  /**
   * The component `type` of the arm, when the row's key is not that type: one arm
   * can declare `grouping` at more than one path, and each path is its own row.
   */
  readonly type?: string;
  /** Where the census finds `grouping` on this arm, `*` standing for a record key. */
  readonly declaredAt: string;
  /** The exported mirror, parsed directly as well as through the union. */
  readonly arm: z.ZodType;
  /** An otherwise-valid document carrying `fields` as its grouping entries. */
  readonly doc: (fields: readonly Entry[]) => Record<string, unknown>;
  /** The path of entry `index`'s `field`. */
  readonly fieldPath: (index: number) => PropertyKey[];
}

const DECLARING: Readonly<Record<string, DeclaringArm>> = {
  // objectui#12670: the authored page `list-view` is armed by `ListViewBlockSchema`,
  // whose bag holds the flat `ListViewSchema` mirror's own `grouping` member by
  // reference; the mirror stays the `ListView` component's props, off the union.
  'list-view properties': {
    type: 'list-view',
    declaredAt: 'properties.grouping',
    arm: ListViewBlockSchema,
    doc: (fields) => ({ type: 'list-view', properties: { data: { provider: 'object', object: 'account' }, grouping: { fields } } }),
    fieldPath: (i) => ['properties', 'grouping', 'fields', i, 'field'],
  },
  'object-gallery': {
    declaredAt: 'grouping',
    arm: ObjectGallerySchema,
    doc: (fields) => ({ type: 'object-gallery', objectName: 'account', grouping: { fields } }),
    fieldPath: (i) => ['grouping', 'fields', i, 'field'],
  },
  'object-view': {
    declaredAt: 'listViews.*.grouping',
    arm: ObjectViewSchema,
    doc: (fields) => ({
      type: 'object-view',
      objectName: 'account',
      listViews: { all: { label: 'All', columns: ['name', CLEAN], grouping: { fields } } },
    }),
    fieldPath: (i) => ['listViews', 'all', 'grouping', 'fields', i, 'field'],
  },
  // objectui#6152 round 6: the `object-view` `table` slot is built from the flat
  // `ObjectGridSchema` mirror, which now declares `grouping` as the spec's
  // `GroupingConfigSchema` by reference, so the slot judges it — the second
  // path on that arm, and `ObjectView` hands it to the grid it draws.
  'object-view table': {
    type: 'object-view',
    declaredAt: 'table.grouping',
    arm: ObjectViewSchema,
    doc: (fields) => ({ type: 'object-view', objectName: 'account', table: { grouping: { fields } } }),
    fieldPath: (i) => ['table', 'grouping', 'fields', i, 'field'],
  },
  // `@objectstack/spec` 17.6.0 types `ComponentPropsMap['object-grid'].grouping` as
  // the grouping config instead of `z.unknown()`, and the authored arm's `properties`
  // is that row by reference, so the bag now judges the shape: a padded name is
  // refused at its entry on every face. It moved here from `NOT_COVERED` at that
  // bump (objectui#11438), when the row below stopped holding.
  'object-grid properties': {
    type: 'object-grid',
    declaredAt: 'properties.grouping',
    arm: ObjectGridBlockSchema,
    doc: (fields) => ({ type: 'object-grid', properties: { objectName: 'account', grouping: { fields } } }),
    fieldPath: (i) => ['properties', 'grouping', 'fields', i, 'field'],
  },
  // objectui#11216: the `object-kanban` arm declares `grouping` (the fallback
  // `ObjectKanban` reads for `swimlaneField`) as the spec's
  // `GroupingConfigSchema` by reference, the type its spec row gives the key.
  'object-kanban': {
    declaredAt: 'grouping',
    arm: ObjectKanbanSchema,
    doc: (fields) => ({ type: 'object-kanban', objectName: 'account', groupBy: 'status', grouping: { fields } }),
    fieldPath: (i) => ['grouping', 'fields', i, 'field'],
  },
};

/**
 * Arms the census finds naming `grouping` that this pin does NOT cover, each
 * with the reason and the paths the census records — so an arm cannot slip in
 * here silently, and a reason that stops holding turns the rows below red.
 *
 * `object-grid` (objectui#11276's `object-grid` batch): the node-level `grouping`
 * is no declaration at all: it is the flat spelling's by-name refusal
 * (`flatPropRefusals`), pointing at `properties.grouping`. The bag member
 * `properties.grouping` stood here too while the spec row typed it `z.unknown()`;
 * since `@objectstack/spec` 17.6.0 the row judges it, so it is a `DECLARING` row
 * above (objectui#11438). The page `list-view` (objectui#12670) is the same shape.
 */
const NOT_COVERED: Readonly<Record<string, readonly string[]>> = {
  'object-grid': ['grouping'],
  // objectui#12670: the same on the page `list-view` — the node-level `grouping` is
  // the flat spelling's by-name refusal, pointing at `properties.grouping`.
  'list-view': ['grouping'],
};

/** The faces an authored document meets. `objectui validate` runs the strict one. */
const facesFor = (arm: z.ZodType): ReadonlyArray<readonly [string, (doc: unknown) => Parsed]> => [
  ['the tolerant face (`AnyComponentSchema`)', (d) => AnyComponentSchema.safeParse(d)],
  ['`safeValidateSchema` (the tolerant parse)', (d) => safeValidateSchema(d)],
  ['the strict face (`StrictAnyComponentSchema`)', (d) => StrictAnyComponentSchema.safeParse(d)],
  ['the exported mirror, parsed directly', (d) => arm.safeParse(d)],
];

/* ── The producer ───────────────────────────────────────────────────────── */

describe('objectui#7347 — the producer: the installed spec refuses a padded grouping field name', () => {
  it('`GroupingFieldSchema` answers a `custom` issue at `field` for each padded spelling, and parses the unpadded control', () => {
    expect(codeAndPath(SpecGroupingFieldSchema.safeParse({ field: CLEAN }))).toEqual([]);
    for (const padded of PADDED) {
      expect(codeAndPath(SpecGroupingFieldSchema.safeParse({ field: padded })), JSON.stringify(padded))
        .toEqual([{ code: 'custom', path: ['field'] }]);
    }
  });
});

/* ── Every objectui face that declares `grouping` ───────────────────────── */

describe.each(Object.entries(DECLARING))('objectui#7347 — `%s` carries the refusal on every face', (_type, spec) => {
  describe.each(facesFor(spec.arm))('%s', (_face, parse) => {
    it('CONTROL: the unpadded name parses green, so the fixture is otherwise valid', () => {
      const r = parse(spec.doc([{ field: CLEAN }]));
      expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
    });

    it.each(PADDED)('refuses %j with exactly one `custom` issue at the entry\'s `field`', (padded) => {
      expect(codeAndPath(parse(spec.doc([{ field: padded }]))))
        .toEqual([{ code: 'custom', path: spec.fieldPath(0) }]);
    });

    it('judges each entry: a padded name after a clean one is refused at ITS index', () => {
      expect(codeAndPath(parse(spec.doc([{ field: 'region' }, { field: PADDED[0] }]))))
        .toEqual([{ code: 'custom', path: spec.fieldPath(1) }]);
    });
  });
});

/* ── The census: which arms declare `grouping` ──────────────────────────── */

type DefWithValues = WalkableDef & { values?: readonly unknown[] };
const defOf = (s: z.ZodType): DefWithValues => internals(s)._zod.def as DefWithValues;

/** Peel `lazy` and `pipe` wrappers down to the node that carries a shape. */
const peel = (s: z.ZodType): z.ZodType => {
  let cur = s;
  for (;;) {
    const d = defOf(cur);
    if (d.type === 'lazy' && d.getter) cur = d.getter();
    else if (d.type === 'pipe' && d.in) cur = d.in;
    else return cur;
  }
};

/** A component arm: an object whose `type` member is a literal. */
const componentTypeOf = (s: z.ZodType): string | undefined => {
  const d = defOf(peel(s));
  if (d.type !== 'object' || !d.shape?.type) return undefined;
  const t = defOf(peel(d.shape.type));
  return t.type === 'literal' && typeof t.values?.[0] === 'string' ? t.values[0] : undefined;
};

/** Every arm of the union, nested unions flattened. */
const armsOf = (union: z.ZodType): z.ZodType[] => {
  const d = defOf(peel(union));
  return d.type === 'union' ? (d.options ?? []).flatMap(armsOf) : [peel(union)];
};

/**
 * Where an arm declares `grouping` in its OWN document. The walk stops at a
 * nested component arm (a child slot holding another node): that node's own
 * arm answers for it, and following it would credit every container with the
 * grouping of whatever it may hold.
 */
const groupingDeclaredAt = (arm: z.ZodType): string[] => {
  const seen = new Set<z.ZodType>();
  const hits = new Set<string>();
  const walk = (node: unknown, path: readonly string[]): void => {
    if (!isZodType(node) || seen.has(node)) return;
    seen.add(node);
    const d = defOf(node);
    if (node !== arm && d.type === 'object' && componentTypeOf(node) !== undefined) return;
    switch (d.type) {
      case 'object':
        for (const [key, value] of Object.entries(d.shape ?? {})) {
          if (key === 'grouping') hits.add([...path, key].join('.'));
          walk(value, [...path, key]);
        }
        return;
      case 'optional': case 'nullable': case 'nonoptional': case 'readonly': case 'catch': case 'default': case 'prefault':
        return walk(d.innerType, path);
      case 'array': return walk(d.element, [...path, '[]']);
      case 'record': return walk(d.valueType, [...path, '*']);
      case 'union': for (const o of d.options ?? []) walk(o, path); return;
      case 'intersection': walk(d.left, path); walk(d.right, path); return;
      case 'tuple': for (const it of d.items ?? []) walk(it, [...path, '()']); return;
      case 'lazy': return walk(d.getter?.(), path);
      case 'pipe': walk(d.in, path); walk(d.out, path); return;
      default: return;
    }
  };
  walk(arm, []);
  return [...hits].sort();
};

describe('objectui#7347 — census: the table above is every arm that declares `grouping`', () => {
  it('the arms of `AnyComponentSchema` declaring `grouping` are exactly the fixture table\'s keys, at the recorded paths', () => {
    const found: Record<string, string[]> = {};
    for (const arm of armsOf(AnyComponentSchema)) {
      const at = groupingDeclaredAt(arm);
      // An arm with no literal `type` is recorded under `?` rather than skipped:
      // skipping it would be a silent hole in the census.
      if (at.length) found[componentTypeOf(arm) ?? '?'] = at;
    }
    const expected: Record<string, string[]> = Object.fromEntries(Object.entries(NOT_COVERED).map(([type, paths]) => [type, [...paths]]));
    for (const [key, spec] of Object.entries(DECLARING)) (expected[spec.type ?? key] ??= []).push(spec.declaredAt);
    for (const type of Object.keys(expected)) expected[type] = [...expected[type]].sort();
    expect(found).toEqual(expected);
  });

  it('`object-grid` node-level `grouping` is not covered for the recorded reason: a flat refusal on the node', () => {
    const node = { type: 'object-grid', properties: { objectName: 'account' }, grouping: { fields: [{ field: CLEAN, order: 'asc' }] } };
    // On the node, every value is refused by name, toward the bag member.
    const flat = issuesOf(safeValidateSchema(node));
    expect(flat.map((i) => i.path.join('.'))).toEqual(['grouping']);
  });
});
