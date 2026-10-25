/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dropping a card into a column whose value makes fields REQUIRED
 * (`requiredWhen`) collects them instead of dead-ending — objectui#4254.
 *
 * ── The card's repro, as a board ──────────────────────────────────────────
 * HotCRM's opportunity pipeline declares
 *
 *   win_reason: Field.select({ requiredWhen: P`has(record.stage) && record.stage == "closed_won"` })
 *
 * and dragging a deal into **Closed Won** PATCHed `{stage}` ALONE. The engine
 * refuses (`Win Reason 不能为空`) and the board had no way to finish the move:
 * the only path to closing a deal was to abandon the board for the record form.
 *
 * The approved shape (maintainer, 2026-08-12) is pre-evaluation: BEFORE the
 * PATCH, evaluate the target column's `requiredWhen` predicates against the
 * record with the target value applied; if that makes fields required and they
 * are empty, collect them in a small dialog and submit stage + collected
 * fields in ONE PATCH.
 *
 * ── Direction of each case, predicted BEFORE running against unfixed code ─
 *  1. dialog appears on a triggering drop      → RED pre-fix (no dialog exists)
 *  2. no PATCH is issued while collecting      → RED pre-fix (`{stage}` goes out
 *                                                immediately)
 *  3. submit sends ONE combined PATCH          → RED pre-fix (no dialog to submit)
 *  4. cancel sends NO PATCH, card stays put    → RED pre-fix (PATCH already went)
 *  5. a NON-triggering drop is byte-identical  → GREEN before and after. The pin
 *                                                that the feature is inert off
 *                                                its trigger.
 *  6. a required field that already HAS a value → GREEN before and after. Empty
 *     is half the predicate; a filled field must not be re-asked.
 *  7. a required-and-empty field with NO edit widget (`file`) falls through to
 *     today's PATCH → GREEN before and after. We collect only what we can
 *     honestly render; everything else keeps the server's legible refusal
 *     (objectstack#7525 is closed) rather than showing an empty dialog row.
 *  8. the dialog renders the FORM's own widget for the field's type
 *                                              → RED pre-fix (no dialog)
 *
 * Cases 5-7 are the controls: they are the reason a red in 1-4 is the feature
 * and not the harness mis-driving the board.
 *
 * ── Harness ───────────────────────────────────────────────────────────────
 * Same shape as `ObjectKanban.rejectedMoveRollback.test.tsx` (#4138): dnd-kit's
 * pointer sensors need layout and pointer-capture jsdom does not provide, so
 * the board's real `onDragEnd` is captured from a wrapping `DndContext` and
 * called with a synthesized drop. Everything downstream — `KanbanImpl`'s local
 * move, `ObjectKanban`'s pre-evaluation, the dialog, the PATCH — is production
 * code.
 *
 * **No `I18nProvider` is mounted here, deliberately** (objectui#4514):
 * `initReactI18next` registers its instance as react-i18next's module-global
 * default and that registration outlives `cleanup()`, so one provider mount
 * would silently re-point every later assertion in this file. The copy asserted
 * below is therefore the English fallback path, which is also what a
 * provider-less host (preview gallery, embedding app) reads.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import type { DataSource, ObjectKanbanSchema } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time rather than racing it against a
// `findBy` budget (AGENTS.md §测试纪律); specifier byte-identical to `./index`'s
// so the component's own `React.lazy` factory resolves from the ESM cache.
import './KanbanImpl';

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as undefined | ((event: unknown) => void),
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const ReactMod = await import('react');
  const CapturingDndContext = (props: Record<string, unknown>) => {
    dnd.onDragEnd = props.onDragEnd as (event: unknown) => void;
    return ReactMod.createElement(actual.DndContext, props as never);
  };
  return { ...actual, DndContext: CapturingDndContext };
});

registerAllFields();

/** The card's own predicate shape: `has()` + `==` + `&&`. */
const WIN_REASON_REQUIRED = 'has(record.stage) && record.stage == "closed_won"';

const DEAL = 'Acme renewal';

function objectDef(winReason: Record<string, unknown>) {
  return {
    name: 'opportunity',
    fields: {
      name: { type: 'text', label: 'Name' },
      stage: {
        type: 'picklist',
        label: 'Stage',
        options: [
          { value: 'negotiation', label: 'Negotiation' },
          { value: 'closed_won', label: 'Closed Won' },
        ],
      },
      win_reason: { label: 'Win Reason', ...winReason },
    },
  };
}

/** A plain text field — drivable in jsdom without a Radix portal dance. */
const TEXT_WIN_REASON = { type: 'text', requiredWhen: WIN_REASON_REQUIRED };

const schema = {
  type: 'object-kanban',
  objectName: 'opportunity',
  groupBy: 'stage',
  cardTitle: 'name',
  columns: [
    { id: 'negotiation', title: 'Negotiation' },
    { id: 'closed_won', title: 'Closed Won' },
  ],
} satisfies ObjectKanbanSchema;

const records = (winReason: unknown = null) => [
  { id: 'o1', name: DEAL, stage: 'negotiation', win_reason: winReason },
];

function makeDataSource(def: unknown, update: DataSource['update']): DataSource {
  return {
    getObjectSchema: vi.fn(async () => def),
    find: vi.fn(async () => ({ value: records() })),
    update,
  } as unknown as DataSource;
}

function cardsIn(columnTitle: string): string[] {
  const list = screen.getByRole('list', { name: `${columnTitle} cards` });
  return within(list)
    .queryAllByRole('listitem')
    .map((el) => el.getAttribute('aria-label') ?? '');
}

async function mountBoard(
  dataSource: DataSource,
  data = records(),
  startColumn = 'Negotiation',
) {
  render(<ObjectKanban schema={schema} dataSource={dataSource} data={data} />);
  expect(await screen.findByText(DEAL)).toBeInTheDocument();
  // Flush the object-def fetch — the pre-evaluation reads `objectDef.fields`,
  // and a drop before it lands would measure the absence of metadata rather
  // than the feature.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Settle on the column the record's own `stage` puts it in — not always the
  // first one, since one case starts the card in Closed Won so it can drag the
  // NON-triggering direction.
  await waitFor(() => expect(cardsIn(startColumn)).toEqual([DEAL]));
}

async function dropOn(columnId: string) {
  expect(dnd.onDragEnd).toBeTypeOf('function');
  await act(async () => {
    dnd.onDragEnd!({ active: { id: 'o1' }, over: { id: columnId } });
  });
}

beforeEach(() => {
  dnd.onDragEnd = undefined;
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectKanban — a drop that makes fields required collects them (#4254)', () => {
  it('opens a dialog listing exactly the required-and-empty fields', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    await mountBoard(makeDataSource(objectDef(TEXT_WIN_REASON), update as never));

    await dropOn('closed_won');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Complete required fields')).toBeInTheDocument();
    expect(within(dialog).getByText('Win Reason')).toBeInTheDocument();
    // Only the field the move made required — `name` is empty of a predicate,
    // `stage` is the thing being set.
    expect(within(dialog).queryByText('Name')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Stage')).not.toBeInTheDocument();
  });

  it('issues NO PATCH while the dialog is collecting', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    await mountBoard(makeDataSource(objectDef(TEXT_WIN_REASON), update as never));

    await dropOn('closed_won');

    // Asserted BEFORE the dialog is looked for, on purpose: this is the issue's
    // actual defect, so its red must land here and not on a missing dialog.
    // Pre-fix this reads `{ stage: 'closed_won' }` — the lone PATCH the engine
    // refuses for the field nobody was ever asked about.
    expect(update).not.toHaveBeenCalled();

    // The whole point of pre-evaluation: the refusal never happens because the
    // request that would be refused is never sent.
    await screen.findByRole('dialog');
    expect(update).not.toHaveBeenCalled();
  });

  it('submits stage + collected fields in ONE combined PATCH', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    await mountBoard(makeDataSource(objectDef(TEXT_WIN_REASON), update as never));

    await dropOn('closed_won');
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Beat the incumbent on price' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move card' }));
    });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('opportunity', 'o1', {
      stage: 'closed_won',
      win_reason: 'Beat the incumbent on price',
    });
  });

  it('cancel sends NO PATCH and leaves the card in its original column', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    await mountBoard(makeDataSource(objectDef(TEXT_WIN_REASON), update as never));

    await dropOn('closed_won');
    const dialog = await screen.findByRole('dialog');

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    });

    expect(update).not.toHaveBeenCalled();
    await waitFor(() => expect(cardsIn('Negotiation')).toEqual([DEAL]));
    expect(cardsIn('Closed Won')).toEqual([]);
    expect(screen.getAllByRole('listitem', { name: DEAL })).toHaveLength(1);
  });

  it('renders the FORM’s own widget for the field type (a select edits as a select)', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    const def = objectDef({
      type: 'select',
      requiredWhen: WIN_REASON_REQUIRED,
      options: [
        { value: 'price', label: 'Better price' },
        { value: 'features', label: 'Better features' },
      ],
    });
    await mountBoard(makeDataSource(def, update as never));

    await dropOn('closed_won');
    const dialog = await screen.findByRole('dialog');

    // `SelectField`'s trigger — the same control the record form renders for a
    // select, reached through `FieldEditWidget`, not a parallel mini-form.
    expect(within(dialog).getByRole('combobox')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  // ── Controls: green before AND after ────────────────────────────────────

  it('PIN: a drop that triggers no predicate PATCHes {stage} alone, no dialog', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    await mountBoard(
      makeDataSource(objectDef(TEXT_WIN_REASON), update as never),
      [{ id: 'o1', name: DEAL, stage: 'closed_won', win_reason: 'Already won' }],
      'Closed Won',
    );

    await dropOn('negotiation');

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('opportunity', 'o1', { stage: 'negotiation' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('PIN: a required field that already HAS a value is not re-asked', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    await mountBoard(
      makeDataSource(objectDef(TEXT_WIN_REASON), update as never),
      records('Existing reason'),
    );

    await dropOn('closed_won');

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('opportunity', 'o1', { stage: 'closed_won' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('PIN: a required field with no edit widget falls through to today’s PATCH', async () => {
    const update = vi.fn(async () => ({ id: 'o1' }));
    // `file` is in `INLINE_EXCLUDED_FIELD_TYPES` — there is no honest control to
    // put in the dialog, so the move keeps the old behaviour and the server's
    // (now legible) refusal is what the user sees.
    const def = objectDef({ type: 'file', requiredWhen: WIN_REASON_REQUIRED });
    await mountBoard(makeDataSource(def, update as never));

    await dropOn('closed_won');

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('opportunity', 'o1', { stage: 'closed_won' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
