/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The NON-grid selection bar (kanban / calendar / gallery / …), which ListView
 * renders itself, honours `userActions.delete.visibleWhen` PER SELECTED RECORD
 * (objectui#4420). The grid path delegates to ObjectGrid, whose own bar is
 * pinned in `plugin-grid/src/__tests__/bulkDeleteVisibleWhen.test.tsx`.
 *
 * `permittedBulkActions` read that key as a bare BOOLEAN — the object-level
 * verdict (bucket ∧ `userActions` ∧ `apiOperations` ∧ the principal's
 * `allowDelete`) — and had no per-record layer at all. Since objectui#2614 the
 * key also accepts `{ enabled?, visibleWhen?, disabledWhen? }`, whose
 * `visibleWhen` gates the affordance per record; the row kebab honoured it and
 * this bar did not.
 *
 * ## The ruled behaviour (maintainer, 2026-08-17 — behaviour 1 of three)
 *
 * Filter the operation and report the skipped. The button is **never hidden or
 * disabled** by the predicate (behaviour 2, rejected: one stray tick would
 * disable the whole bar) and the predicate is **not** declared out of scope for
 * set operations (behaviour 3, rejected: the key must not mean different things
 * on two surfaces).
 *
 * ## The fixture, and which row is the excluded one
 *
 * The card's repro verbatim: `showcase_invoice` declares
 * `delete: { visibleWhen: "record.status != 'paid'" }`. **`INV-1011` is the
 * excluded row** — the one with `status: 'paid'`. The all-eligible case is a
 * deliberate DEGENERATE CONTROL: its fixture has no excluded row, so it passes
 * against the unfixed code too.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const OBJECT = 'showcase_invoice';

/** `INV-1011` is paid — the row `visibleWhen` excludes. */
const PAID = { id: 'inv-1011', name: 'INV-1011', status: 'paid' };
/** `INV-1010` is a draft — the row `visibleWhen` admits. */
const DRAFT = { id: 'inv-1010', name: 'INV-1010', status: 'draft' };

/**
 * The OBJECT's `userActions` block (the CRUD-predicate vocabulary), not the
 * VIEW's same-named toolbar block — the name collision `toolbarFlags` is
 * pinned against.
 */
const DELETE_VISIBLE_WHEN = { visibleWhen: "record.status != 'paid'" };

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'gallery',
  fields: ['name', 'status'],
  bulkActions: ['delete', 'archive'] as any,
};

function makeDataSource(userActionsDelete?: unknown) {
  return {
    find: vi.fn().mockResolvedValue([{ ...DRAFT }, { ...PAID }]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'text' },
      },
      ...(userActionsDelete === undefined ? {} : { userActions: { delete: userActionsDelete } }),
    }),
  };
}

/**
 * Stand in for the gallery renderer and select the given rows as soon as it
 * mounts — the bulk bar only renders with a non-empty selection, and driving
 * the real gallery's selection UI would couple this assertion to that
 * component's markup. (Same device as `ListView.permissions.test.tsx`.)
 */
function registerSelectingGallery(rows: Array<Record<string, unknown>>) {
  ComponentRegistry.register('object-gallery', (props: any) => {
    const onRowSelect = props.onRowSelect;
    React.useEffect(() => {
      onRowSelect?.(rows);
    }, [onRowSelect]);
    return <div data-testid="gallery-stub" />;
  });
}

function renderGalleryBulk(opts: {
  selected: Array<Record<string, unknown>>;
  userActionsDelete?: unknown;
}) {
  const onBulkAction = vi.fn();
  const dataSource = makeDataSource(opts.userActionsDelete);
  registerSelectingGallery(opts.selected);
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <ListView schema={schema} dataSource={dataSource as any} onBulkAction={onBulkAction} />
    </SchemaRendererProvider>,
  );
  return { onBulkAction, dataSource };
}

/** Ids the bar handed to the runner for the given action. */
function dispatchedIds(onBulkAction: ReturnType<typeof vi.fn>, action: string): string[] {
  const call = onBulkAction.mock.calls.find(c => c[0] === action);
  expect(call, `no dispatch recorded for '${action}'`).toBeDefined();
  return (call![1] as Array<{ id: string }>).map(r => r.id);
}

