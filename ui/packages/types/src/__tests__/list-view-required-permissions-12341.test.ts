/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12341 — the list view's audience key, `requiredPermissions`,
 * mirrored from `@objectstack/spec` 18 (objectstack#22611, ruling A).
 *
 * The spec declares it on the list-view SHAPE: a list of capabilities, all
 * required. The server enforces it (objectstack PR #22731): it lists only the
 * views a caller may open, refuses a by-name read with `403`, and prunes an
 * object's `listViews`. objectui mirrors the key and adds ⛔ no client-side gate.
 *
 * Three faces of `@object-ui/types` carry a list view, and this file pins the
 * key on each, accept AND refuse, so a pin cannot pass by accepting everything:
 *
 *  - `NamedListView` — the hand-written named-view interface. It was the one
 *    face without the key (objectui#12030 pinned it PENDING); this card declares
 *    it, by reference through `ListViewSchema['requiredPermissions']`.
 *  - `ListViewSchema` — the `list-view` node. Its zod mirror takes every spec
 *    key it does not override by reference (`specFieldsExcept`), so it already
 *    carried the key; pinned here so the three faces read as one fact.
 *  - `ObjectViewSchema.listViews` — the protocol's own `ObjectListViewSchema`
 *    record by reference (objectui#7928), so it carried the key too.
 *
 * The census placement (a fifth, server-enforced bucket, ⛔ not bucket ①) is in
 * `object-view-unmirrored-keys-7779.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { ListViewSchema as SpecListViewSchema, type ListView as SpecListView } from '@objectstack/spec/ui';
import { ListViewSchema, ObjectViewSchema } from '../zod/objectql.zod';
import type {
  NamedListView,
  ListViewSchema as TsListViewSchema,
  ObjectViewSchema as TsObjectViewSchema,
} from '../objectql';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Issue = { path: PropertyKey[]; code?: string };

// ── The TypeScript faces: the SAME type as the spec's member on all three ────
type SpecRequiredPermissions = SpecListView['requiredPermissions'];
type ObjectListViewEntry = NonNullable<TsObjectViewSchema['listViews']>[string];

export type _NamedListViewMirrorsSpec = Expect<Equal<NamedListView['requiredPermissions'], SpecRequiredPermissions>>;
export type _ListViewNodeMirrorsSpec = Expect<Equal<TsListViewSchema['requiredPermissions'], SpecRequiredPermissions>>;
export type _ObjectListViewEntryMirrorsSpec = Expect<Equal<ObjectListViewEntry['requiredPermissions'], SpecRequiredPermissions>>;
// …and that type is a string list, optional — not `any`, not `unknown`.
export type _IsOptionalStringList = Expect<Equal<SpecRequiredPermissions, string[] | undefined>>;

const acceptedNamedView: NamedListView = { label: 'Legal desk', columns: ['name'], requiredPermissions: ['legal.review'] };
// @ts-expect-error a bare string is not a capability LIST
const refusedNamedView: NamedListView = { label: 'Legal desk', requiredPermissions: 'legal.review' };
// @ts-expect-error nor is a list of non-strings
const refusedNamedViewElements: NamedListView = { label: 'Legal desk', requiredPermissions: [1] };
void refusedNamedView;
void refusedNamedViewElements;

const LIST_VIEW_BASE = { type: 'list-view', objectName: 'clm_contract', columns: ['name'] } as const;
const OBJECT_VIEW_BASE = { type: 'object-view', objectName: 'clm_contract' } as const;
const NAMED_VIEW_BASE = { label: 'Legal desk', columns: ['name'] } as const;

function refusedAt(issues: readonly Issue[], ...path: PropertyKey[]): boolean {
  const want = path.join('.');
  return issues.some((i) => i.path.join('.') === want);
}

describe('objectui#12341 — list-view `requiredPermissions`, mirrored from spec 18 on every face', () => {
  it('`NamedListView` declares it: a typed author writes a capability list and keeps it', () => {
    expect(acceptedNamedView.requiredPermissions).toEqual(['legal.review']);
  });

  it('the `list-view` node mirror takes the spec slot by reference — accepted, kept, and a non-array refused AT the key', () => {
    const shape = (ListViewSchema as unknown as { shape: Record<string, unknown> }).shape;
    const specShape = (SpecListViewSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(specShape)).toContain('requiredPermissions');
    expect(Object.keys(shape)).toContain('requiredPermissions');

    const ok = ListViewSchema.safeParse({ ...LIST_VIEW_BASE, requiredPermissions: ['legal.review', 'setup.access'] });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);
    if (ok.success) expect((ok.data as { requiredPermissions?: unknown }).requiredPermissions).toEqual(['legal.review', 'setup.access']);

    // Control: the base alone parses, so each refusal below is about the key.
    expect(ListViewSchema.safeParse(LIST_VIEW_BASE).success).toBe(true);
    for (const bad of ['legal.review', [1], { all: ['legal.review'] }, true]) {
      const r = ListViewSchema.safeParse({ ...LIST_VIEW_BASE, requiredPermissions: bad });
      expect(r.success, `the list-view mirror admitted requiredPermissions: ${JSON.stringify(bad)}`).toBe(false);
      if (!r.success) {
        const issues = r.error.issues as readonly Issue[];
        expect(issues.some((i) => i.path[0] === 'requiredPermissions')).toBe(true);
      }
    }
  });

  it('`ObjectViewSchema.listViews` (the spec record) accepts it on a named view and refuses a non-array AT the key', () => {
    const ok = ObjectViewSchema.safeParse({
      ...OBJECT_VIEW_BASE,
      listViews: { legal_desk: { ...NAMED_VIEW_BASE, requiredPermissions: ['legal.review'] } },
    });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);
    if (ok.success) {
      const data = ok.data as z.infer<typeof ObjectViewSchema> & { listViews?: Record<string, { requiredPermissions?: unknown }> };
      expect(data.listViews?.legal_desk?.requiredPermissions).toEqual(['legal.review']);
    }

    expect(ObjectViewSchema.safeParse({ ...OBJECT_VIEW_BASE, listViews: { legal_desk: NAMED_VIEW_BASE } }).success).toBe(true);
    const r = ObjectViewSchema.safeParse({
      ...OBJECT_VIEW_BASE,
      listViews: { legal_desk: { ...NAMED_VIEW_BASE, requiredPermissions: 'legal.review' } },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(refusedAt(r.error.issues as readonly Issue[], 'listViews', 'legal_desk', 'requiredPermissions')).toBe(true);
    }
  });
});
