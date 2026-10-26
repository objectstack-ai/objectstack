/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10814 — a `record:line_items` panel (`LineItemsPanel`) with an
 * authored parent re-reads its lines when the data-invalidation bus
 * (`notifyDataChanged` from `@object-ui/react`) reports a write to its child
 * object, in place.
 *
 * The panel resolves `parentId = schema.parentId || schema.recordId ||
 * record?.recordId` and takes its adapter from the `SchemaRenderer` context, so
 * a stored page node with an authored parent reads `find(childObject)` on
 * mount with no record context at all. Before this card nothing re-ran that
 * read after a write declared on the bus (a page action over raw HTTP, a flow,
 * a server action), so the panel kept the pre-action lines until its host
 * remounted it, and `PageView`'s remount is what objectui#10519 removes. The
 * fetch effect now names the `useDataInvalidation` nonce for the child object.
 *
 * The re-read rides the panel's own `load('inputs')`, so the rule that already
 * governs its re-reads governs this one too: unsaved edits for the current
 * parent HOLD it, and the save's reload carries it (objectui#10712 R3).
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration of `record:line_items`, with NO record context. Every `find`
 * returns a promise the test settles by hand, so a case can look at the panel
 * while a re-read is in flight. The bare `useDataInvalidation` reader beside the
 * panel is the positive control: it proves the event reached subscribers.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Registers `record:line_items` through this package's own entry.
import './index';

interface LinesRead {
  objectName: string;
  query: any;
  resolve: (value: unknown) => void;
}

function makeLinesDataSource() {
  const reads: LinesRead[] = [];
  const saves: Array<{ ops: any[]; resolve: (value: unknown) => void }> = [];
  const dataSource = {
    getObjectSchema: vi.fn(async () => null),
    find: vi.fn(
      (objectName: string, query: any) =>
        new Promise((resolve) => {
          reads.push({ objectName, query, resolve });
        }),
    ),
    batchTransaction: vi.fn(
      (ops: any[]) =>
        new Promise((resolve) => {
          saves.push({ ops, resolve });
        }),
    ),
  };
  return { dataSource, reads, saves };
}

/** A panel a stored page holds: the parent is authored, no record context. */
const LINES = {
  type: 'record:line_items',
  childObject: 'po_line',
  relationshipField: 'po',
  parentId: 'p1',
  columns: [{ name: 'label', label: 'Line', type: 'text' }],
};

/** The positive control: a bare reader of the child object, beside the panel. */
function BusControl() {
  const nonce = useDataInvalidation('po_line');
  return <span data-testid="bus-control">{nonce}</span>;
}

const renderPanel = (schema: Record<string, unknown>, ds: unknown) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <BusControl />
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

async function settle(fn: () => void = () => {}) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

const answerLines = (read: LinesRead, ...labels: string[]) =>
  settle(() => read.resolve({ data: labels.map((label, i) => ({ id: `l${i + 1}`, label })) }));

const emit = (change: { objectName: string; recordId?: string }) => settle(() => notifyDataChanged(change));

/** The grid's line inputs; the grid always trails one blank entry row. */
const lineInputs = () =>
  Array.from(document.body.querySelectorAll('input[aria-label="Line"]')) as HTMLInputElement[];
const shownLines = () => lineInputs().map((input) => input.value).filter((value) => value !== '');
const loadingShown = () => Array.from(document.body.querySelectorAll('p')).some((p) => p.textContent === 'Loading…');
const saveButton = () =>
  Array.from(document.body.querySelectorAll('button')).find((b) => /^(Save|Saving…)$/.test(b.textContent ?? '')) as
    | HTMLButtonElement
    | undefined;

