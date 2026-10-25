// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WIDGETS, collectPageComponentIds } from './widgets';
import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

const RefComponent = WIDGETS['ref:component'];

/**
 * #2328 — `ref:component` widget. A page variable's `source` names the component
 * (by `id`) that writes it; this picks that id from the page's real canvas
 * components (context.componentIds) instead of a free-text input the author can
 * mistype. Radix Select portals its option list on open (flaky in jsdom), so
 * the render tests cover the eagerly-rendered parts: registry wiring, the closed
 * trigger, and graceful degradation with no components. The extraction logic is
 * exercised directly via collectPageComponentIds.
 */
describe('ref:component widget', () => {
  it('is registered in the WIDGETS map', () => {
    expect(RefComponent).toBeTypeOf('function');
  });

  it('renders a combobox trigger when components are available', () => {
    render(
      <RefComponent
        value="project_picker"
        onChange={() => {}}
        schema={{ type: 'string' }}
        context={{ conditionScope: 'flattened', componentIds: [
          { id: 'project_picker', type: 'element:record_picker' },
          { id: 'task_list', type: 'record:related_list' },
        ] }}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('degrades to a free-text input when the page has no components yet', () => {
    render(
      <RefComponent
        value="typed_id"
        onChange={() => {}}
        schema={{ type: 'string' }}
        context={{ conditionScope: 'flattened', componentIds: [] }}
      />,
    );
    // No combobox — a plain input carrying the stored value so it stays editable.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('typed_id')).toBeInTheDocument();
  });

  it('renders with an out-of-tree value without throwing (stale/renamed id survives)', () => {
    render(
      <RefComponent
        value="renamed_picker"
        onChange={() => {}}
        schema={{ type: 'string' }}
        context={{ conditionScope: 'flattened', componentIds: [{ id: 'project_picker', type: 'element:record_picker' }] }}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

/**
 * collectPageComponentIds walks the page draft's region/component tree and
 * returns every component that carries an `id`, de-duplicated in document order.
 */
describe('collectPageComponentIds', () => {
  it('collects ids across regions in document order', () => {
    const draft = {
      regions: [
        { name: 'header', components: [{ type: 'nav:menu', id: 'main_nav' }] },
        {
          name: 'main',
          components: [
            { type: 'element:record_picker', id: 'project_picker', label: 'Project' },
            { type: 'record:related_list', id: 'task_list' },
          ],
        },
      ],
    };
    const ids = collectPageComponentIds(draft);
    expect(ids.map((c) => c.id)).toEqual(['main_nav', 'project_picker', 'task_list']);
    expect(ids[1]).toEqual({ id: 'project_picker', type: 'element:record_picker', label: 'Project' });
  });

  it('recurses into nested container components (components / children / properties)', () => {
    const draft = {
      regions: [
        {
          name: 'main',
          components: [
            {
              type: 'page:tabs',
              id: 'outer_tabs',
              components: [{ type: 'element:record_picker', id: 'nested_picker' }],
            },
            {
              type: 'page:section',
              id: 'outer_section',
              properties: { children: [{ type: 'element:button', id: 'deep_button' }] },
            },
          ],
        },
      ],
    };
    const ids = collectPageComponentIds(draft).map((c) => c.id);
    expect(ids).toEqual(['outer_tabs', 'nested_picker', 'outer_section', 'deep_button']);
  });

  it('skips components without an id and de-duplicates repeated ids (first wins)', () => {
    const draft = {
      regions: [
        {
          name: 'main',
          components: [
            { type: 'element:divider' }, // no id → skipped
            { type: 'element:record_picker', id: 'dup', label: 'First' },
            { type: 'element:record_picker', id: 'dup', label: 'Second' },
          ],
        },
      ],
    };
    const ids = collectPageComponentIds(draft);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toEqual({ id: 'dup', type: 'element:record_picker', label: 'First' });
  });

  it('returns an empty list for a page with no regions', () => {
    expect(collectPageComponentIds({})).toEqual([]);
    expect(collectPageComponentIds(undefined)).toEqual([]);
    expect(collectPageComponentIds({ regions: [] })).toEqual([]);
  });
});

/**
 * Integration seam (#2328): a page's `variables` repeater sub-field `source`,
 * declared with `widget: 'ref:component'` in the framework form spec, must route
 * through SchemaForm's card-layout repeater → FieldRow → FieldControl → the
 * `ref:component` renderer, fed by `widgetContext.componentIds`. This proves the
 * whole path (not just the widget in isolation) turns `source` into a dropdown.
 */
describe('SchemaForm → variables.source integration', () => {
  const schema = {
    type: 'object',
    properties: {
      variables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            source: { type: 'string' },
          },
        },
      },
    },
  };
  const form = {
    type: 'simple' as const,
    sections: [
      {
        label: 'Data Context',
        fields: [
          {
            field: 'variables',
            type: 'repeater',
            fields: [
              { field: 'name' },
              { field: 'source', widget: 'ref:component' },
            ],
          },
        ],
      },
    ],
  };

  it('renders the source sub-field as a component picker (combobox), not a text input', () => {
    render(
      <SchemaForm
        schema={schema}
        form={form}
        value={{ variables: [{ name: 'selectedProjectId', source: 'project_picker' }] }}
        onChange={() => {}}
        widgetContext={{ conditionScope: 'flattened', componentIds: [
          { id: 'project_picker', type: 'element:record_picker' },
          { id: 'task_list', type: 'record:related_list' },
        ] }}
      />,
    );
    // The card-layout repeater row is collapsed by default; expand it to reveal
    // the sub-fields, then assert `source` rendered the component-picker combobox.
    fireEvent.click(screen.getByRole('button', { name: /#1/ }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
