// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7611 Q3b (ruled objectstack#22865 Q3b → B) — the approver Value
 * picker reads the spec's REGISTRY binding, `{ source: 'registry', type }`
 * (objectstack#22710), and lists that metadata type's items.
 *
 * A server on that spec publishes `xRef.sources.position` as the registry
 * member. Before this, `json-schema-to-fields` dropped any source that was not
 * `data` / `enum` / a bare marker, so the picker fell back to the installed
 * spec's binding — a lookup over `sys_position` rows, which a fresh
 * environment leaves empty — and the console objectstack ships (spec
 * injected, so the fallback carries no `position` either) rendered a plain
 * text box.
 *
 * Load-bearing behaviours, one pin each:
 *   1. a published registry source survives `json-schema-to-fields`, and a
 *      registry source with no type is dropped like any unusable entry;
 *   2. a published registry source renders a select over that type's items,
 *      read through the metadata client (`GET /api/v1/meta/<type>`), and a
 *      choice commits the item's NAME — with no record lookup, even with an
 *      adapter present;
 *   3. the record arm is unchanged: a published `data` source still renders
 *      the record lookup and never lists the registry;
 *   4. never trap the author — a stored name the registry does not list is
 *      shown flagged, an empty registry leaves the text box, and a pencil
 *      toggle switches to manual entry.
 * The no-published-source fallback under a spec that carries the registry
 * member is pinned in `FlowReferenceField.injectedRegistryBinding-7611.test.tsx`.
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
    // STABLE identity, like the real memoized client: `useMetadataListOptions`
    // keys its effect on the client object.
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
  LookupField: (props: { field?: { reference?: string; idField?: string } }) => (
    <div
      data-testid="record-lookup"
      data-object={props.field?.reference}
      data-value-field={props.field?.idField}
    />
  ),
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { ReferenceCombobox, registryTypeFor, KIND_TO_REGISTRY_TYPE } from './FlowReferenceField';
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

/** The registry member, as a server carrying objectstack#22710 publishes `position`. */
const REGISTRY: RefValueSource = { source: 'registry', type: 'position' };

/** Two declared positions, as `GET /api/v1/meta/position` serves them. */
const POSITIONS = [
  { name: 'manager', label: 'Manager' },
  { name: 'exec', label: 'Executive' },
];

function makeAdapter() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async () => undefined),
  };
}

function renderPosition(
  source: RefValueSource | undefined,
  props: Partial<React.ComponentProps<typeof ReferenceCombobox>> = {},
) {
  return render(
    <ReferenceCombobox
      resolved={{ kind: 'position', source }}
      value={props.value ?? ''}
      onCommit={props.onCommit ?? vi.fn()}
      onSelect={props.onSelect}
    />,
  );
}

describe('json-schema-to-fields carries the registry source (objectui#7611 Q3b)', () => {
  function sourcesFor(sources: Record<string, unknown>) {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        approvers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                xRef: { kindFrom: 'type', map: { position: 'position', user: 'user' }, sources },
              },
            },
          },
        },
      },
    })!;
    return fields.find((f) => f.id === 'approvers')!.columns!.find((c) => c.key === 'value')!.ref!.sources;
  }

  it('keeps a published registry source, beside the record arm', () => {
    expect(
      sourcesFor({
        position: { source: 'registry', type: 'position' },
        user: { source: 'data', object: 'sys_user', valueField: 'id' },
      }),
    ).toEqual({
      position: { source: 'registry', type: 'position' },
      user: { source: 'data', object: 'sys_user', valueField: 'id' },
    });
  });

  it('drops a registry source with no type, like any entry that could not drive a picker', () => {
    expect(
      sourcesFor({
        position: { source: 'registry' },
        user: { source: 'data', object: 'sys_user', valueField: 'id' },
      }),
    ).toEqual({ user: { source: 'data', object: 'sys_user', valueField: 'id' } });
  });
});

