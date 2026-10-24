// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10179 / objectui#10177 — every row of `FormPage` renders the widget
 * the SHARED resolver names for it, on all three axes.
 *
 * Until #10179 `FieldInput` was a hand-rolled `switch (field.type)` that knew a
 * subset of the declared field types and rendered every other one as a text
 * box — no error, no warning. The ruling (maintainer, option A) replaced it with
 * the shared chain, `resolveFormWidgetType` + `getLazyFieldWidget`, including
 * the two axes a type-keyed switch cannot see at all.
 *
 * ## How "the widget the resolver names" is observed
 *
 * `getLazyFieldWidget` is replaced by a stub that renders a marker carrying the
 * key the REAL `resolveFormWidgetType` gives the argument. That is exactly what
 * the real function mounts (it resolves its argument through the same call), so
 * the marker names the widget the page would render, without loading every
 * widget chunk. A row the page drew by hand instead would carry no marker at
 * all, and fails the table below.
 *
 * ## Three axes, pinned separately so one cannot hide another
 *
 * - TYPE — table-driven over `FieldType.options` read from the installed spec
 *   AT RUNTIME: a type the spec adds later is covered with no edit here, and
 *   the population is asserted non-empty so an empty read cannot pass.
 * - WIDGET (objectui#10177) — `object-ref`, `filter-condition` and
 *   `recipient-picker` are reachable ONLY through the `widget` key; an authored
 *   `widget` beats `type`, and the form view's beats the object field's.
 * - ARITY — `select` + `multiple: true` is the multiselect widget; a
 *   multi-capable type whose one widget handles both arities (`lookup`) keeps
 *   its own.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FieldType } from '@objectstack/spec/data';
import { resolveFormWidgetType } from '@object-ui/fields';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/fields')>();
  const React = await import('react');
  // One stub component per resolved key, so a row keeps its identity across
  // renders exactly as the real per-key cache does.
  const stubs = new Map<string, React.ComponentType<Record<string, unknown>>>();
  return {
    ...actual,
    getLazyFieldWidget: (type: string) => {
      const key = actual.resolveFormWidgetType(type);
      let Stub = stubs.get(key);
      if (!Stub) {
        Stub = (props: Record<string, unknown>) =>
          React.createElement('div', {
            'data-testid': `widget-${String(props.name)}`,
            'data-widget': key,
            id: props.id as string | undefined,
            'aria-labelledby': props['aria-labelledby'] as string | undefined,
          });
        stubs.set(key, Stub);
      }
      return Stub;
    },
  };
});

