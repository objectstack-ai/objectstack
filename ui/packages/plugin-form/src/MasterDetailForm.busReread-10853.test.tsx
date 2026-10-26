/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10853 — an `object-master-detail-form` in edit mode re-reads its
 * detail lines when the data-invalidation bus (`notifyDataChanged` from
 * `@object-ui/react`) reports a change to a collection's CHILD object, in place.
 *
 * A stored page can hold this block with `mode: 'edit'` and an authored
 * `recordId`. Before this card the lines were read only when the record, the
 * adapter or the resolved details changed, so after a page action over raw
 * HTTP the header re-read (its own `<ObjectForm>`, objectui#10572) while the
 * lines kept the pre-action rows until the host remounted the form, and
 * `PageView`'s remount is what objectui#10519 removes.
 *
 * Unsaved lines follow the objectui#10712 R3 / objectui#10572 rule per
 * collection: the re-read is HELD while the collection holds lines the user
 * has not saved, and replayed once after a revert or after the save lands.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration, with the real line-item grid. Reads answer at once until a
 * case holds them, so the case can look at the form while a re-read is in
 * flight. The bare `useDataInvalidation` reader beside the form is the
 * positive control: it proves the event reached subscribers.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
// Registers `object-master-detail-form` and `object-form` through this package's own entry.
import './index';

registerAllFields();

type Row = Record<string, any>;

const SCHEMAS: Record<string, unknown> = {
  po: { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } },
  po_line: {
    name: 'po_line',
    fields: {
      label: { type: 'text', label: 'Line' },
      memo: { type: 'text', label: 'Memo' },
      po: { type: 'master_detail', label: 'PO', reference: 'po' },
    },
  },
  po_note: {
    name: 'po_note',
    fields: { text: { type: 'text', label: 'Note' }, po: { type: 'master_detail', label: 'PO', reference: 'po' } },
  },
};

interface HeldRead {
  objectName: string;
  query: any;
  resolve: (value: unknown) => void;
}

function makeDataSource(stored: Record<string, Row[]>) {
  const held: HeldRead[] = [];
  const state = { hold: false };
  let minted = 0;
  const dataSource = {
    getObjectSchema: vi.fn(async (objectName: string) => SCHEMAS[objectName] ?? null),
    findOne: vi.fn(async () => ({ id: 'po1', ref: 'PO-1' })),
    find: vi.fn((objectName: string, query: any) => {
      if (state.hold) {
        return new Promise((resolve) => {
          held.push({ objectName, query, resolve });
        });
      }
      return Promise.resolve({ data: (stored[objectName] ?? []).map((r) => ({ ...r })) });
    }),
    // Answers per the `batchTransaction` contract and writes through to the
    // store, so a later read returns what the save wrote.
    batchTransaction: vi.fn(async (ops: Array<{ object: string; action?: string; id?: string; data?: Row }>) => ({
      results: ops.map((op) => {
        const rows = (stored[op.object] ??= []);
        if (op.action === 'create') {
          const created = { id: `new${++minted}`, ...op.data };
          rows.push(created);
          return created;
        }
        if (op.action === 'delete') {
          stored[op.object] = rows.filter((r) => r.id !== op.id);
          return true;
        }
        const at = rows.findIndex((r) => r.id === op.id);
        if (at >= 0) rows[at] = { ...rows[at], ...op.data };
        return { id: op.id, ...op.data };
      }),
    })),
  };
  return { dataSource, held, state };
}

const PO_LINE_DETAIL = {
  childObject: 'po_line',
  relationshipField: 'po',
  title: 'Lines',
  columns: [{ name: 'label', label: 'Line', type: 'text' }],
};
const PO_NOTE_DETAIL = {
  childObject: 'po_note',
  relationshipField: 'po',
  title: 'Notes',
  columns: [{ name: 'text', label: 'Note', type: 'text' }],
};

/** The block as a stored page holds it: edit mode, an authored parent, no record context. */
const formNode = (details: unknown[]) => ({
  type: 'object-master-detail-form',
  objectName: 'po',
  mode: 'edit',
  recordId: 'po1',
  fields: ['ref'],
  details,
});

/** The positive control: a bare reader of the child object, beside the form. */
function BusControl() {
  const nonce = useDataInvalidation('po_line');
  return <span data-testid="bus-control">{nonce}</span>;
}

