// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11788 — a `create_record` / `update_record` node's field values are
 * keyed by fields picked from the node's own target object, not typed blind.
 *
 * The key cell of `config.fields` lists the fields of `config.objectName`, read
 * through `useObjectFields` — the field source the reference picker's
 * `object-field` kind already reads. The key stays free text (a field the
 * catalog does not list is still typeable), and the VALUE cell is not touched:
 * it keeps the slot's own dialect, the text / CEL-envelope toggle the spec's
 * expression ledger declares for `fields.*`.
 *
 * Both descriptor sources draw the map — the offline table, and the published
 * `configSchema` (`fields: { type: 'object', additionalProperties: true }`,
 * objectstack `service-automation` `builtin/crud-nodes.ts` at `51290bca`) — so
 * every case runs against both. `update_record`'s `filter` map, keyed the same
 * way but not a field-VALUE map, is the control.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

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

const CRUD_SCHEMAS = {
  create_record: {
    type: 'object',
    properties: {
      objectName: { type: 'string', title: 'Object', xRef: { kind: 'object' } },
      fields: { type: 'object', additionalProperties: true, title: 'Field values', description: 'FIXTURE fields' },
      outputVariable: { type: 'string', title: 'Output variable' },
    },
    required: ['objectName'],
  },
  update_record: {
    type: 'object',
    properties: {
      objectName: { type: 'string', title: 'Object', xRef: { kind: 'object' } },
      filter: { type: 'object', additionalProperties: true, title: 'Filter', description: 'FIXTURE filter' },
      fields: { type: 'object', additionalProperties: true, title: 'Field values', description: 'FIXTURE fields' },
      multi: { type: 'boolean', title: 'Update every matching record' },
    },
    required: ['objectName'],
  },
};

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

type Source = 'offline' | 'engine';
type Node = { id: string; type: string; label: string; config: Record<string, unknown> };

function mount(source: Source, initial: Node) {
  stubs.configSchemas = source === 'engine' ? CRUD_SCHEMAS : {};
  let current: Node = initial;
  function Host() {
    const [draft, setDraft] = React.useState<{ nodes: Node[]; edges: unknown[] }>({ nodes: [initial], edges: [] });
    return (
      <FlowNodeInspector
        type="flow"
        name="close_ticket"
        draft={draft}
        selection={{ kind: 'node', id: initial.id } as MetadataSelection}
        onPatch={(patch) => {
          setDraft((d) => {
            const next = { ...d, ...(patch as Partial<typeof d>) };
            current = next.nodes[0];
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
  return { config: () => current.config };
}

/** The labelled block of one key-value field (its label's parent). */
const block = (label: string) => screen.getByText(label).parentElement as HTMLElement;

/** The values a key input suggests: the datalist its `list` attribute names. */
function keySuggestions(keyInput: HTMLElement): string[] | null {
  const id = keyInput.getAttribute('list');
  if (!id) return null;
  return Array.from(document.getElementById(id)?.querySelectorAll('option') ?? []).map((o) => (o as HTMLOptionElement).value);
}

const SOURCES: Source[] = ['offline', 'engine'];

describe('objectui#11788 — record field-value keys are picked from the target object', () => {
  for (const source of SOURCES) {
    for (const type of ['create_record', 'update_record'] as const) {
      it(`${type} — ${source}: the key cell lists the object's fields and the pick is written as the key`, () => {
        const { config } = mount(source, { id: 'write', type, label: 'Write', config: { objectName: 'ticket' } });
        const fields = block('Field values');
        fireEvent.click(within(fields).getByRole('button', { name: 'Add entry' }));
        const key = within(fields).getByPlaceholderText('Key');
        expect(keySuggestions(key)).toEqual(['status', 'owner']);
        expect(within(fields).getByText('Fields of ticket.')).toBeInTheDocument();
        fireEvent.change(key, { target: { value: 'status' } });
        fireEvent.blur(key);
        const val = within(fields).getByPlaceholderText('Value');
        fireEvent.change(val, { target: { value: 'done' } });
        fireEvent.blur(val);
        expect(config().fields).toEqual({ status: 'done' });
        // The value cell keeps the slot's own dialect: the text / CEL toggle.
        expect(within(fields).getByRole('button', { name: 'Write as a CEL expression' })).toBeInTheDocument();
      });
    }

    it(`${source}: with no object chosen the key is a plain box and says why`, () => {
      mount(source, { id: 'write', type: 'create_record', label: 'Write', config: {} });
      const fields = block('Field values');
      fireEvent.click(within(fields).getByRole('button', { name: 'Add entry' }));
      expect(keySuggestions(within(fields).getByPlaceholderText('Key'))).toBeNull();
      expect(within(fields).getByText('Choose the Object above to list its fields.')).toBeInTheDocument();
    });

    it(`${source}: update_record's filter map is not a field-value map — the control`, () => {
      mount(source, { id: 'write', type: 'update_record', label: 'Write', config: { objectName: 'ticket' } });
      const filter = block('Filter');
      fireEvent.click(within(filter).getByRole('button', { name: 'Add entry' }));
      expect(keySuggestions(within(filter).getByPlaceholderText('Key'))).toBeNull();
    });
  }
});