/** Render the internal route over one object schema and one field list. */
function renderForm(objectFields: Record<string, unknown>, viewFields: unknown[]) {
  const routes: Array<{ match: string; body: unknown }> = [
    {
      match: '/meta/view/',
      body: {
        name: 'probe.form',
        object: 'probe',
        viewKind: 'form',
        label: 'Probe',
        config: { type: 'simple', sections: [{ label: 'Probe', fields: viewFields }] },
      },
    },
    { match: '/meta/object/', body: { name: 'probe', label: 'Probe', fields: objectFields } },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const route = routes.find((r) => String(url).includes(r.match));
      if (!route) throw new Error(`unstubbed fetch: ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => route.body,
        text: async () => JSON.stringify(route.body),
      } as unknown as Response;
    }),
  );
  return render(
    <MemoryRouter initialEntries={['/forms/probe.form']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The widget key the page mounted for the row named `name`. */
async function widgetOf(name: string): Promise<string | null> {
  const el = await waitFor(() => screen.getByTestId(`widget-${name}`));
  return el.getAttribute('data-widget');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TYPE axis — every declared field type renders the widget the shared resolver names', () => {
  const declared: readonly string[] = FieldType.options;

  it('reads a non-empty population from the installed spec', () => {
    // Without this, an empty read would make the table below vacuous.
    expect(declared.length).toBeGreaterThan(0);
  });

  it('mounts resolveFormWidgetType(type) for each declared type, and never a hand-drawn control', async () => {
    const fields = Object.fromEntries(
      declared.map((t) => [`t_${t}`, { type: t, label: `Type ${t}` }]),
    );
    const { container } = renderForm(
      fields,
      declared.map((t) => `t_${t}`),
    );
    const mismatches: string[] = [];
    for (const t of declared) {
      const got = await widgetOf(`t_${t}`);
      const want = resolveFormWidgetType(t);
      if (got !== want) mismatches.push(`${t}: rendered ${got}, resolver names ${want}`);
    }
    expect(mismatches).toEqual([]);
    // No row escaped the resolver: the page draws no input, select or textarea
    // of its own (the stub renders none), so any one found here is hand-rolled.
    expect(container.querySelectorAll('form input, form select, form textarea')).toHaveLength(0);
  });

  it('CONTROL — a spelling the spec does not declare takes the resolver\'s own `text` fallback', async () => {
    renderForm({ odd: { type: 'no_such_field_type', label: 'Odd' } }, ['odd']);
    expect(await widgetOf('odd')).toBe(resolveFormWidgetType('no_such_field_type'));
  });
});

describe('WIDGET axis (objectui#10177) — an authored `widget` reaches the widget it names', () => {
  it.each(['object-ref', 'filter-condition', 'recipient-picker'])(
    'renders `%s` for a form-view field that names it',
    async (widget) => {
      renderForm({ target: { type: 'text', label: 'Target' } }, [{ field: 'target', widget }]);
      expect(await widgetOf('target')).toBe(widget);
    },
  );

  it.each(['object-ref', 'filter-condition', 'recipient-picker'])(
    'renders `%s` for an OBJECT field that names it, when the view names none',
    async (widget) => {
      renderForm({ target: { type: 'text', label: 'Target', widget } }, ['target']);
      expect(await widgetOf('target')).toBe(widget);
    },
  );

  it('lets `widget` override `type` — a select field rendered as a text box on request', async () => {
    renderForm(
      { stage: { type: 'select', label: 'Stage', options: ['a', 'b'] } },
      [{ field: 'stage', widget: 'text' }],
    );
    expect(await widgetOf('stage')).toBe('text');
  });

  it('lets the FORM VIEW\'s widget beat the object field\'s', async () => {
    renderForm(
      { target: { type: 'text', label: 'Target', widget: 'object-ref' } },
      [{ field: 'target', widget: 'filter-condition' }],
    );
    expect(await widgetOf('target')).toBe('filter-condition');
  });

  it('CONTROL — with no `widget` anywhere the type decides', async () => {
    renderForm({ target: { type: 'text', label: 'Target' } }, ['target']);
    expect(await widgetOf('target')).toBe('text');
  });
});

describe('ARITY axis — `select` + `multiple: true` is the multiselect widget', () => {
  it('renders the multiselect widget for a multi-value select', async () => {
    renderForm({ tags: { type: 'select', label: 'Tags', multiple: true, options: ['a', 'b'] } }, ['tags']);
    expect(await widgetOf('tags')).toBe('multiselect');
  });

  it('honours `multiple` restated on the FORM VIEW over a single-value object select', async () => {
    renderForm(
      { tags: { type: 'select', label: 'Tags', options: ['a', 'b'] } },
      [{ field: 'tags', multiple: true }],
    );
    expect(await widgetOf('tags')).toBe('multiselect');
  });

  it('CONTROL — a single-value select stays the select widget', async () => {
    renderForm({ stage: { type: 'select', label: 'Stage', options: ['a', 'b'] } }, ['stage']);
    expect(await widgetOf('stage')).toBe('select');
  });

  it('CONTROL — a multi-value lookup keeps the lookup widget, which handles both arities itself', async () => {
    renderForm({ refs: { type: 'lookup', label: 'Refs', multiple: true, reference: 'x' } }, ['refs']);
    expect(await widgetOf('refs')).toBe('lookup');
  });
});

describe('label association follows the widget\'s own labelling declaration', () => {
  it('a `control` widget is named by `<label for>` pointing at the host id', async () => {
    renderForm({ title: { type: 'text', label: 'Title' } }, ['title']);
    await widgetOf('title');
    const label = screen.getByText('Title').closest('label')!;
    expect(label).toHaveAttribute('for', 'f_title');
    expect(screen.getByTestId('widget-title')).toHaveAttribute('id', 'f_title');
    expect(screen.getByTestId('widget-title')).not.toHaveAttribute('aria-labelledby');
  });

  it('a `group` widget is named by IDREF — the label carries an id and no dangling `for`', async () => {
    renderForm({ pick: { type: 'radio', label: 'Pick', options: ['a', 'b'] } }, ['pick']);
    await widgetOf('pick');
    const label = screen.getByText('Pick').closest('label')!;
    expect(label).not.toHaveAttribute('for');
    expect(label.id).toBeTruthy();
    expect(screen.getByTestId('widget-pick')).toHaveAttribute('aria-labelledby', label.id);
  });

  it('a `display` widget is wrapped by the host in a group the label names', async () => {
    renderForm({ total: { type: 'formula', label: 'Total' } }, ['total']);
    await widgetOf('total');
    const label = screen.getByText('Total').closest('label')!;
    expect(label).not.toHaveAttribute('for');
    const group = screen.getByRole('group', { name: 'Total' });
    expect(group).toHaveAttribute('id', 'f_total');
    expect(group).toContainElement(screen.getByTestId('widget-total'));
  });
});
