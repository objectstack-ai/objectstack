// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27834 — the Update Records node on a record-triggered flow: the
 * record that started the flow is offered as the target, and the keys are
 * picked by label.
 *
 * - The `filter` block offers "Update the triggering record" while it has no
 *   rows. One press writes the id match the spec's own guidance prescribes
 *   for a CRUD node, `{ id: { dialect: 'cel', source: 'record.id' } }`, and
 *   the saved node passes the publish verdict: the flow parse plus the real
 *   `validateStackExpressions` from `@objectstack/lint`, the gate the publish
 *   runs.
 * - It is offered only where it is true: the trigger record is in scope at the
 *   node and the node's object is the trigger's. A filter the author wrote is
 *   left as it stands, and opening a node writes nothing.
 * - The key cells of `fields` and `filter` list the object's fields by label;
 *   the API name is what is stored. A key the catalog does not hold is still
 *   typeable through the picker.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { FlowSchema, UpdateRecordConfigSchema } from '@objectstack/spec/automation';
import { validateStackExpressions } from '@objectstack/lint';

const stubs = vi.hoisted(() => ({ configSchemas: {} as Record<string, unknown> }));

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => stubs.configSchemas,
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName?: string) => ({
    fields:
      objectName === 'ticket'
        ? [
            { name: 'status', label: 'Status', type: 'select', hidden: false },
            { name: 'owner', label: 'Owner', type: 'lookup', hidden: false },
          ]
        : [],
    loading: false,
    error: null,
  }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';

const META_PREFIX = '/api/v1/meta/';
const routeOf = (url: string) => url.split('?')[0];
let calls: string[] = [];

beforeEach(() => {
  stubs.configSchemas = {};
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
      calls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }) };
    }),
  );
});

