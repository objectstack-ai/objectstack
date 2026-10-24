/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — `search` and `searchableFields` on `ObjectGanttSchema`
 * (objectui#10250).
 *
 * `ObjectGantt.reload` reads both off the node — the term as `$search`, the
 * field list as `$searchFields` alongside it — because a `ListView` gantt's
 * toolbar Search box can reach the chart's own query through no other door.
 * A key the renderer reads is declared on both faces, so it is validated:
 * `BaseSchema` is `.passthrough()`, so an undeclared key would parse unjudged
 * (and an undeclared read typed as `any` until objectui#8347 removed
 * `[key: string]: any`; it does not compile now).
 *
 * The compile-time half is the `@ts-expect-error` pair at the bottom, which
 * guards each member's TYPE. When written, a dropped declaration made its member
 * resolve to `any` and the unused directive failed `tsc -p tsconfig.test.json`
 * (TS2578); since objectui#8347 the indexed access itself errors, the directive
 * swallows that, and the well-typed counter-probe beside it fails instead.
 */

import { describe, it, expect } from 'vitest';
import { ObjectGanttSchema } from '../zod/objectql.zod.js';
import type { ObjectGanttSchema as ObjectGanttSchemaTS } from '../objectql.js';

const MINIMAL = {
  type: 'object-gantt',
  objectName: 'task',
  startDateField: 'start',
  endDateField: 'end',
} as const;

describe('ObjectGanttSchema — the search pair is declared (objectui#10250)', () => {
  it('the mirror declares both keys, both optional, with no default', () => {
    const shape = Object.keys(ObjectGanttSchema.shape);
    expect(shape).toContain('search');
    expect(shape).toContain('searchableFields');
    const result = ObjectGanttSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect('search' in result.data).toBe(false);
    expect('searchableFields' in result.data).toBe(false);
  });

  it('accepts a well-typed value on each', () => {
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, search: 'needle', searchableFields: ['name'] });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('refuses a wrong-typed value on each, on that key\'s path', () => {
    for (const [key, bad] of [['search', 5], ['searchableFields', 'name']] as const) {
      const result = ObjectGanttSchema.safeParse({ ...MINIMAL, [key]: bad });
      expect(result.success, `${key} accepted ${JSON.stringify(bad)}`).toBe(false);
      if (result.success) continue;
      expect(result.error.issues.some((i) => i.path[0] === key), `${key} failed off its path`).toBe(true);
    }
  });
});

describe('ObjectGanttSchema (TS) — compile-time pin on the same pair', () => {
  it('refuses a wrong-typed value on both keys', () => {
    // @ts-expect-error — `search` is declared `string | undefined`.
    const search: ObjectGanttSchemaTS['search'] = 5;
    // @ts-expect-error — `searchableFields` is declared `string[] | undefined`.
    const searchableFields: ObjectGanttSchemaTS['searchableFields'] = 'name';
    expect([search, searchableFields]).toHaveLength(2);
  });

  it('accepts the well-typed value on both keys', () => {
    // Counter-probe: a declaration narrowed to `never` would satisfy both
    // directives above.
    const ok: ObjectGanttSchemaTS = { type: 'object-gantt', objectName: 'task', search: 'needle', searchableFields: ['name'] };
    expect(ok.search).toBe('needle');
  });
});
