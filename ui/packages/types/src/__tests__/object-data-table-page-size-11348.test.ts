/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11348 — `object-data-table` declares `pageSize` on BOTH faces.
 *
 * `ObjectDataTable` spreads its node into the `data-table` it renders, and that
 * node reads `pageSize`, so the key was honoured on `object-data-table` while
 * neither face declared it. It reached the compiler only through `BaseSchema`'s
 * index signature, which objectui#8347 removed. `plugin-dashboard`'s drill-down
 * drawer writes it on the node it builds (from its `maxRows`), and the drilled
 * list's row count depends on it: that runtime half is pinned by
 * `ObjectMetricWidget.drillRoutedToSharedDrawer-8970.test.tsx` in that package.
 *
 * Ruled by the `domain:spec @ objectui` seat on objectui#11348 under the
 * governing text 「未声明键随实现,文档随之」: no spec row reaches
 * `object-data-table`, so the declaration follows the implementation, beside
 * the forwarded siblings `searchable` / `pagination`, typed by reference to
 * `DataTableSchema`'s own member on each face.
 *
 * What is pinned: a numeric `pageSize` is accepted on the TypeScript face, the
 * tolerant zod mirror and the strict authoring face; a non-number is refused
 * by value on the mirror (an `invalid_type` at `pageSize`, not an unrecognized
 * key) and by `tsc` (the `@ts-expect-error` below turns into TS2578 if the
 * member is ever widened; a deletion did too, by dropping it back into the index
 * signature, until objectui#8347, and is refused as an undeclared key now).
 *
 * ⚠️ The compile-time lines are erased at runtime; `tsc -p tsconfig.test.json`,
 * chained from this package's `type-check` script, is what executes them.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectDataTableSchema } from '../objectql.js';
import type { DataTableSchema } from '../data-display.js';
import { ObjectDataTableSchema as ObjectDataTableZod } from '../zod/objectql.zod.js';
import { DataTableSchema as DataTableZod } from '../zod/data-display.zod.js';
import { StrictAnyComponentSchema } from '../zod/index.zod.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The TypeScript member IS `DataTableSchema`'s, by reference, not a restatement. */
export type assertionPageSizeByReference =
  Expect<Equal<ObjectDataTableSchema['pageSize'], DataTableSchema['pageSize']>>;

/** The node `DrillDownDrawer` builds, key for key (its `filter` and `columns` filled in). */
const drawerNode: ObjectDataTableSchema = {
  type: 'object-data-table',
  objectName: 'opportunity',
  filter: { stage: 'won' },
  columns: [{ accessorKey: 'name', header: 'name' }],
  pagination: true,
  searchable: false,
  pageSize: 25,
  drillDown: { enabled: true, mode: 'record', target: 'dialog' },
};

describe('object-data-table declares `pageSize` on both faces (objectui#11348)', () => {
  it('accepts a numeric `pageSize` on the zod mirror and keeps it', () => {
    const result = ObjectDataTableZod.safeParse(drawerNode);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pageSize).toBe(25);
  });

  it('accepts the same node on the strict authoring face, so declared equals enforced', () => {
    expect(StrictAnyComponentSchema.safeParse(drawerNode).success).toBe(true);
  });

  it('refuses a non-number by VALUE on the mirror, not as an unknown key', () => {
    const result = ObjectDataTableZod.safeParse({ ...drawerNode, pageSize: '25' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0].code).toBe('invalid_type');
    expect(result.error.issues[0].path).toEqual(['pageSize']);
  });

  it('the mirror member is the one `DataTableSchema` declares: same verdicts on both nodes', () => {
    for (const value of [25, 0, '25', null, { n: 25 }]) {
      const onTable = DataTableZod.shape.pageSize.safeParse(value).success;
      const onObjectTable = ObjectDataTableZod.shape.pageSize.safeParse(value).success;
      expect(onObjectTable).toBe(onTable);
    }
  });

  it('refuses a string on the TypeScript face', () => {
    // @ts-expect-error — TS2322: a string is not `DataTableSchema['pageSize']`.
    const wrong: ObjectDataTableSchema = { type: 'object-data-table', objectName: 'opportunity', pageSize: '25' };
    expect(wrong.pageSize).toBe('25');
  });
});