afterEach(() => {
  expect(calls.filter((url) => !routeOf(url).startsWith(META_PREFIX))).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

type Node = { id: string; type: string; label: string; config?: Record<string, unknown> };

const START: Node = { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-update', objectName: 'ticket' } };
const END: Node = { id: 'end', type: 'end', label: 'End' };
const EDGES = [
  { id: 'e1', source: 'start', target: 'write' },
  { id: 'e2', source: 'write', target: 'end' },
];

function mount(write: Node, opts: { start?: Node; edges?: unknown[] } = {}) {
  const initial = { nodes: [opts.start ?? START, write, END], edges: opts.edges ?? EDGES };
  let current = initial;
  const onPatch = vi.fn();
  function Host() {
    const [draft, setDraft] = React.useState(initial);
    return (
      <FlowNodeInspector
        type="flow"
        name="close_ticket"
        draft={draft}
        selection={{ kind: 'node', id: write.id } as MetadataSelection}
        onPatch={(patch) => {
          onPatch(patch);
          setDraft((d) => {
            const next = { ...d, ...(patch as Partial<typeof d>) };
            current = next;
            return next;
          });
        }}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />
    );
  }
  render(<Host />);
  return {
    config: () => (current.nodes.find((n) => n.id === write.id) as Node).config,
    flow: () => ({ name: 'close_ticket', label: 'Close ticket', type: 'record_change', ...current }),
    onPatch,
  };
}

/** The labelled block of one key-value field (its label's parent). */
const block = (label: string) => screen.getByText(label).parentElement as HTMLElement;

const TARGET = 'Update the triggering record';
const TRIGGERING_FILTER = { id: { dialect: 'cel', source: 'record.id' } };

/** What the publish refuses on `body`: the flow parse, then the expression gate. */
function publishErrors(body: Record<string, unknown>): string[] {
  const parsed = FlowSchema.safeParse(body);
  const schema = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const lint = validateStackExpressions({ flows: [body] })
    .filter((i) => (i.severity ?? 'error') === 'error')
    .map((i) => `${i.where}: ${i.message}`);
  return [...schema, ...lint];
}

/** Pick `label` in the key picker of the newest row of `map`. */
function pickKey(map: HTMLElement, label: string) {
  const keys = within(map).getAllByRole('combobox', { name: 'Key' });
  fireEvent.click(keys[keys.length - 1]!);
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${label}`) }));
}

describe('objectstack#27834 — the triggering record as the Update Records target', () => {
  it('one press writes the id match, the line says so, and the saved flow passes the publish verdict', () => {
    const { config, flow } = mount({ id: 'write', type: 'update_record', label: 'Write', config: { objectName: 'ticket' } });
    const filter = block('Filter');
    expect(within(filter.parentElement!).getByText('Targets the ticket record that started this flow.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: TARGET }));
    expect(config()).toEqual({ objectName: 'ticket', filter: TRIGGERING_FILTER });
    expect(screen.queryByRole('button', { name: TARGET })).toBeNull();
    expect(screen.getByText('Updates the ticket record that started this flow.')).toBeInTheDocument();
    // The row is an ordinary filter row: the key `id`, the value a CEL expression.
    expect(within(block('Filter')).getByDisplayValue('record.id')).toBeInTheDocument();

    // A field value, picked by label, completes the node; the publish takes it.
    const fields = block('Field values');
    fireEvent.click(within(fields).getByRole('button', { name: 'Add entry' }));
    pickKey(fields, 'Status');
    const val = within(fields).getByPlaceholderText('Value');
    fireEvent.change(val, { target: { value: 'closed' } });
    fireEvent.blur(val);
    expect(config()).toEqual({ objectName: 'ticket', filter: TRIGGERING_FILTER, fields: { status: 'closed' } });
    expect(UpdateRecordConfigSchema.safeParse(config()).success).toBe(true);
    expect(publishErrors(flow())).toEqual([]);
  });

  it('control: the publish refuses the same node with the expression left blank — the verdict is live', () => {
    const { flow } = mount({
      id: 'write',
      type: 'update_record',
      label: 'Write',
      config: { objectName: 'ticket', filter: { id: { dialect: 'cel', source: '' } }, fields: { status: 'closed' } },
    });
    expect(publishErrors(flow()).length).toBeGreaterThan(0);
  });

  it('a filter the author wrote is left as it stands, and opening the node writes nothing', () => {
    const { config, onPatch } = mount({
      id: 'write',
      type: 'update_record',
      label: 'Write',
      config: { objectName: 'ticket', filter: { status: 'open' } },
    });
    expect(screen.queryByRole('button', { name: TARGET })).toBeNull();
    expect(screen.queryByText('Updates the ticket record that started this flow.')).toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
    expect(config()).toEqual({ objectName: 'ticket', filter: { status: 'open' } });
  });

  it('control: not offered on another object, on a flow with no record trigger, or off the trigger path', () => {
    mount({ id: 'write', type: 'update_record', label: 'Write', config: { objectName: 'account' } });
    expect(screen.queryByRole('button', { name: TARGET })).toBeNull();
    cleanup();
    mount(
      { id: 'write', type: 'update_record', label: 'Write', config: { objectName: 'ticket' } },
      { start: { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'manual' } } },
    );
    expect(screen.queryByRole('button', { name: TARGET })).toBeNull();
    cleanup();
    mount({ id: 'write', type: 'update_record', label: 'Write', config: { objectName: 'ticket' } }, { edges: [] });
    expect(screen.queryByRole('button', { name: TARGET })).toBeNull();
  });

  it('control: the other record nodes offer no target', () => {
    for (const type of ['delete_record', 'get_record']) {
      mount({ id: 'write', type, label: 'Write', config: { objectName: 'ticket' } });
      expect(screen.queryByRole('button', { name: TARGET }), type).toBeNull();
      cleanup();
    }
  });
});

describe('objectstack#27834 — Update Records keys are picked by label', () => {
  for (const map of ['Field values', 'Filter']) {
    it(`${map}: the key picker lists the fields by label and stores the API name`, () => {
      const { config } = mount({ id: 'write', type: 'update_record', label: 'Write', config: { objectName: 'ticket' } });
      const el = block(map);
      fireEvent.click(within(el).getByRole('button', { name: 'Add entry' }));
      pickKey(el, 'Owner');
      // The trigger shows the label; the draft holds the API name.
      expect(within(el).getByRole('combobox', { name: 'Key' })).toHaveTextContent('Owner');
      const val = within(el).getByPlaceholderText('Value');
      fireEvent.change(val, { target: { value: 'usr_1' } });
      fireEvent.blur(val);
      const key = map === 'Filter' ? 'filter' : 'fields';
      expect(config()?.[key]).toEqual({ owner: 'usr_1' });
    });
  }

  it('a stored key the catalog does not hold shows as written, and a typed one is still taken', () => {
    const { config } = mount({
      id: 'write',
      type: 'update_record',
      label: 'Write',
      config: { objectName: 'ticket', fields: { legacy_flag: true } },
    });
    const fields = block('Field values');
    expect(within(fields).getByRole('combobox', { name: 'Key' })).toHaveTextContent('legacy_flag');
    fireEvent.click(within(fields).getByRole('button', { name: 'Add entry' }));
    const keys = within(fields).getAllByRole('combobox', { name: 'Key' });
    fireEvent.click(keys[1]!);
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), { target: { value: 'due_date' } });
    fireEvent.click(screen.getByRole('option', { name: /due_date/ }));
    const vals = within(fields).getAllByPlaceholderText('Value');
    fireEvent.change(vals[1]!, { target: { value: '2026-11-01' } });
    fireEvent.blur(vals[1]!);
    expect(config()?.fields).toEqual({ legacy_flag: true, due_date: '2026-11-01' });
  });

  it('control: create_record keeps the text box with the fields suggested', () => {
    mount({ id: 'write', type: 'create_record', label: 'Write', config: { objectName: 'ticket' } });
    const fields = block('Field values');
    fireEvent.click(within(fields).getByRole('button', { name: 'Add entry' }));
    expect(within(fields).queryByRole('combobox', { name: 'Key' })).toBeNull();
    expect(within(fields).getByPlaceholderText('Key').getAttribute('list')).toBeTruthy();
  });
});
