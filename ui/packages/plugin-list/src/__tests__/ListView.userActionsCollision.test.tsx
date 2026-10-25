/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `userActions` is TWO blocks sharing one name — and only the OBJECT's is
 * interpretable by the `$select` predicate harvest (objectui#5398).
 *
 * ## The collision
 *
 *   - VIEW-level `userActions` is TOOLBAR POLICY — the spec's
 *     `UserActionsConfigSchema` (`sort`, `search`, `filter`, `refresh`,
 *     `rowHeight`, `addRecordForm`, `editInline`, `buttons`), which REJECTS
 *     `edit` BY NAME. `ListViewSchema` accepts it, so it is spec-legal, and it
 *     is really written: `ListView`'s own `toolbarFlags` and
 *     `inlineEditOffered` read it, `normalizeListViewSchema` manufactures one
 *     out of a legacy `show*` view that never wrote the key, and `app-shell`'s
 *     `ObjectView` builds one unconditionally for every list it renders.
 *   - OBJECT-level `userActions` is the CRUD-PREDICATE block (`edit` /
 *     `delete` / `create` carrying `visibleWhen` / `disabledWhen`,
 *     objectui#2614) — the only shape `listViewPredicates` can read, since its
 *     loop skips every non-object value.
 *
 * `ListView` used to read the key VIEW-FIRST when harvesting predicate fields
 * for `$select` (`(schema as any).userActions ?? (objectDef as any)?.userActions`),
 * so an authored toolbar block SHADOWED the object's CRUD predicates and
 * silently dropped their operands from the projection — objectui#3501's
 * fail-closed CEL fault (`No such key`), reached with a success receipt at
 * every step. That read is now object-only.
 *
 * ## Why this file exists at all, given objectui#5240 fixed the same line
 *
 * This is the SIBLING read site of the one objectui#5426 fixed in
 * `plugin-grid`. The maintainer's 2026-08-20 ruling (Q2=B) kept the two serial
 * rather than batched for one reason: both read sites must end up with ONE
 * shape and ONE stated reason, not two spellings of one fix. So the sections
 * below are `gridNonAuthorKeys.test.tsx`'s deliberately, clause for clause.
 *
 * And this instance was WORSE than the grid's. On the app-shell path the left
 * operand of the `??` is an object literal of two spreads, so it is `{}` at
 * worst — never nullish. `??` therefore never fell through and the object's
 * CRUD block was never reached AT ALL there, rather than being shadowed only
 * when an author happened to write toolbar policy. The empty-block case below
 * is that path.
 *
 * ## What the pin does NOT claim
 *
 * It does not assert "no producer writes this key" and it does not call the
 * key non-author surface. Both readings were measured false on objectui#5240,
 * and Q1=A exists precisely to keep the falsified claim out of the census
 * artifact. What it asserts is what the comments in `ListView.tsx` actually
 * claim: the two shapes, a producer inside this package's reach, the harvest's
 * blindness to the toolbar block, and the projection behaviour that shadowing
 * broke.
 *
 * plugin-grid is not a dependency of plugin-list (avoids a cycle), so — as in
 * `ListView.findParamsHandoff.test.tsx` — a stub `object-grid` stands in for
 * the child the default view renders.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import {
  ComponentRegistry,
  collectPredicateFieldRefs,
  listViewPredicates,
  normalizeListViewSchema,
} from '@object-ui/core';
import { ListViewSchema as SpecListViewSchema, UserActionsConfigSchema } from '@objectstack/spec/ui';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

import { ListView } from '../ListView';

const OBJECT = 'test_object';

/** What a VIEW author legitimately writes: toolbar policy. */
const VIEW_TOOLBAR_BLOCK = { sort: true, search: true, filter: false };
/** What an OBJECT declares under the same name: a CRUD predicate block. */
const OBJECT_CRUD_BLOCK = { edit: { visibleWhen: 'record.status == "open"' } };
/** The toolbar vocabulary the comments at both read sites list by name. */
const TOOLBAR_KEYS = [
  'sort', 'search', 'filter', 'refresh', 'rowHeight', 'addRecordForm', 'editInline', 'buttons',
];

/** Unrecognized KEYS from a failed parse — a key verdict, never a document one. */
const unrecognizedKeys = (result: { success: boolean; error?: unknown }): string[] =>
  ((result as { error: { issues: Array<{ code: string; keys?: string[] }> } }).error?.issues ?? [])
    .filter((issue) => issue.code === 'unrecognized_keys')
    .flatMap((issue) => issue.keys ?? []);

// ---------------------------------------------------------------------------
// The two shapes
// ---------------------------------------------------------------------------

describe('`userActions` is two blocks sharing one name — the view one is toolbar policy (objectui#5398)', () => {
  it.each(['edit', 'delete', 'create'])('the view-level schema refuses the CRUD key `%s` by name', (key) => {
    const result = UserActionsConfigSchema.safeParse({ [key]: { visibleWhen: 'record.status == "open"' } });
    expect(
      result.success,
      `\`UserActionsConfigSchema\` now ACCEPTS \`${key}\` — the two \`userActions\` blocks no longer`
        + ' collide, so re-read the collision comments in `ListView.tsx`: their premise was that a'
        + ' CRUD predicate block can never legally arrive on a VIEW.',
    ).toBe(false);
    expect(unrecognizedKeys(result)).toContain(key);
  });

  it('…and accepts the toolbar vocabulary, so those refusals are about the KEY', () => {
    // The control. Without it, "the view schema refuses `edit`" would pass just
    // as happily against a schema that refuses everything.
    expect(UserActionsConfigSchema.safeParse(VIEW_TOOLBAR_BLOCK).success).toBe(true);
    expect(
      Object.keys((UserActionsConfigSchema as unknown as { shape: Record<string, unknown> }).shape),
      'the toolbar vocabulary changed — the comments at both read sites spell it out by name.',
    ).toEqual(expect.arrayContaining(TOOLBAR_KEYS));
  });
});

// ---------------------------------------------------------------------------
// The view-level key is AUTHORED
// ---------------------------------------------------------------------------

describe('the view-level key is AUTHORED, not an unwritten surface (objectui#5398)', () => {
  it('a view document carrying the toolbar block is spec-legal', () => {
    // This is the measurement that killed the original "deliberately unlisted,
    // zero producers" reading on objectui#5240. If it ever goes false, the
    // collision comments describe a repo that no longer exists.
    const result = SpecListViewSchema.safeParse({
      name: 'my_view',
      label: 'My View',
      columns: [{ field: 'name' }],
      userActions: VIEW_TOOLBAR_BLOCK,
    });
    expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
  });

  it('…while the CRUD block is refused on a view, at the userActions path', () => {
    const result = SpecListViewSchema.safeParse({
      name: 'my_view',
      label: 'My View',
      columns: [{ field: 'name' }],
      userActions: OBJECT_CRUD_BLOCK,
    });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('edit');
  });

  it('a PRODUCER in this package’s own reach MANUFACTURES the view block', () => {
    // The producer IS the evidence: `normalizeListViewSchema` is the fold
    // `ListView` runs on its own schema and `app-shell` runs on both halves of
    // the view it hands down. A legacy view that never wrote `userActions`
    // comes out of it carrying one — so "nobody authors it" was never
    // available as a reason for this read, even before counting the hand-built
    // literals.
    const folded = normalizeListViewSchema({
      type: 'list-view',
      objectName: OBJECT,
      columns: ['name'],
      showSearch: false,
    } as Record<string, unknown>) as { userActions?: Record<string, unknown> };
    expect(
      folded.userActions,
      'the legacy `show*` fold stopped emitting `userActions`. If that is deliberate, the'
        + ' collision comments in `ListView.tsx` name this producer and are due a re-read —'
        + ' do not just delete this assertion.',
    ).toEqual({ search: false });
  });
});

// ---------------------------------------------------------------------------
// Only the OBJECT block is interpretable by the harvest
// ---------------------------------------------------------------------------

describe('only the OBJECT block is interpretable by the predicate harvest (objectui#5398)', () => {
  it('the toolbar block yields ZERO predicate fields', () => {
    // Every value is a boolean, so `listViewPredicates` skips all of them. This
    // is why shadowing was silent: not an error, just nothing harvested.
    expect(collectPredicateFieldRefs(listViewPredicates({ userActions: VIEW_TOOLBAR_BLOCK }))).toEqual([]);
  });

  it('the object CRUD block yields its operand', () => {
    expect(collectPredicateFieldRefs(listViewPredicates({ userActions: OBJECT_CRUD_BLOCK }))).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// The renderer behaviour shadowing broke
// ---------------------------------------------------------------------------

let prevObjectGrid: unknown;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid as never);
  else ComponentRegistry.unregister('object-grid');
});
afterEach(() => { cleanup(); });

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'r-1', name: 'Alice' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      // `status` is deliberately NOT a column: a predicate-only field is the
      // ordinary case the harvest exists for.
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'select' } },
      userActions: OBJECT_CRUD_BLOCK,
    })),
  };
}

