/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11355 — two keys a renderer reads are declared on both faces, each
 * with the type of a `@objectstack/spec` row, by reference.
 *
 * - `ObjectKanbanSchema.swimlaneField`: `ComponentPropsMap['object-kanban']`
 *   declares it, `ObjectKanban` reads it, and the registration publishes it.
 * - `DetailViewSchema.showHeader`: `detail-view` has no spec row. Its producer
 *   is `record:details`, which writes its own spec-declared `showHeader` onto
 *   the `detail-view` node it builds, so the member takes that row's type.
 *
 * Before this card both keys reached their reads only through `BaseSchema`'s
 * index signature on the TypeScript face (so the indexed type was `any`), and
 * through `.passthrough()` on the zod face (so any value was kept unjudged).
 * The type rows below are red with the member deleted, and the refusal rows are
 * red with the zod member deleted; each refusal row has a control that differs
 * from it only in the key name.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import type { ObjectKanbanProps as SpecObjectKanbanProps, RecordDetailsProps as SpecRecordDetailsProps } from '@objectstack/spec/ui';
import { ObjectKanbanSchema } from '../zod/objectql.zod';
import { DetailViewSchema } from '../zod/views.zod';
import type { ObjectKanbanSchema as TsObjectKanbanSchema } from '../objectql';
import type { DetailViewSchema as TsDetailViewSchema } from '../views';

/** Compile-time truth assertion, erased at runtime — only `tsc` checks these. */
type Expect<T extends true> = T;
/** Compile-time equality, exact in both directions; `any` equals nothing but `any`. */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

/* ── The TypeScript face: each member is the spec row's type ─────────────── */

export type _SwimlaneFieldIsTheKanbanRows = Expect<
  Equal<TsObjectKanbanSchema['swimlaneField'], SpecObjectKanbanProps['swimlaneField']>
>;
export type _ShowHeaderIsTheRecordDetailsRows = Expect<
  Equal<TsDetailViewSchema['showHeader'], z.input<typeof SpecRecordDetailsProps>['showHeader']>
>;
/** Spelled out as well, so both faces drifting to one wrong type cannot pass. */
export type _SwimlaneFieldIsAString = Expect<Equal<TsObjectKanbanSchema['swimlaneField'], string | undefined>>;
export type _ShowHeaderIsABoolean = Expect<Equal<TsDetailViewSchema['showHeader'], boolean | undefined>>;

/* ── The zod face: each member judges its value ───────────────────────────── */

/** The issues as `path` and `code`, so a red run says what broke without pinning wording. */
const issues = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => ({ path: i.path.map(String), code: i.code }));

const BOARD = { type: 'object-kanban', objectName: 'tasks', groupBy: 'status' } as const;
const VIEW = { type: 'detail-view', objectName: 'accounts' } as const;

describe('object-kanban swimlaneField (objectui#11355)', () => {
  it('accepts a field name and keeps it', () => {
    const r = ObjectKanbanSchema.safeParse({ ...BOARD, swimlaneField: 'owner' });
    expect(issues(r)).toEqual([]);
    expect(r.success && (r.data as Record<string, unknown>).swimlaneField).toBe('owner');
  });

  it('refuses a value that is not a string, at the key', () => {
    const r = ObjectKanbanSchema.safeParse({ ...BOARD, swimlaneField: 42 });
    expect(issues(r)).toEqual([{ path: ['swimlaneField'], code: 'invalid_type' }]);
  });

  it('CONTROL — the same value under an undeclared key is kept, so the refusal is the declaration', () => {
    const r = ObjectKanbanSchema.safeParse({ ...BOARD, swimlaneFieldUndeclared11355: 42 });
    expect(issues(r)).toEqual([]);
  });
});

describe('detail-view showHeader (objectui#11355)', () => {
  it('accepts `false`, the value record:details writes by default, and keeps it', () => {
    const r = DetailViewSchema.safeParse({ ...VIEW, showHeader: false });
    expect(issues(r)).toEqual([]);
    expect(r.success && (r.data as Record<string, unknown>).showHeader).toBe(false);
  });

  it('refuses a value that is not a boolean, at the key', () => {
    const r = DetailViewSchema.safeParse({ ...VIEW, showHeader: 'no' });
    expect(issues(r)).toEqual([{ path: ['showHeader'], code: 'invalid_type' }]);
  });

  it('CONTROL — the same value under an undeclared key is kept, so the refusal is the declaration', () => {
    const r = DetailViewSchema.safeParse({ ...VIEW, showHeaderUndeclared11355: 'no' });
    expect(issues(r)).toEqual([]);
  });
});