describe('registryTypeFor — the published binding decides (objectui#7611 Q3b)', () => {
  it('answers the published registry type', () => {
    expect(registryTypeFor({ kind: 'position', source: REGISTRY })).toBe('position');
  });

  it('never answers for a published record binding — the record arm is unchanged', () => {
    expect(
      registryTypeFor({ kind: 'position', source: { source: 'data', object: 'sys_position', valueField: 'name' } }),
    ).toBeUndefined();
    expect(registryTypeFor({ kind: 'org-membership-level', source: { source: 'enum', values: ['owner'] } })).toBeUndefined();
  });

  it('falls back to the bundled spec only when nothing is published', () => {
    expect(registryTypeFor({ kind: 'position' })).toBe(KIND_TO_REGISTRY_TYPE.position);
    expect(registryTypeFor(undefined)).toBeUndefined();
  });
});

describe('ReferenceCombobox — a registry-bound approver (objectui#7611 Q3b)', () => {
  it('lists the registry type and commits the chosen item’s NAME, never a record lookup', async () => {
    state.adapter = makeAdapter();
    state.metaList.mockImplementation(async () => POSITIONS);
    const onSelect = vi.fn();
    renderPosition(REGISTRY, { onSelect });

    const cell = await screen.findByTestId('registry-pick');
    await vi.waitFor(() => expect(cell.getAttribute('data-mode')).toBe('select'));
    expect(state.metaList).toHaveBeenCalledWith('position');
    expect(screen.queryByTestId('record-lookup')).toBeNull();

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Executive (exec)' }));
    expect(onSelect).toHaveBeenCalledWith('exec');
  });

  it('shows a stored name the registry does not list, flagged rather than blanked', async () => {
    state.metaList.mockImplementation(async () => POSITIONS);
    renderPosition(REGISTRY, { value: 'retired_role' });
    const cell = await screen.findByTestId('registry-pick');
    await vi.waitFor(() => expect(cell.getAttribute('data-mode')).toBe('select'));
    expect(screen.getByRole('combobox').textContent).toContain('retired_role (not found)');
  });

  it('leaves the text box when the registry lists nothing', async () => {
    const onCommit = vi.fn();
    renderPosition(REGISTRY, { onCommit });
    const cell = await screen.findByTestId('registry-pick');
    await vi.waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled());
    expect(cell.getAttribute('data-mode')).toBe('text');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'manager' } });
    expect(onCommit).toHaveBeenCalledWith('manager');
  });

  it('switches to manual entry and back', async () => {
    state.metaList.mockImplementation(async () => POSITIONS);
    const onCommit = vi.fn();
    renderPosition(REGISTRY, { onCommit });
    const cell = await screen.findByTestId('registry-pick');
    await vi.waitFor(() => expect(cell.getAttribute('data-mode')).toBe('select'));

    fireEvent.click(screen.getByTitle('Enter value manually'));
    expect(screen.getByTestId('registry-pick').getAttribute('data-mode')).toBe('text');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not_declared_yet' } });
    expect(onCommit).toHaveBeenCalledWith('not_declared_yet');

    fireEvent.click(screen.getByTitle('Pick from declared items'));
    expect(screen.getByTestId('registry-pick').getAttribute('data-mode')).toBe('select');
  });
});

describe('ReferenceCombobox — the record arm is unchanged (objectui#7611 Q3b)', () => {
  it('a published data source still renders the record lookup and lists no registry', () => {
    state.adapter = makeAdapter();
    renderPosition({ source: 'data', object: 'sys_position', valueField: 'name' });
    const cell = screen.getByTestId('record-lookup');
    expect(cell.getAttribute('data-object')).toBe('sys_position');
    expect(cell.getAttribute('data-value-field')).toBe('name');
    expect(screen.queryByTestId('registry-pick')).toBeNull();
    expect(state.metaList).not.toHaveBeenCalledWith('position');
  });
});