/**
 * `$select` for a list whose OBJECT declares the CRUD predicate block, with
 * whatever the view carries layered on top.
 */
const projectionSelect = async (viewExtra: Record<string, unknown>): Promise<string[]> => {
  const ds = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <ListView
        schema={{
          type: 'list-view',
          objectName: OBJECT,
          columns: ['name'],
          ...viewExtra,
        } as unknown as ListViewSchema}
        dataSource={ds as never}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  return ((ds.find.mock.calls.at(-1) as unknown as [string, { $select?: string[] }])?.[1]?.$select
    ?? []) as string[];
};

describe('a view-level toolbar block must not shadow the object CRUD predicates (objectui#5398)', () => {
  it('the object block reaches $select — the surviving read is still there', async () => {
    // Pins the READ, not the fix: green on both legs of the shadowing change,
    // red the moment the `userActions` line is dropped from the harvest.
    expect(
      await projectionSelect({}),
      "the object's `userActions.edit.visibleWhen` operand is missing from `$select` — CEL faults"
        + ' on the absent key and the row Edit button fails closed for everyone (objectui#3501).',
    ).toContain('status');
  });

  it('…and a spec-legal toolbar block on the view does not knock it out', async () => {
    // The regression itself. Read view-first, the `??` took this block, the
    // harvest found no predicates in it, and `status` left the projection —
    // with a success receipt at every step.
    expect(
      await projectionSelect({ userActions: VIEW_TOOLBAR_BLOCK }),
      'a view-level toolbar block is shadowing the object CRUD predicates again: the projection'
        + ' lost `status`. The read at the `$select` harvest must stay object-only.',
    ).toContain('status');
  });

  it('…nor does an EMPTY view-level block — the app-shell path, where the left operand is always an object', async () => {
    // Why this instance was worse than plugin-grid's. `app-shell`'s
    // `ObjectView` builds `userActions` as `{...listSchema, ...viewDef}`, which
    // is `{}` when neither side declares a toolbar key — truthy, so the old
    // `??` never fell through and the object's CRUD block was never reached AT
    // ALL on that path, for every list the app shell renders.
    expect(
      await projectionSelect({ userActions: {} }),
      'an EMPTY view-level `userActions` is shadowing the object CRUD predicates: this is the'
        + ' app-shell path, where the left operand of a restored `??` is an object literal that is'
        + ' never nullish, so the object block would never be consumed at all.',
    ).toContain('status');
  });
});
