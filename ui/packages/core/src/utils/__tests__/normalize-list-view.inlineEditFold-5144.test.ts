/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5144 — a view's `inlineEdit` folds into `userActions.editInline`.
 *
 * The spec declared `userActions.editInline` with `.default(false)` when this
 * fold landed. Stored views never carried that key: they carry `inlineEdit`,
 * which authors declare and the console's list toolbar used to write. Until
 * this fold, `ListView` could not read `editInline` with the spec default
 * without taking inline editing away from every stored console view, so it read
 * an absent `editInline` as "defer to the host". The maintainer ruled the
 * B-fold: the stored key folds into the spec key, and the spec default is read
 * as written. Triage's ruling E then stopped the toolbar writing `inlineEdit`
 * at all.
 *
 * The maintainer's v18 ruling (objectstack#22605) flipped that default to
 * `true`, and `ListView` reads an absent `editInline` as on (objectui#12086).
 * The fold is unchanged by it, and so is this table: the fold applies no
 * default, it carries a boolean `inlineEdit` over. What the flip changes is
 * the reader's verdict on the `neither key` row, pinned with the rest of the
 * toolbar's behaviour.
 *
 * This file pins the fold's table. `@object-ui/plugin-list`'s
 * `ListView.permissions.test.tsx` pins what the toolbar does with its output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { normalizeListViewSchema } from '../normalize-list-view.js';

type View = Record<string, unknown>;

const fold = (view: View): View => normalizeListViewSchema(view);
const editInlineOf = (view: View): unknown =>
  (view.userActions as Record<string, unknown> | undefined)?.editInline;

/** Already canonical apart from the pair under test, so nothing else folds. */
const BASE: View = { type: 'list-view', objectName: 'task', viewType: 'grid' };

describe('a view`s inlineEdit folds into userActions.editInline (objectui#5144)', () => {
  beforeEach(() => {
    // #8372's undrawable-kind warning is developer-facing noise here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * One row per stored shape. `editInline` is what `ListView` reads, with the
   * spec default, to decide whether inline editing is offered. `inlineEdit` is
   * what it seeds the grid's edit mode from, so the fold must keep it.
   */
  const TABLE: ReadonlyArray<{
    name: string;
    input: View;
    editInline: boolean | undefined;
    inlineEdit: boolean | undefined;
    byReference: boolean;
  }> = [
    { name: 'neither key: nothing to fold', input: {}, editInline: undefined, inlineEdit: undefined, byReference: true },
    { name: 'stored inlineEdit: true folds to on', input: { inlineEdit: true }, editInline: true, inlineEdit: true, byReference: false },
    { name: 'stored inlineEdit: false folds to off', input: { inlineEdit: false }, editInline: false, inlineEdit: false, byReference: false },
    {
      name: 'explicit editInline: false wins over a stored inlineEdit: true',
      input: { inlineEdit: true, userActions: { editInline: false } },
      editInline: false, inlineEdit: true, byReference: true,
    },
    {
      name: 'explicit editInline: true wins over a stored inlineEdit: false',
      input: { inlineEdit: false, userActions: { editInline: true } },
      editInline: true, inlineEdit: false, byReference: true,
    },
    { name: 'explicit editInline alone is left as declared', input: { userActions: { editInline: true } }, editInline: true, inlineEdit: undefined, byReference: true },
    { name: 'a non-boolean inlineEdit is not a value and does not fold', input: { inlineEdit: 'yes' }, editInline: undefined, inlineEdit: 'yes' as never, byReference: true },
  ];

  it('covers a non-empty table', () => {
    expect(TABLE.length).toBe(7);
  });

  for (const row of TABLE) {
    it(row.name, () => {
      const input = { ...BASE, ...row.input };
      const out = fold(input);
      expect(editInlineOf(out)).toBe(row.editInline);
      expect(out.inlineEdit).toBe(row.inlineEdit);
      // Returned by reference when there is nothing to fold, so `ListView`'s
      // `useMemo`s keep a stable dependency on the already-canonical path.
      expect(out === input).toBe(row.byReference);
    });
  }

  it('keeps the other `userActions` toggles, and does not mutate its input', () => {
    const input = { ...BASE, inlineEdit: true, userActions: { search: false, hideFields: true } };
    const out = fold(input);
    expect(out.userActions).toEqual({ search: false, hideFields: true, editInline: true });
    expect(input.userActions).toEqual({ search: false, hideFields: true });
  });

  it('folds in the same pass as the legacy `show*` flags, and keeps only inlineEdit', () => {
    const out = fold({ ...BASE, inlineEdit: true, showSearch: false, showHideFields: true });
    expect(out.userActions).toEqual({ search: false, hideFields: true, editInline: true });
    // The `show*` rows are deleted after they fold. `inlineEdit` is not.
    expect('showSearch' in out).toBe(false);
    expect('showHideFields' in out).toBe(false);
    expect(out.inlineEdit).toBe(true);
  });

  it('the folded document is spec-valid, `editInline` and `inlineEdit` both', () => {
    // Both keys are the spec's: `ListView.inlineEdit` and
    // `userActions.editInline`. `viewType` is objectui's own spelling and is
    // scoped out, as in `normalize-list-view.foldOutputAuthorable-5435.test.ts`.
    const out = fold({ name: 'tasks', label: 'Tasks', type: 'grid', columns: [{ field: 'title' }], inlineEdit: true });
    expect(editInlineOf(out)).toBe(true);
    const { viewType: _viewType, ...specSpelled } = out;
    const result = SpecListViewSchema.safeParse(specSpelled);
    expect(result.success).toBe(true);
    expect(result.error?.issues ?? []).toEqual([]);
  });
});
