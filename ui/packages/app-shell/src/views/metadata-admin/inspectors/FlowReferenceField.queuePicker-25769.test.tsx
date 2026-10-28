// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack ADR-0142 D6 — the approver Value picker for a `queue` approver
 * lists BOTH of a queue's sources: the queues a package declares
 * (`GET /api/v1/meta/queue`, through the metadata client) and the
 * organization's own `sys_queue` rows (through the data adapter). The server
 * publishes the binding as `{ source: 'registry-and-data', type, object,
 * valueField }`; a choice commits the queue's machine name.
 *
 * Load-bearing behaviours, one pin each:
 *   1. a published two-source binding survives `json-schema-to-fields` whole,
 *      and a half one is dropped;
 *   2. `twoSourceFor` follows the published binding, and the bundled spec only
 *      when nothing is published;
 *   3. the render condition and the two requests: with an adapter, both lists
 *      are read and merged; a choice commits the NAME;
 *   4. never trap the author: no adapter or an empty list leaves the text box,
 *      a stored name neither source lists is shown flagged, and a server that
 *      publishes `queue` as anything else keeps the plain text cell.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => {
  const metaList = vi.fn(async (_type: string) => [] as unknown[]);
  return {
    adapter: null as unknown,
    metaList,
    // STABLE identity, like the real memoized client.
    metadataClient: { list: metaList },
  };
});

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => state.adapter,
  // @object-ui/components wires this at module scope (related-count-store).
  subscribeDataChanges: () => () => {},
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  LookupField: () => <div data-testid="record-lookup" />,
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { ReferenceCombobox, twoSourceFor, KIND_TO_TWO_SOURCE } from './FlowReferenceField';
import { jsonSchemaToFlowFields } from './json-schema-to-fields';
import type { RefValueSource } from './flow-node-config';

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

afterEach(() => {
  cleanup();
  state.adapter = null;
  state.metaList.mockReset();
  state.metaList.mockImplementation(async () => []);
});

/** The two-source member, as a server carrying ADR-0142 D6 publishes `queue`. */
const TWO_SOURCE: RefValueSource = { source: 'registry-and-data', type: 'queue', object: 'sys_queue', valueField: 'name' };

const DECLARED = [{ name: 'support_intake', label: 'Support Intake' }];
const AUTHORED = [{ id: 'q_1', name: 'shanghai_desk', label: 'Shanghai Desk' }];

function makeAdapter(rows: unknown[] = AUTHORED) {
  return {
    find: vi.fn(async () => ({ data: rows })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async () => undefined),
  };
}

function renderQueue(
  source: RefValueSource | undefined,
  props: Partial<React.ComponentProps<typeof ReferenceCombobox>> = {},
) {
  return render(
    <ReferenceCombobox
      resolved={{ kind: 'queue', source }}
      value={props.value ?? ''}
      onCommit={props.onCommit ?? vi.fn()}
      onSelect={props.onSelect}
    />,
  );
}

describe('json-schema-to-fields carries the two-source binding (ADR-0142 D6)', () => {
  function sourcesFor(sources: Record<string, unknown>) {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        approvers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', xRef: { kindFrom: 'type', map: { queue: 'queue' }, sources } },
            },
          },
        },
      },
    })!;
    return fields.find((f) => f.id === 'approvers')!.columns!.find((c) => c.key === 'value')!.ref!.sources;
  }

  it('keeps a whole two-source binding', () => {
    expect(sourcesFor({ queue: TWO_SOURCE })).toEqual({ queue: TWO_SOURCE });
  });

  it('drops a binding missing a half — it could only offer half the queues', () => {
    expect(sourcesFor({ queue: { source: 'registry-and-data', type: 'queue' } })).toBeUndefined();
  });
});