describe('ListView non-grid bulk Delete vs `userActions.delete.visibleWhen` (objectui#4420)', () => {
  let prevGallery: ReturnType<typeof ComponentRegistry.get>;

  beforeEach(() => {
    vi.clearAllMocks();
    prevGallery = ComponentRegistry.get('object-gallery');
  });

  afterEach(() => {
    cleanup();
    if (prevGallery) ComponentRegistry.register('object-gallery', prevGallery);
    else ComponentRegistry.unregister('object-gallery');
  });

  it('ALL-ELIGIBLE: dispatches the whole selection, reports nothing — the degenerate control', async () => {
    // No excluded row in this fixture, so this case passes against the unfixed
    // code as well. It pins that an all-eligible selection is untouched.
    const { onBulkAction } = renderGalleryBulk({
      selected: [DRAFT, { id: 'inv-1012', name: 'INV-1012', status: 'draft' }],
      userActionsDelete: DELETE_VISIBLE_WHEN,
    });
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument());

    expect(screen.queryByTestId('bulk-skipped-notice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bulk-action-delete'));
    expect(dispatchedIds(onBulkAction, 'delete')).toEqual(['inv-1010', 'inv-1012']);
  });

  it('MIXED: dispatches only the allowed subset AND reports the skipped row', async () => {
    const { onBulkAction } = renderGalleryBulk({
      selected: [DRAFT, PAID],
      userActionsDelete: DELETE_VISIBLE_WHEN,
    });
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());

    // Half one — the excluded row is REPORTED. This bar dispatches straight
    // through `onBulkAction` and never opens `BulkActionDialog`, so it carries
    // the notice itself, under the dialog slot's own name.
    const notice = await screen.findByTestId('bulk-skipped-notice');
    expect(notice).toHaveTextContent('1');

    // Half two — the allowed subset, and only it. `INV-1011` is the excluded
    // row; before this fix it was handed to the runner along with the draft.
    fireEvent.click(screen.getByTestId('bulk-action-delete'));
    expect(dispatchedIds(onBulkAction, 'delete')).toEqual(['inv-1010']);

    // Scope control: a custom id is NOT filtered — it routes through the action
    // runner carrying its own gates, so it still sees the whole selection.
    fireEvent.click(screen.getByTestId('bulk-action-archive'));
    expect(dispatchedIds(onBulkAction, 'archive')).toEqual(['inv-1010', 'inv-1011']);
  });

  it('NONE-ELIGIBLE: the button still renders and is not disabled, and the bar says why', async () => {
    // The card's repro exactly: tick ONLY the paid invoice.
    const { onBulkAction } = renderGalleryBulk({
      selected: [PAID],
      userActionsDelete: DELETE_VISIBLE_WHEN,
    });
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());

    // Ruled: never hidden, never disabled by the predicate — behaviour 2 was
    // rejected precisely so one stray tick cannot take the bar away.
    const button = await screen.findByTestId('bulk-action-delete');
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    // …and the refusal is legible before the click, not a silent no-op after it.
    expect(screen.getByTestId('bulk-skipped-notice')).toHaveTextContent('1');

    fireEvent.click(button);
    expect(dispatchedIds(onBulkAction, 'delete')).toEqual([]);
  });

  it('an object declaring NO per-record gate keeps the whole selection', async () => {
    // Control group for the fold itself: with no `visibleWhen` the partition is
    // a no-op, so the paid invoice is dispatched like any other row. This is
    // what makes the exclusions above attributable to the predicate rather than
    // to some new blanket filter.
    const { onBulkAction } = renderGalleryBulk({ selected: [DRAFT, PAID] });
    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());

    expect(screen.queryByTestId('bulk-skipped-notice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bulk-action-delete'));
    expect(dispatchedIds(onBulkAction, 'delete')).toEqual(['inv-1010', 'inv-1011']);
  });

  // [objectui#11322] A BLANK `visibleWhen` keeps the fold's answer here: every
  // selected record is excluded, as before. That card made a blank bulk ACTION
  // `visible` "no gate" by asking the action family's definition before the
  // fold; this key is a field-rule key and reaches the fold directly, so its
  // blank does not widen into "delete everything". The no-gate case above is
  // the control.
  it.each([
    ['a whitespace-only string', '   '],
    ['an envelope whose `source` is whitespace', { dialect: 'cel', source: '   ' }],
  ])('a blank `visibleWhen` (%s) still excludes every record (objectui#11322)', async (_label, visibleWhen) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The draft alone: a row the real predicate above would admit.
      const { onBulkAction } = renderGalleryBulk({ selected: [DRAFT], userActionsDelete: { visibleWhen } });
      await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());

      expect(await screen.findByTestId('bulk-skipped-notice')).toHaveTextContent('1');
      fireEvent.click(screen.getByTestId('bulk-action-delete'));
      expect(dispatchedIds(onBulkAction, 'delete')).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
