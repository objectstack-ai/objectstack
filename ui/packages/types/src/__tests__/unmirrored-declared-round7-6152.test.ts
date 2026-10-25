/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 7 — `ObjectGridSchema.resizableColumns` RETIRED on both faces.
 *
 * `resizable` is canonical, and `resizableColumns` (its legacy second spelling, read only
 * when `resizable` was absent) retires with no window. Round 6 stopped at the key: the
 * authored `object-grid` node's `properties` bag is the spec's
 * `ComponentPropsMap['object-grid']` row by reference (objectui#11276), and that row still
 * declared the alias, so a local retirement alone would have left the bag accepting a key
 * nothing read. `@objectstack/spec` 17.7.0 (objectstack#21445) retired it in the row, and
 * objectui resolves 17.7.0 since objectui#11717. So this round makes the four strokes:
 *
 *   - `resizableColumns?: never` on the interface;
 *   - a `retirementTombstone()` on the flat zod mirror, naming `properties.resizable`;
 *   - `ObjectGrid`'s `resizable ?? resizableColumns` fallback read dropped (pinned in
 *     `@object-ui/plugin-grid`, `ObjectGrid.resizableColumnsRetired-6152.test.tsx`);
 *   - the key off `zod-mirror-parity.test.ts`'s `UnmirroredDeclared` (its entry went with
 *     it: a tombstone is a mirrored member).
 *
 * The protocol block below is the precondition, re-read against the INSTALLED spec: the
 * local tombstone must never refuse what the installed protocol accepts.
 */
import { describe, it, expect } from 'vitest';

import { ObjectGridPropsSchema as SpecObjectGridPropsSchema } from '@objectstack/spec/ui';
import type { ObjectGridSchema as TsObjectGridSchema } from '../objectql';
import { ObjectGridSchema, ObjectViewSchema } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };
type Parse = (doc: unknown) => Parsed;

const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path })));

const GRID = { type: 'object-grid', objectName: 'task' };
const AUTHORED = { type: 'object-grid', properties: { objectName: 'task' } };
const VIEW = { type: 'object-view', objectName: 'task' };

const DOORS: ReadonlyArray<readonly [string, Parse]> = [
  ['the tolerant face', (d) => AnyComponentSchema.safeParse(d)],
  ['the strict face', (d) => StrictAnyComponentSchema.safeParse(d)],
  ['safeValidateSchema', (d) => safeValidateSchema(d)],
];

describe('objectui#6152 round 7 — the installed protocol refuses `resizableColumns` (the precondition)', () => {
  it('the `object-grid` row refuses `resizableColumns` by name, and takes `resizable`', () => {
    expect(codeAndPath(SpecObjectGridPropsSchema.safeParse({ resizableColumns: false })))
      .toEqual([{ code: 'invalid_type', path: ['resizableColumns'] }]);
    // Lit control: the canonical spelling parses on the same row.
    expect(SpecObjectGridPropsSchema.safeParse({ resizable: false }).success).toBe(true);
  });
});

describe('objectui#6152 round 7 — the flat `ObjectGridSchema` mirror refuses the retired spelling', () => {
  it('CONTROL: the minimal node and the canonical `resizable` parse', () => {
    expect(ObjectGridSchema.safeParse(GRID).success).toBe(true);
    expect(ObjectGridSchema.safeParse({ ...GRID, resizable: false }).success).toBe(true);
  });

  it('`resizableColumns` is a MEMBER, so `.passthrough()` no longer keeps it unexamined', () => {
    expect('resizableColumns' in ObjectGridSchema.shape).toBe(true);
  });

  it.each([true, false])('`resizableColumns: %s` is refused at the key, naming `properties.resizable`', (value) => {
    const r = ObjectGridSchema.safeParse({ ...GRID, resizableColumns: value });
    expect(codeAndPath(r)).toEqual([{ code: 'invalid_type', path: ['resizableColumns'] }]);
    expect(r.success ? '' : r.error.issues[0].message).toContain('properties.resizable');
  });
});

describe('objectui#6152 round 7 — every authored door refuses it, flat and in the bag', () => {
  describe.each(DOORS)('%s', (_door, parse) => {
    it('CONTROL: `properties.resizable` parses', () => {
      const r = parse({ ...AUTHORED, properties: { objectName: 'task', resizable: false } });
      expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
    });

    it('`properties.resizableColumns` is refused at its path', () => {
      expect(codeAndPath(parse({ ...AUTHORED, properties: { objectName: 'task', resizableColumns: false } })))
        .toEqual([{ code: 'invalid_type', path: ['properties', 'resizableColumns'] }]);
    });

    it('a flat `resizableColumns` on the node is refused by name', () => {
      expect(codeAndPath(parse({ ...AUTHORED, resizableColumns: false })))
        .toEqual([{ code: 'invalid_type', path: ['resizableColumns'] }]);
    });

    it('an `object-view` `table.resizableColumns` stays refused by the slot\'s own message', () => {
      // The slot overrides the grid's tombstone with its own refusal (objectui#10976),
      // as it does for the five tombstones objectui#11068 retired on the grid.
      const r = parse({ ...VIEW, table: { resizableColumns: false } });
      expect(codeAndPath(r)).toEqual([{ code: 'invalid_type', path: ['table', 'resizableColumns'] }]);
      expect(r.success ? '' : r.error!.issues[0].message).toContain('objectui#10976');
      // Lit control: the slot relays `resizable`.
      expect(parse({ ...VIEW, table: { resizable: false } }).success).toBe(true);
    });
  });

  it('the `object-view` mirror\'s own slot agrees with the doors above', () => {
    expect(codeAndPath(ObjectViewSchema.safeParse({ ...VIEW, table: { resizableColumns: false } })))
      .toEqual([{ code: 'invalid_type', path: ['table', 'resizableColumns'] }]);
  });
});

describe('objectui#6152 round 7 — the TypeScript face', () => {
  it('`resizableColumns` is a `tsc` error on the interface, while `resizable` type-checks', () => {
    // A real directive: this package type-checks its tests (`tsconfig.test.json`), so a
    // re-declared member fails on the unused directive.
    // @ts-expect-error `resizableColumns` is RETIRED (objectui#6152) — write `resizable`
    const retired: TsObjectGridSchema = { type: 'object-grid', objectName: 'task', resizableColumns: false };
    const live: TsObjectGridSchema = { type: 'object-grid', objectName: 'task', resizable: false };
    expect([retired.type, live.resizable]).toEqual(['object-grid', false]);
  });
});

/*
 * Read off the member: a deletion would not compile here at all, and a re-declared
 * `boolean` would read as `boolean | undefined`.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

export type assertionResizableColumnsIsRetiredOnTheInterface = [
  Expect<Equal<TsObjectGridSchema['resizableColumns'], undefined>>,
  Expect<Equal<TsObjectGridSchema['resizable'], boolean | undefined>>,
];
