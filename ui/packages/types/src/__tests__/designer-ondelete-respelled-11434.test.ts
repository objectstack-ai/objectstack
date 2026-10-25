/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DataModelRelationship.onDelete` is RESPELLED `deleteBehavior`, in the
 * platform's vocabulary, on both faces (objectui#11434).
 *
 * ## The ruling this pins
 *
 * The designer carried its own spelling of the referential action, `onDelete`,
 * with its own four literals (`'cascade' | 'set-null' | 'restrict' |
 * 'no-action'`), while `@objectstack/spec` spells it `deleteBehavior` on a
 * relationship field, with `'set_null' | 'cascade' | 'restrict'`. Nothing read
 * the designer's spelling, and nothing outside one test fixture authored it.
 * The seat ruled the member READ under the platform's spelling: `deleteBehavior`
 * is declared on both faces in the spec's vocabulary and `DataModelDesigner`
 * draws it, and `onDelete` is refused by name with the migration.
 *
 * The TypeScript face reads `deleteBehavior`'s type off the spec, so the row
 * below that compares the two is the drift guard; the zod face restates the
 * enum, and `zod-mirror-parity.test.ts` compares it with the declaration.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` rows and the `@ts-expect-error` directive are
 * TYPE-level: `tsc -p tsconfig.test.json` (the third leg of this package's
 * `type-check` script) reads them. The `safeValidateSchema` /
 * `StrictAnyComponentSchema` rows are RUNTIME and vitest reads them. A green
 * run of either one alone says nothing about the other.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Field as SpecField } from '@objectstack/spec/data';

import { DataModelRelationshipSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import type { DataModelRelationship } from '../designer';

/* ── Type-level pins: the `tsc` channel ────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type ShapeOf<M> = M extends { shape: infer S } ? S : never;
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;

/**
 * `deleteBehavior` carries the spec's vocabulary on both faces, and `onDelete`
 * reads as `undefined` on both — a `?: never` tombstone, and an alias refusal
 * whose `z.input` is `undefined`.
 */
export type assertionRespelled = [
  Expect<Equal<DataModelRelationship['deleteBehavior'], SpecField['deleteBehavior']>>,
  Expect<Equal<DataModelRelationship['deleteBehavior'], 'set_null' | 'cascade' | 'restrict' | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof DataModelRelationshipSchema>['deleteBehavior']>, 'set_null' | 'cascade' | 'restrict' | undefined>>,
  Expect<Equal<DataModelRelationship['onDelete'], undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof DataModelRelationshipSchema>['onDelete']>, undefined>>,
];

/* ── The runtime half ─────────────────────────────────────────────────────── */

const ENTITY = { id: 'e', name: 'account', label: 'Account', fields: [], position: { x: 0, y: 0 } };
const RELATIONSHIP = {
  id: 'r',
  sourceEntity: 'e',
  sourceField: 'id',
  targetEntity: 'e',
  targetField: 'parent_id',
  type: 'one-to-many',
} as const;
const model = (relationship: Record<string, unknown>) => ({
  type: 'data-model-designer',
  entities: [ENTITY],
  relationships: [{ ...RELATIONSHIP, ...relationship }],
});

describe('authoring `onDelete` is a `tsc` error; `deleteBehavior` is not (objectui#11434)', () => {
  it('refuses the old spelling and accepts the new one', () => {
    const old: DataModelRelationship = {
      ...RELATIONSHIP,
      // @ts-expect-error `onDelete` is respelled `deleteBehavior` (objectui#11434)
      onDelete: 'cascade',
    };
    const respelled: DataModelRelationship = { ...RELATIONSHIP, deleteBehavior: 'set_null' };
    expect([old.id, respelled.deleteBehavior]).toEqual(['r', 'set_null']);
  });
});

describe('the zod face refuses `onDelete` by name, with the migration (objectui#11434)', () => {
  it('is refused on the rendering face, at its own path, naming the new key and the migration', () => {
    const result = safeValidateSchema(model({ onDelete: 'set-null' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'relationships.0.onDelete');
    expect(issue, JSON.stringify(result.error.issues)).toBeDefined();
    if (!issue) return;
    expect(issue.code).toBe('invalid_type');
    // The spec's own "Did you mean" sentence (`aliasKeyRefusal`), so one remedy
    // meets the author on both faces; then the card and the migration.
    expect(issue.message).toContain('Did you mean `onDelete` → `deleteBehavior`?');
    expect(issue.message).toContain('objectui#11434');
    expect(issue.message).toContain('Migration:');
  });

  it('is refused on the strict authoring face, at its own path', () => {
    const result = StrictAnyComponentSchema.safeParse(model({ onDelete: 'cascade' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('relationships.0.onDelete');
  });

  it.each(['set_null', 'cascade', 'restrict'])('accepts `deleteBehavior: %s` on both faces — the control', (value) => {
    expect(safeValidateSchema(model({ deleteBehavior: value })).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(model({ deleteBehavior: value })).success).toBe(true);
  });

  it.each(['set-null', 'no-action'])('refuses the old vocabulary under the new key: `deleteBehavior: %s`', (value) => {
    const result = safeValidateSchema(model({ deleteBehavior: value }));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('relationships.0.deleteBehavior');
  });
});
