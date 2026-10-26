// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The legacy string `sort` clause is RETIRED on every declaration that used to
 * publish it — objectui#8221, director ruling, decision batch #77, option B:
 * "The platform has one `sort` spelling, the array, everywhere."
 *
 * ## Why the mirror is pinned and not only the interface
 *
 * The TypeScript face and its zod mirror are the DECLARED and the ENFORCED half
 * of one contract. A narrowing that moved only the interface would leave
 * `z.union([z.string(), …])` accepting the retired clause at parse — which is
 * exactly the declared-vs-enforced split this card exists to close, and it
 * would be invisible to a reader of the interface. So both halves are asserted
 * here, on the same three nodes, in the same file.
 *
 * ## Non-vacuity
 *
 * Every refusal below is paired with a control on the SAME schema in the SAME
 * shape: the array arm must still parse. A mirror that had simply stopped
 * accepting anything would fail those controls, so "refused" is a verdict here
 * and not silence. `bogusProp` is not usable as the control on these nodes —
 * they extend a passthrough base — which is why the control is the array arm.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ObjectGridSchema,
  ObjectMapSchema,
  ObjectGanttSchema,
} from '../zod/objectql.zod';
import type {
  ObjectGridSchema as TsObjectGridSchema,
  ObjectMapSchema as TsObjectMapSchema,
  ObjectGanttSchema as TsObjectGanttSchema,
  SortConfig,
} from '../objectql';

/* ── Type-level: the interface face carries the array alone ──────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

export type _GridSortIsArrayOnly = Expect<
  Equal< NonNullable< TsObjectGridSchema['sort'] >, SortConfig[] >
>;
export type _MapSortIsArrayOnly = Expect<
  Equal< NonNullable< TsObjectMapSchema['sort'] >, SortConfig[] >
>;
export type _GanttSortIsArrayOnly = Expect<
  Equal< NonNullable< TsObjectGanttSchema['sort'] >, SortConfig[] >
>;

/** And the mirror's AUTHORING face agrees with the interface, key for key. */
export type _MirrorGridFaceMatches = Expect<
  Equal< NonNullable< z.input< typeof ObjectGridSchema >['sort'] >, SortConfig[] >
>;

/* ── Runtime: the mirrors refuse the clause and accept the array ─────────── */

const NODES = [
  ['object-grid', ObjectGridSchema, { type: 'object-grid', objectName: 'task' }],
  ['object-map', ObjectMapSchema, { type: 'object-map', objectName: 'store' }],
  ['object-gantt', ObjectGanttSchema, { type: 'object-gantt', objectName: 'task' }],
] as const;

const ARRAY_ARM = [{ field: 'name', order: 'desc' }] as const;

describe('the retired string `sort` clause (objectui#8221)', () => {
  it.each(NODES.map(([name]) => name))('%s refuses the legacy string clause', (name) => {
    const [, schema, base] = NODES.find(([n]) => n === name)!;
    for (const clause of ['name desc', 'name asc', 'name', 'name DESC']) {
      const result = schema.safeParse({ ...base, sort: clause });
      expect(result.success, `${name} accepted \`${clause}\``).toBe(false);
      expect(
        result.success ? [] : result.error.issues.map((i) => i.path.join('.')),
      ).toContain('sort');
    }
  });

  it.each(NODES.map(([name]) => name))(
    'CONTROL — %s still accepts the array arm on the same key',
    (name) => {
      const [, schema, base] = NODES.find(([n]) => n === name)!;
      const result = schema.safeParse({ ...base, sort: ARRAY_ARM });
      expect(
        result.success ? null : result.error.issues.map((i) => i.path.join('.') + '/' + i.code),
        `${name} refused the array arm`,
      ).toBeNull();
    },
  );

  it('COUNTER-PROBE — a shape that was never in either arm is still refused', () => {
    // So "refuses a string" is not the whole of what these nodes do: the key is
    // typed, not merely string-hostile.
    for (const [name, schema, base] of NODES) {
      expect(schema.safeParse({ ...base, sort: 42 }).success, name).toBe(false);
    }
  });

  it('the mirror declares `sort` at all — membership, not acceptance', () => {
    // These nodes extend a passthrough base, so acceptance alone cannot tell
    // "declared" from "admitted unexamined". Reading `.shape` can.
    for (const [name, schema] of NODES) {
      expect(Object.keys(schema.shape), name).toContain('sort');
    }
  });
});
