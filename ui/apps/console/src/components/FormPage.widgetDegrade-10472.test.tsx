// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10472 — an authored `widget` that names nothing registered degrades
 * to the field's `type` renderer, and a registered one still wins over `type`.
 *
 * ## The contract
 *
 * The spec's `FieldSchema.widget` describe: "Form widget override — names a
 * registered field component (resolved as `field:<widget>`) to render this
 * field instead of the `type` default. Degrades to the `type` renderer when
 * unregistered."
 *
 * ## The defect
 *
 * The `widget` leg of `resolveFieldWidgetKey` returned
 * `resolveFormWidgetType(field.widget)` whenever a `widget` was present, and
 * that resolver answers a spelling nothing registers with `text`. So a `select`
 * field carrying `widget: 'no_such_widget'` rendered a free-text input, where
 * the contract says it renders its select.
 *
 * ## How it is observed
 *
 * Real widgets, not stubs: the question is what the page puts on screen, and a
 * stubbed `getLazyFieldWidget` would answer it by construction. Each control is
 * found by ROLE and by the row's visible label, so the same query also proves
 * the label reaches the control the row really renders (the label association
 * reads the same resolver).
 *
 * The lit control is the other half of the rule: a REGISTERED widget
 * (`radio`) on the same `select` field still beats the type. Without it, a
 * change that ignored `widget` altogether would pass the degrade pins.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'won', label: 'Won' },
];

/** A spelling no widget is registered under. */
const UNREGISTERED = 'no_such_widget';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectui#10472 — an unregistered `widget` degrades to the `type` renderer', () => {
  it('renders the select for a `select` OBJECT field whose `widget` names nothing', async () => {
    renderForm({ stage: { type: 'select', label: 'Stage', options: OPTIONS, widget: UNREGISTERED } }, ['stage']);
    expect(await screen.findByRole('combobox', { name: 'Stage' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Stage' })).toBeNull();
  });

  it('renders the select for a FORM-VIEW field whose `widget` names nothing', async () => {
    renderForm(
      { stage: { type: 'select', label: 'Stage', options: OPTIONS } },
      [{ field: 'stage', widget: UNREGISTERED }],
    );
    expect(await screen.findByRole('combobox', { name: 'Stage' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Stage' })).toBeNull();
  });

  it('CONTROL — a REGISTERED `widget` still wins over the type: `radio` on the same select field', async () => {
    renderForm({ stage: { type: 'select', label: 'Stage', options: OPTIONS, widget: 'radio' } }, ['stage']);
    expect(await screen.findByRole('radiogroup', { name: 'Stage' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Stage' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Stage' })).toBeNull();
  });

  it('CONTROL — a RETIRED `widget` spelling is not "unregistered": `owner` still reaches its tombstone', async () => {
    // The tombstone reports the retirement on the console; that report is not
    // what this file judges. Nor is WHICH spelling the tombstone names — only
    // that the refusal renders instead of the type's live picker.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderForm(
      {
        who: { type: 'user', label: 'Who', widget: 'owner' },
        live: { type: 'text', label: 'Live' },
      },
      ['who', 'live'],
    );
    // The live row's widget is lazy. Once it is on screen, every row is.
    await screen.findByRole('textbox', { name: 'Live' });
    const row = screen.getByText('Who', { selector: 'label' }).parentElement!;
    expect(row.querySelector('[data-testid="field-retired-tombstone"]')).not.toBeNull();
    expect(row.querySelectorAll('input, button, [role="combobox"]')).toHaveLength(0);
  });
});