describe('twoSourceFor — the published binding decides (ADR-0142 D6)', () => {
  it('answers the published two-source binding, and nothing for another member', () => {
    expect(twoSourceFor({ kind: 'queue', source: TWO_SOURCE })).toEqual(TWO_SOURCE);
    expect(twoSourceFor({ kind: 'queue', source: { source: 'unsupported' } })).toBeUndefined();
    expect(twoSourceFor({ kind: 'position', source: { source: 'registry', type: 'position' } })).toBeUndefined();
  });

  it('falls back to the bundled spec only when nothing is published', () => {
    expect(KIND_TO_TWO_SOURCE.queue).toMatchObject({ type: 'queue', object: 'sys_queue', valueField: 'name' });
    expect(twoSourceFor({ kind: 'queue' })).toEqual(KIND_TO_TWO_SOURCE.queue);
    expect(twoSourceFor(undefined)).toBeUndefined();
  });
});

describe('ReferenceCombobox — a queue approver picks from both sources (ADR-0142 D6)', () => {
  it('reads the declared queues and the sys_queue rows, and commits the chosen NAME', async () => {
    const adapter = makeAdapter();
    state.adapter = adapter;
    state.metaList.mockImplementation(async () => DECLARED);
    const onSelect = vi.fn();
    renderQueue(TWO_SOURCE, { onSelect });

    const cell = await screen.findByTestId('two-source-pick');
    await vi.waitFor(() => expect(cell.getAttribute('data-mode')).toBe('select'));
    expect(state.metaList).toHaveBeenCalledWith('queue');
    expect(adapter.find).toHaveBeenCalledWith('sys_queue', { $top: 500, $orderby: { name: 'asc' } });
    expect(screen.queryByTestId('record-lookup')).toBeNull();

    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'Support Intake (support_intake)' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: 'Shanghai Desk (shanghai_desk)' }));
    expect(onSelect).toHaveBeenCalledWith('shanghai_desk');
  });

  it('shows a stored name neither source lists, flagged, instead of blanking it', async () => {
    state.adapter = makeAdapter();
    state.metaList.mockImplementation(async () => DECLARED);
    renderQueue(TWO_SOURCE, { value: 'retired_desk' });

    const cell = await screen.findByTestId('two-source-pick');
    await vi.waitFor(() => expect(cell.getAttribute('data-mode')).toBe('select'));
    expect(screen.getByRole('combobox').textContent).toContain('retired_desk');
    expect(screen.getByRole('combobox').textContent).toContain('(not found)');
  });

  it('switches to manual entry and back', async () => {
    state.adapter = makeAdapter();
    state.metaList.mockImplementation(async () => DECLARED);
    const onCommit = vi.fn();
    renderQueue(TWO_SOURCE, { onCommit });

    const cell = await screen.findByTestId('two-source-pick');
    await vi.waitFor(() => expect(cell.getAttribute('data-mode')).toBe('select'));
    fireEvent.click(screen.getByTitle('Enter value manually'));
    expect(screen.getByTestId('two-source-pick').getAttribute('data-mode')).toBe('text');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed_desk' } });
    expect(onCommit).toHaveBeenCalledWith('typed_desk');
    fireEvent.click(screen.getByTitle('Pick from the queues'));
    expect(screen.getByTestId('two-source-pick').getAttribute('data-mode')).toBe('select');
  });

  it('with no adapter reads nothing and keeps the text box — one source alone is half a list', async () => {
    state.metaList.mockImplementation(async () => DECLARED);
    const onCommit = vi.fn();
    renderQueue(TWO_SOURCE, { value: 'support_intake', onCommit });

    expect(screen.getByTestId('two-source-pick').getAttribute('data-mode')).toBe('text');
    expect(state.metaList).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue('support_intake'), { target: { value: 'other_desk' } });
    expect(onCommit).toHaveBeenCalledWith('other_desk');
  });

  it('keeps the plain text cell for a server that publishes queue as anything else', () => {
    state.adapter = makeAdapter();
    renderQueue({ source: 'unsupported' }, { value: 'q_west' });
    expect(screen.queryByTestId('two-source-pick')).toBeNull();
    expect(screen.getByDisplayValue('q_west')).toBeInTheDocument();
    expect(state.metaList).not.toHaveBeenCalled();
  });
});
