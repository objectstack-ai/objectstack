/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 6 — the ten `ObjectGridSchema` keys this round MIRRORED.
 *
 * Each key is read by `ObjectGrid` and is a member of the spec's
 * `ComponentPropsMap['object-grid']` row. The flat mirror is the node `ObjectGrid`
 * reads after `SchemaRenderer` hoists the authored `properties` bag (objectui#11276),
 * and it is the source of the `object-view` `table` slot. So the move is visible on
 * two doors:
 *
 *   - the mirror itself judges each value instead of keeping it unexamined
 *     (`BaseSchema` is `.passthrough()`);
 *   - an `object-view`'s `table` slot, which `ObjectView` relays to the grid it draws,
 *     now accepts each of the nine slot keys on the strict face (it refused them as
 *     unknown keys while the TypeScript slot typed them) and refuses a wrongly typed
 *     value on the tolerant face (it kept one before).
 *
 * The authored `object-grid` node does not move: its bag is the spec row by
 * reference, and a prop written flat on the node stays refused by name.
 *
 * `resizableColumns`, the eleventh key, was NOT mirrored: its route was open on the
 * card until round 7 RETIRED it. It is a member of the mirror since then, as a
 * retirement tombstone that refuses every value, and `zod-mirror-parity.test.ts`
 * no longer ledgers it (`unmirrored-declared-round7-6152.test.ts` pins the rest).
 */
import { describe, it, expect } from 'vitest';

import {
  GroupingConfigSchema as SpecGroupingConfigSchema,
  ObjectGridPropsSchema as SpecObjectGridPropsSchema,
} from '@objectstack/spec/ui';
import { ListViewSchema, ObjectGridSchema } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[] };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };
type Parse = (doc: unknown) => Parsed;

const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path })));

/** Each mirrored key, a value the twin declares, and a value it does not. */
const MIRRORED: ReadonlyArray<{ key: string; valid: unknown; invalid: unknown; slot: boolean }> = [
  { key: 'aggregations', valid: [{ field: 'amount', type: 'count_distinct' }], invalid: [{ field: 'amount', type: 'median' }], slot: true },
  {
    key: 'bulkActionDefs',
    valid: [{ name: 'close', operation: 'update', patch: { status: 'closed' }, params: [{ name: 'note', type: 'textarea' }] }],
    invalid: [{ name: 'close', operation: 'archive' }],
    slot: true,
  },
  {
    key: 'conditionalFormatting',
    // One rule dialect since objectui#11533, the spec list view's `{ condition, style }`:
    // the native `{ field, operator, value }` row this used to carry is refused by name
    // now (`grid-list-view-conditional-formatting-11533.test.ts`), and its wrong value —
    // an operator outside the native enum — has no member left to be wrong in. The
    // wrong value is a `style` written as a CSS string instead of a map.
    valid: [{ condition: "record.status == 'open'", style: { backgroundColor: '#fee2e2' } }, { condition: "record.status == 'late'", style: { color: 'red' } }],
    invalid: [{ condition: "record.status == 'late'", style: 'color: red' }],
    slot: true,
  },
  { key: 'grouping', valid: { fields: [{ field: 'region' }] }, invalid: { fields: [] }, slot: true },
  { key: 'navigation', valid: { mode: 'drawer' }, invalid: { mode: 'sideways' }, slot: false },
  { key: 'operations', valid: { create: false, export: false }, invalid: { creat: false }, slot: true },
  { key: 'reorderableColumns', valid: true, invalid: 'yes', slot: true },
  { key: 'rowColor', valid: { field: 'status', colors: { open: 'bg-green-200' } }, invalid: 42, slot: true },
  { key: 'rowHeight', valid: 'extra_tall', invalid: 'comfortable', slot: true },
  { key: 'singleClickEdit', valid: false, invalid: 'no', slot: true },
];

const GRID = { type: 'object-grid', objectName: 'task' };
const VIEW = { type: 'object-view', objectName: 'task' };

const FACES: ReadonlyArray<readonly [string, Parse]> = [
  ['the tolerant face', (d) => AnyComponentSchema.safeParse(d)],
  ['the strict face', (d) => StrictAnyComponentSchema.safeParse(d)],
];

