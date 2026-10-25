// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13056 — the flow header's Trigger pill names the object by label.
 *
 * The pill read "Record updated · showcase_task" although the object carries
 * the label "Task", and the Start node's object picker on the same page draws
 * that label. The pill now names the object from the catalog that picker reads
 * (`useObjectCatalog`, `GET /meta/object?preview=draft`):
 *
 *  - a record trigger and a time-relative sweep read their object's label, the
 *    name on the pill's `title`;
 *  - CONTROL: an object the catalog does not label, and a catalog that fails,
 *    leave the name as the text with no `title`; a flow with no trigger still
 *    reads its type.
 *
 * The readings with no catalog at all are pinned in
 * `FlowPreview.headerPills-11779.test.tsx`.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

// The object list the catalog reads. A `mock` prefix so the hoisted factory may close over it.
let mockObjects: unknown[] | Error = [];
const mockList = vi.fn(async (type: string) => {
  if (type !== 'object') return [];
  if (mockObjects instanceof Error) throw mockObjects;
  return mockObjects;
});
const mockClient = {
  list: (type: string) => mockList(type),
  withPreviewDrafts: () => mockClient,
};

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => mockClient,
}));
vi.mock('./useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));

import { FlowPreview } from './FlowPreview';

afterEach(() => {
  cleanup();
  mockList.mockClear();
  mockObjects = [];
});

const end = { id: 'end', type: 'end', label: 'End' };
const edges = [{ id: 'e1', source: 'start', target: 'end' }];

function flow(config: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'f1',
    label: 'F1',
    type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start', config }, end],
    edges,
  };
}

const OBJECTS = [
  { name: 'showcase_task', label: 'Task' },
  { name: 'showcase_contract', label: 'Contract' },
  { name: 'showcase_unlabelled' },
];

/** The Trigger pill: its value's text and the pill's element (which carries the `title`). */
function triggerPill(): { value: string; pill: HTMLElement } {
  const labelEl = screen.getByText('Trigger:');
  return { value: labelEl.nextElementSibling?.textContent ?? '', pill: labelEl.parentElement as HTMLElement };
}

function renderFlow(config: Record<string, unknown>): void {
  render(<FlowPreview type="flow" name="f1" draft={flow(config)} locale="en-US" />);
}

describe('the Trigger pill names its object by label (objectui#13056)', () => {
  it('a record trigger reads the object label, the name on the title', async () => {
    mockObjects = OBJECTS;
    renderFlow({ triggerType: 'record-after-update', objectName: 'showcase_task' });

    await waitFor(() => expect(triggerPill().value).toBe('Record updated · Task'));
    expect(triggerPill().pill).toHaveAttribute('title', 'showcase_task');
  });

  it('a time-relative sweep reads the label of the object it sweeps', async () => {
    mockObjects = OBJECTS;
    renderFlow({
      timeRelative: { object: 'showcase_contract', dateField: 'end_date', withinDays: 30 },
      schedule: { type: 'cron', expression: '0 7 * * *' },
    });

    await waitFor(() => expect(triggerPill().value).toBe('Time-relative (date sweep) · Contract'));
    expect(triggerPill().pill).toHaveAttribute('title', 'showcase_contract');
  });

  it('CONTROL: an object the catalog does not label reads as its name, with no title', async () => {
    mockObjects = OBJECTS;
    renderFlow({ triggerType: 'record-after-update', objectName: 'showcase_unlabelled' });
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('object'));

    expect(triggerPill().value).toBe('Record updated · showcase_unlabelled');
    expect(triggerPill().pill).not.toHaveAttribute('title');
  });

  it('CONTROL: a catalog that fails leaves the name as the text', async () => {
    mockObjects = new Error('boom');
    renderFlow({ triggerType: 'record-after-update', objectName: 'showcase_task' });
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('object'));

    expect(triggerPill().value).toBe('Record updated · showcase_task');
    expect(triggerPill().pill).not.toHaveAttribute('title');
  });

  it('CONTROL: a flow with no trigger still reads its type', async () => {
    mockObjects = OBJECTS;
    renderFlow({});
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('object'));

    expect(triggerPill().value).toBe('autolaunched');
  });
});