async function mountClean() {
  const ds = makeLinesDataSource();
  const view = renderPanel(LINES, ds.dataSource);
  await waitFor(() => expect(ds.reads).toHaveLength(1));
  expect(ds.reads[0].objectName).toBe('po_line');
  expect(ds.reads[0].query.$filter).toEqual({ po: 'p1' });
  await answerLines(ds.reads[0], 'first');
  await waitFor(() => expect(shownLines()).toEqual(['first']));
  return { ...ds, view };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('record:line_items with an authored parent re-reads on the data-invalidation bus (objectui#10814)', () => {
  it('an unscoped change (objectName "*") re-runs its read once, keeping the grid drawn', async () => {
    const { dataSource, reads } = await mountClean();
    const firstInput = lineInputs()[0];

    await emit({ objectName: '*' });

    expect(document.querySelector('[data-testid="bus-control"]')?.textContent, 'control: the event never reached a subscriber').toBe('1');
    await waitFor(() => expect(dataSource.find, 'the panel never re-read after the bus reported a change').toHaveBeenCalledTimes(2));
    expect(reads[1].query.$filter).toEqual({ po: 'p1' });
    // In flight: the lines on screen stay drawn (not the loading branch), and
    // take no input, since the answer replaces them.
    expect(loadingShown(), 'the re-read blanked the panel to its loading branch').toBe(false);
    expect(shownLines()).toEqual(['first']);
    expect(lineInputs()[0], 'the re-read unmounted the grid').toBe(firstInput);
    expect(lineInputs().every((input) => input.disabled), 'the grid took input over a re-read in flight').toBe(true);

    await answerLines(reads[1], 'first (renamed)', 'second');
    await waitFor(() => expect(shownLines()).toEqual(['first (renamed)', 'second']));
    expect(lineInputs()[0], 'the grid was remounted by the re-read').toBe(firstInput);
    expect(lineInputs().every((input) => !input.disabled)).toBe(true);
    expect(saveButton()?.disabled, 'a re-read left the panel dirty').toBe(true);
  });

  it('a change to its child object re-reads once; another object does not', async () => {
    const { dataSource, reads } = await mountClean();

    await emit({ objectName: 'some_other_object' });
    expect(dataSource.find, 'a change to another object re-read this panel').toHaveBeenCalledTimes(1);

    await emit({ objectName: 'po_line', recordId: 'l1' });
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledTimes(2));
    await answerLines(reads[1], 'first again');
    await waitFor(() => expect(shownLines()).toEqual(['first again']));
  });

  it('while the panel holds unsaved edits the re-read is HELD, and the save’s reload carries it', async () => {
    const { dataSource, reads, saves } = await mountClean();
    await settle(() => fireEvent.change(lineInputs()[0], { target: { value: 'first edited' } }));
    await waitFor(() => expect(saveButton()?.disabled).toBe(false));

    await emit({ objectName: '*' });
    expect(dataSource.find, 'a bus re-read ran over unsaved edits').toHaveBeenCalledTimes(1);
    expect(shownLines(), 'the unsaved edit was discarded').toEqual(['first edited']);
    expect(saveButton()?.disabled).toBe(false);

    await settle(() => fireEvent.click(saveButton()!));
    await waitFor(() => expect(saves).toHaveLength(1));
    await settle(() => saves[0].resolve({ results: [] }));
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledTimes(2));
    await answerLines(reads[1], 'first edited');
    await waitFor(() => expect(shownLines()).toEqual(['first edited']));
    await settle();
    expect(dataSource.find, 'the held re-read ran a second time after the save reloaded').toHaveBeenCalledTimes(2);
  });

  it('control: a panel with no parent bound reads nothing, on mount or on an invalidation', async () => {
    const { dataSource } = makeLinesDataSource();
    const { getByText } = renderPanel({ ...LINES, parentId: undefined }, dataSource);
    await waitFor(() => expect(getByText('Save the record first to add line items.')).toBeTruthy());

    await emit({ objectName: '*' });

    expect(document.querySelector('[data-testid="bus-control"]')?.textContent).toBe('1');
    expect(dataSource.find).not.toHaveBeenCalled();
  });
});