describe('objectui#6152 round 6 — the flat `ObjectGridSchema` mirror judges ten members it never declared', () => {
  it('CONTROL: the minimal node parses, so a refusal below is the key\'s', () => {
    expect(ObjectGridSchema.safeParse(GRID).success).toBe(true);
  });

  it.each(MIRRORED)('`$key` is a member: a declared value parses, a wrong one is refused at the key', ({ key, valid, invalid }) => {
    expect(key in ObjectGridSchema.shape).toBe(true);
    const ok = ObjectGridSchema.safeParse({ ...GRID, [key]: valid });
    expect(ok.success, JSON.stringify(codeAndPath(ok))).toBe(true);
    const refused = codeAndPath(ObjectGridSchema.safeParse({ ...GRID, [key]: invalid }));
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((i) => i.path[0] === key), JSON.stringify(refused)).toBe(true);
  });

  it('`resizableColumns` was not mirrored but RETIRED (round 7): a member that refuses every value', () => {
    // Flipped by objectui#6152 round 7. This read `false` while the key's route was
    // open; the retirement made it a tombstone member, which is what a passthrough
    // mirror needs to refuse the key instead of keeping it unexamined.
    expect('resizableColumns' in ObjectGridSchema.shape).toBe(true);
    for (const value of [true, false]) {
      expect(codeAndPath(ObjectGridSchema.safeParse({ ...GRID, resizableColumns: value })))
        .toEqual([{ code: 'invalid_type', path: ['resizableColumns'] }]);
    }
  });

  it('the members the twin takes from the spec by name are the spec\'s, by reference', () => {
    // The row's own boolean members carry no default, so the import boundary hands
    // them back unchanged.
    expect(ObjectGridSchema.shape.reorderableColumns).toBe(SpecObjectGridPropsSchema.shape.reorderableColumns);
    expect(ObjectGridSchema.shape.singleClickEdit).toBe(SpecObjectGridPropsSchema.shape.singleClickEdit);
    // `GroupingConfigSchema` carries a default (`order`), so the boundary rebuilds
    // it; what travels is the spec's own rule — a padded field name is refused.
    expect(codeAndPath(SpecGroupingConfigSchema.safeParse({ fields: [{ field: ' region ' }] }))).toEqual([
      { code: 'custom', path: ['fields', 0, 'field'] },
    ]);
    expect(codeAndPath(ObjectGridSchema.safeParse({ ...GRID, grouping: { fields: [{ field: ' region ' }] } }))).toEqual([
      { code: 'custom', path: ['grouping', 'fields', 0, 'field'] },
    ]);
  });

  it('`conditionalFormatting` is one rule declaration, shared with the list view\'s mirror', () => {
    expect(ObjectGridSchema.shape.conditionalFormatting.unwrap().element)
      .toBe(ListViewSchema.shape.conditionalFormatting.unwrap().element);
  });

  it('`operations`, `aggregations` and a `bulkActionDefs` entry name an unknown member', () => {
    expect(codeAndPath(ObjectGridSchema.safeParse({ ...GRID, operations: { creat: false } })))
      .toEqual([{ code: 'unrecognized_keys', path: ['operations'] }]);
    expect(codeAndPath(ObjectGridSchema.safeParse({ ...GRID, aggregations: [{ field: 'amount', type: 'sum', label: 'Total' }] })))
      .toEqual([{ code: 'unrecognized_keys', path: ['aggregations', 0] }]);
    expect(codeAndPath(ObjectGridSchema.safeParse({ ...GRID, bulkActionDefs: [{ name: 'close', operation: 'update', colour: 'red' }] })))
      .toEqual([{ code: 'unrecognized_keys', path: ['bulkActionDefs', 0] }]);
  });

  it('a `bulkActionDefs` param keeps widget configuration, as its twin\'s catch-all declares', () => {
    // `BulkActionParam` forwards extra keys to the field widget as-is, so the mirror
    // entry is loose. (The strict face closes every undeclared key at every depth by
    // its own construction; that is its rule, not this member's.)
    const r = ObjectGridSchema.safeParse({ ...GRID, bulkActionDefs: [{ name: 'close', operation: 'update', params: [{ name: 'note', type: 'textarea', rows: 3 }] }] });
    expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
  });

  it('a `bulkActionDefs` entry takes both predicate spellings its twin declares for `visible`', () => {
    for (const visible of ["record.status == 'open'", { source: "record.status == 'open'" }, { dialect: 'cel', source: 'true' }]) {
      const r = ObjectGridSchema.safeParse({ ...GRID, bulkActionDefs: [{ name: 'close', operation: 'custom', visible }] });
      expect(r.success, JSON.stringify(visible)).toBe(true);
    }
  });
});

describe('objectui#6152 round 6 — the `object-view` `table` slot follows the mirror', () => {
  const SLOT = MIRRORED.filter((m) => m.slot);

  describe.each(FACES)('%s', (_face, parse) => {
    it('CONTROL: a view with a plain table parses', () => {
      expect(parse({ ...VIEW, table: { columns: ['subject'] } }).success).toBe(true);
    });

    it.each(SLOT)('`table.$key`: a declared value parses, a wrong one is refused inside the slot', ({ key, valid, invalid }) => {
      const ok = parse({ ...VIEW, table: { [key]: valid } });
      expect(ok.success, JSON.stringify(codeAndPath(ok))).toBe(true);
      const refused = codeAndPath(parse({ ...VIEW, table: { [key]: invalid } }));
      expect(refused.length).toBeGreaterThan(0);
      expect(refused.every((i) => i.path[0] === 'table' && i.path[1] === key), JSON.stringify(refused)).toBe(true);
    });

    it('`table.navigation` and `table.resizableColumns` stay withheld, refused by name', () => {
      for (const [key, value] of [['navigation', { mode: 'drawer' }], ['resizableColumns', false]] as const) {
        expect(codeAndPath(parse({ ...VIEW, table: { [key]: value } }))).toEqual([{ code: 'invalid_type', path: ['table', key] }]);
      }
    });
  });
});

describe('objectui#6152 round 6 — the authored `object-grid` node does not move', () => {
  it.each(MIRRORED)('`$key` written flat on the node is still refused by name, and parses in the bag', ({ key, valid }) => {
    const flat = codeAndPath(safeValidateSchema({ type: 'object-grid', properties: { objectName: 'task' }, [key]: valid }));
    expect(flat).toEqual([{ code: 'invalid_type', path: [key] }]);
    const bag = safeValidateSchema({ type: 'object-grid', properties: { objectName: 'task', [key]: valid } });
    expect(bag.success, JSON.stringify(codeAndPath(bag))).toBe(true);
  });
});