const renderNode = (node: unknown, ds: unknown) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <SchemaRenderer schema={node as any} />
    </SchemaRendererProvider>,
  );

async function settle(fn: () => void = () => {}) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}
const emit = (change: { objectName: string; recordId?: string }) => settle(() => notifyDataChanged(change));
const answer = (read: HeldRead, rows: Row[]) => settle(() => read.resolve({ data: rows }));

const reads = (ds: { find: { mock: { calls: any[][] } } }, objectName: string) =>
  ds.find.mock.calls.filter((c) => c[0] === objectName).length;

/**
 * A collection's line inputs; the grid always trails one blank entry row. The
 * row editor's own fields carry the same labels, so they are left out.
 */
const inputsOf = (label: string) =>
  (screen.queryAllByLabelText(label) as HTMLInputElement[]).filter((el) => !el.closest('[data-testid="md-row-form"]'));
const shown = (label: string) => inputsOf(label).map((i) => i.value).filter((v) => v !== '');
const saveButton = () => screen.getByTestId('md-form-submit') as HTMLButtonElement;
const change = (el: HTMLElement, value: string) => settle(() => fireEvent.change(el, { target: { value } }));

async function mount(details: unknown[] = [PO_LINE_DETAIL], seed?: Record<string, Row[]>) {
  const stored = seed ?? {
    po_line: [{ id: 'l1', label: 'first', po: 'po1' }],
    po_note: [{ id: 'n1', text: 'note one', po: 'po1' }],
  };
  const ds = makeDataSource(stored);
  const view = renderNode(formNode(details), ds.dataSource);
  await waitFor(() => {
    const ref = view.container.querySelector('input[name="ref"]') as HTMLInputElement | null;
    expect(ref?.value).toBe('PO-1');
  });
  await waitFor(() => expect(shown('Line')).toEqual(stored.po_line.map((r) => r.label)));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  // Let every read the mount issued settle, so a count taken now is at rest.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return { ...ds, view, stored };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('object-master-detail-form (edit) re-reads its lines on the data-invalidation bus (objectui#10853)', () => {
  it('an unscoped change ("*") re-reads the lines once, in place, and moves the save baseline with them', async () => {
    const { dataSource, held, state } = await mount();
    const atRest = reads(dataSource, 'po_line');
    const firstInput = inputsOf('Line')[0];
    state.hold = true;

    await emit({ objectName: '*' });

    expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    await waitFor(() =>
      expect(reads(dataSource, 'po_line'), 'the lines never re-read after the bus reported a change').toBe(atRest + 1),
    );
    const lineRead = held.find((r) => r.objectName === 'po_line')!;
    expect(lineRead.query.$filter).toEqual({ po: 'po1' });
    // In flight: the lines on screen stay drawn, in the same grid.
    expect(shown('Line'), 'the re-read blanked the lines').toEqual(['first']);
    expect(inputsOf('Line')[0], 'the re-read unmounted the grid').toBe(firstInput);
    expect(screen.queryByText('Loading columns…')).toBeNull();

    await answer(lineRead, [
      { id: 'l1', label: 'first (renamed)', po: 'po1' },
      { id: 'l2', label: 'second', po: 'po1' },
    ]);
    await waitFor(() => expect(shown('Line')).toEqual(['first (renamed)', 'second']));
    expect(inputsOf('Line')[0], 'the grid was remounted by the re-read').toBe(firstInput);

    // The baseline moved with the rows: a save with no edit writes no line.
    state.hold = false;
    await settle(() => fireEvent.click(saveButton()));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<{ object: string }>;
    expect(ops.filter((op) => op.object === 'po_line'), 'the re-read left its rows unsaved against the old baseline').toEqual([]);
  });

  it('a change to the child object re-reads the lines once; an unrelated object does not', async () => {
    const { dataSource } = await mount();
    const atRest = reads(dataSource, 'po_line');

    await emit({ objectName: 'unrelated_object' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(reads(dataSource, 'po_line'), 'a change to another object re-read the lines').toBe(atRest);

    await emit({ objectName: 'po_line', recordId: 'l1' });
    await waitFor(() => expect(reads(dataSource, 'po_line')).toBe(atRest + 1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(reads(dataSource, 'po_line'), 'one change re-read the lines more than once').toBe(atRest + 1);
  });

  it('each collection answers to its own child object; "*" re-reads every collection', async () => {
    const { dataSource } = await mount([PO_LINE_DETAIL, PO_NOTE_DETAIL]);
    await waitFor(() => expect(shown('Note')).toEqual(['note one']));
    const lines = reads(dataSource, 'po_line');
    const notes = reads(dataSource, 'po_note');

    await emit({ objectName: 'po_note' });
    await waitFor(() => expect(reads(dataSource, 'po_note')).toBe(notes + 1));
    expect(reads(dataSource, 'po_line'), 'a change to the notes re-read the lines').toBe(lines);

    await emit({ objectName: '*' });
    await waitFor(() => expect(reads(dataSource, 'po_line')).toBe(lines + 1));
    await waitFor(() => expect(reads(dataSource, 'po_note')).toBe(notes + 2));
  });

  it('unsaved lines HOLD the re-read; a revert replays it once', async () => {
    const { dataSource, held, state } = await mount();
    const atRest = reads(dataSource, 'po_line');
    await change(inputsOf('Line')[0], 'first edited');

    await emit({ objectName: 'po_line' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(reads(dataSource, 'po_line'), 'a bus re-read ran over unsaved lines').toBe(atRest);
    expect(shown('Line'), 'the unsaved line was discarded').toEqual(['first edited']);

    state.hold = true;
    await change(inputsOf('Line')[0], 'first');
    await waitFor(() => expect(reads(dataSource, 'po_line'), 'the revert did not replay the held re-read').toBe(atRest + 1));
    await answer(held[0], [{ id: 'l1', label: 'first (server)', po: 'po1' }]);
    await waitFor(() => expect(shown('Line')).toEqual(['first (server)']));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(reads(dataSource, 'po_line'), 'the held re-read was replayed more than once').toBe(atRest + 1);
  });

  it('unsaved lines HOLD the re-read; the save landing replays it once', async () => {
    const { dataSource } = await mount();
    const atRest = reads(dataSource, 'po_line');
    await change(inputsOf('Line')[0], 'first edited');

    await emit({ objectName: '*' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(reads(dataSource, 'po_line'), 'a bus re-read ran over unsaved lines').toBe(atRest);

    await settle(() => fireEvent.click(saveButton()));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<{ object: string; data?: Row }>;
    expect(ops.find((op) => op.object === 'po_line')?.data).toEqual({ label: 'first edited' });
    await waitFor(() => expect(reads(dataSource, 'po_line'), 'the save did not replay the held re-read').toBe(atRest + 1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await waitFor(() => expect(shown('Line')).toEqual(['first edited']));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(reads(dataSource, 'po_line'), 'the held re-read was replayed more than once').toBe(atRest + 1);
  });

  it('a line edited while a re-read is in flight is kept; the re-read is held behind it', async () => {
    const { dataSource, held, state } = await mount();
    const atRest = reads(dataSource, 'po_line');
    state.hold = true;

    await emit({ objectName: '*' });
    await waitFor(() => expect(reads(dataSource, 'po_line')).toBe(atRest + 1));
    await change(inputsOf('Line')[0], 'typed in flight');
    await answer(held.find((r) => r.objectName === 'po_line')!, [{ id: 'l1', label: 'from server', po: 'po1' }]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(shown('Line'), 'the re-read overwrote a line typed while it was in flight').toEqual(['typed in flight']);
    expect(reads(dataSource, 'po_line'), 're-read again over the unsaved line').toBe(atRest + 1);
  });

  it('`object-form` with `subforms` (routed to the same form) re-reads its lines too', async () => {
    const ds = makeDataSource({ po_line: [{ id: 'l1', label: 'first', po: 'po1' }] });
    const view = renderNode(
      { type: 'object-form', objectName: 'po', mode: 'edit', recordId: 'po1', fields: ['ref'], subforms: [PO_LINE_DETAIL] },
      ds.dataSource,
    );
    await waitFor(() => expect((view.container.querySelector('input[name="ref"]') as HTMLInputElement | null)?.value).toBe('PO-1'));
    await waitFor(() => expect(shown('Line')).toEqual(['first']));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const atRest = reads(ds.dataSource, 'po_line');

    await emit({ objectName: '*' });
    await waitFor(() => expect(reads(ds.dataSource, 'po_line')).toBe(atRest + 1));
  });

  it('control: create mode reads no lines, on mount or on an invalidation', async () => {
    const ds = makeDataSource({ po_line: [{ id: 'l1', label: 'first', po: 'po1' }] });
    renderNode({ ...formNode([PO_LINE_DETAIL]), mode: 'create', recordId: undefined }, ds.dataSource);
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    await emit({ objectName: '*' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(reads(ds.dataSource, 'po_line')).toBe(0);
  });
});

/**
 * objectui#10853, patch round (contract review of ac526b1) — the row editor
 * ("Open row", offered in grid mode when `formFields` outnumber `columns`) keeps
 * the user's draft in its own form, not in the collection's rows, so the rows
 * alone cannot say the collection is being edited. While the editor is open on
 * a collection, that collection's bus re-read is HELD, exactly as for unsaved
 * grid lines, and it is replayed through the same path once the editor closes
 * and the lines read as saved. The editor is neither reset, re-keyed nor
 * disabled by a bus event.
 */
const EDITOR_DETAIL = {
  childObject: 'po_line',
  relationshipField: 'po',
  title: 'Lines',
  columns: [{ name: 'label', label: 'Line', type: 'text' }],
  formFields: ['label', 'memo'],
};
const TWO_LINES = () => ({
  po_line: [
    { id: 'l1', label: 'first', memo: 'memo one', po: 'po1' },
    { id: 'l2', label: 'second', memo: 'memo two', po: 'po1' },
  ],
});

const editor = () => screen.queryByTestId('md-row-form');
const editorInput = (name: string) => editor()?.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
const editorButton = (text: string) =>
  Array.from(editor()?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;

async function openRow(index: number, label: string) {
  await settle(() => fireEvent.click(screen.getAllByLabelText('Open row')[index]));
  await waitFor(() => expect(editorInput('label')?.value).toBe(label));
}
async function draft(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    await change(editorInput(name)!, value);
    await waitFor(() => expect(editorInput(name)?.value).toBe(value));
  }
}
const pause = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

describe('object-master-detail-form (edit): an open row editor holds its collection’s bus re-read (objectui#10853)', () => {
  it('a bus event that rewrites the line under the editor: the draft is kept, Apply writes that line, the held re-read replays once after the save', async () => {
    const { dataSource, stored } = await mount([EDITOR_DETAIL], TWO_LINES());
    await waitFor(() => expect(shown('Line')).toEqual(['first', 'second']));
    const atRest = reads(dataSource, 'po_line');
    await openRow(0, 'first');
    await draft({ label: 'first (draft)', memo: 'memo draft' });

    stored.po_line[0] = { ...stored.po_line[0], label: 'first (server)', memo: 'memo server' };
    await emit({ objectName: 'po_line', recordId: 'l1' });
    await pause();

    expect(editorInput('label')?.value, 'the re-read reset the editor’s draft').toBe('first (draft)');
    expect(editorInput('memo')?.value, 'the re-read reset the editor’s draft').toBe('memo draft');
    expect(reads(dataSource, 'po_line'), 'a bus re-read ran under an open row editor').toBe(atRest);

    await settle(() => fireEvent.click(editorButton('Apply')!));
    await waitFor(() => expect(editor()).toBeNull());
    expect(shown('Line'), 'Apply did not write the line it was opened on').toEqual(['first (draft)', 'second']);
    await pause();
    // The applied line is unsaved, so the re-read stays held behind it.
    expect(reads(dataSource, 'po_line'), 'the re-read ran over the applied, unsaved line').toBe(atRest);

    await settle(() => fireEvent.click(saveButton()));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<{ object: string; action?: string; id?: string; data?: Row }>;
    expect(ops.filter((op) => op.object === 'po_line')).toEqual([
      { object: 'po_line', action: 'update', id: 'l1', data: { label: 'first (draft)', memo: 'memo draft' } },
    ]);
    await waitFor(() => expect(reads(dataSource, 'po_line'), 'the save did not replay the held re-read').toBe(atRest + 1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await pause();
    expect(reads(dataSource, 'po_line'), 'the held re-read was replayed more than once').toBe(atRest + 1);
  });

  it('the server drops the line under the editor: the draft is kept and Apply writes the line it was opened on, not its neighbour', async () => {
    const { dataSource, stored } = await mount([EDITOR_DETAIL], TWO_LINES());
    await waitFor(() => expect(shown('Line')).toEqual(['first', 'second']));
    const atRest = reads(dataSource, 'po_line');
    await openRow(0, 'first');
    await draft({ label: 'first (draft)' });

    stored.po_line = stored.po_line.filter((r) => r.id !== 'l1');
    await emit({ objectName: '*' });
    await pause();

    expect(editorInput('label')?.value, 'the re-read reset the editor to another line').toBe('first (draft)');
    expect(reads(dataSource, 'po_line'), 'a bus re-read ran under an open row editor').toBe(atRest);

    await settle(() => fireEvent.click(editorButton('Apply')!));
    await waitFor(() => expect(editor()).toBeNull());
    expect(shown('Line'), 'Apply wrote onto another line').toEqual(['first (draft)', 'second']);

    await settle(() => fireEvent.click(saveButton()));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<{ object: string; id?: string }>;
    expect(ops.filter((op) => op.object === 'po_line').map((op) => op.id), 'the edit was sent to another line').toEqual(['l1']);
    // After the save the held re-read replays once and shows what the server holds.
    await waitFor(() => expect(reads(dataSource, 'po_line')).toBe(atRest + 1));
    await waitFor(() => expect(shown('Line')).toEqual(['second']));
  });

  it('closing the editor without Apply replays the held re-read once', async () => {
    const { dataSource, stored } = await mount([EDITOR_DETAIL], TWO_LINES());
    await waitFor(() => expect(shown('Line')).toEqual(['first', 'second']));
    const atRest = reads(dataSource, 'po_line');
    await openRow(0, 'first');
    await draft({ label: 'first (draft)' });

    stored.po_line[0] = { ...stored.po_line[0], label: 'first (server)' };
    await emit({ objectName: 'po_line' });
    await pause();
    expect(editorInput('label')?.value, 'the re-read reset the editor’s draft').toBe('first (draft)');
    expect(reads(dataSource, 'po_line'), 'a bus re-read ran under an open row editor').toBe(atRest);

    await settle(() => fireEvent.click(editorButton('Close')!));
    await waitFor(() => expect(editor()).toBeNull());
    await waitFor(() => expect(reads(dataSource, 'po_line'), 'closing the editor did not replay the held re-read').toBe(atRest + 1));
    await waitFor(() => expect(shown('Line')).toEqual(['first (server)', 'second']));
    await pause();
    expect(reads(dataSource, 'po_line'), 'the held re-read was replayed more than once').toBe(atRest + 1);
  });

  it('a re-read already in flight when the editor opens is not committed under it; it is held and replays once on close', async () => {
    const { dataSource, held, state, stored } = await mount([EDITOR_DETAIL], TWO_LINES());
    await waitFor(() => expect(shown('Line')).toEqual(['first', 'second']));
    const atRest = reads(dataSource, 'po_line');
    state.hold = true;

    await emit({ objectName: '*' });
    await waitFor(() => expect(reads(dataSource, 'po_line')).toBe(atRest + 1));
    await openRow(0, 'first');
    await draft({ label: 'first (draft)' });
    await answer(held.find((r) => r.objectName === 'po_line')!, [
      { id: 'l1', label: 'first (server)', memo: 'memo one', po: 'po1' },
      { id: 'l2', label: 'second', memo: 'memo two', po: 'po1' },
    ]);
    await pause();

    expect(editorInput('label')?.value, 'the in-flight re-read reset the editor’s draft').toBe('first (draft)');
    expect(shown('Line'), 'the in-flight re-read committed under the open editor').toEqual(['first', 'second']);
    expect(reads(dataSource, 'po_line'), 're-read again under the open editor').toBe(atRest + 1);

    state.hold = false;
    stored.po_line[0] = { ...stored.po_line[0], label: 'first (server)' };
    await settle(() => fireEvent.click(editorButton('Close')!));
    await waitFor(() => expect(editor()).toBeNull());
    await waitFor(() => expect(reads(dataSource, 'po_line')).toBe(atRest + 2));
    await waitFor(() => expect(shown('Line')).toEqual(['first (server)', 'second']));
  });
});
