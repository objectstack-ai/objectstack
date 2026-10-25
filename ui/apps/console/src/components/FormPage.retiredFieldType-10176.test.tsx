// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10176 — a `FormPage` row whose `type` is a RETIRED field-type
 * spelling renders the tombstone that refuses it visibly, and no editable
 * control.
 *
 * ## The defect, and what fixed it
 *
 * objectui#4814 retired `owner` and gave every retired spelling a tombstone
 * widget (`RetiredFieldTombstone`) so an author who writes one is TOLD, rather
 * than handed a text box that looks like it worked. This page used to draw its
 * rows with its own `switch (field.type)`, which had no `owner` arm: the
 * retired spelling fell through to the default arm and rendered a working
 * `input type=text` on both the `/f/:slug` and `/forms/:name` routes.
 *
 * objectui#10457 replaced that switch with the shared resolver
 * (`resolveFormWidgetType` + `getLazyFieldWidget`), and the resolver's answer
 * for a retired spelling IS the tombstone. So the defect is gone. This file
 * pins it, because no other `FormPage` suite drives a retired type: the TYPE
 * table in `FormPage.sharedFieldResolver-10179.test.tsx` walks the spec's
 * declared `FieldType`, which has no retired member, and stubs the widget.
 *
 * ## Where the retired set comes from
 *
 * `RETIRED_FIELD_TYPES`, read AT RUNTIME from `@object-ui/fields`. That is the
 * table the resolver consults (it lives in `@object-ui/core`, and
 * `@object-ui/fields` re-exports it). It does not come from
 * `@objectstack/spec`: the spec has no retired-field-type table, and `owner`
 * was never a spec `FieldType`. Every key is driven, so a spelling retired
 * later is covered with no edit here. The population is asserted non-empty,
 * and to contain `owner`, the card's case, so an empty read cannot pass.
 *
 * ## The control row
 *
 * The same form carries a live `text` row. It must render its real widget, an
 * editable textbox that `EDITABLE_CONTROL` matches. That proves the query the
 * retired rows are judged by can fire at all.
 *
 * Real widgets, not stubs: the question is what the page puts on screen, and a
 * stubbed `getLazyFieldWidget` would answer it by construction.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RETIRED_FIELD_TYPES } from '@object-ui/fields';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** The retired spellings, from the resolver's own table. */
const RETIRED: readonly string[] = Object.keys(RETIRED_FIELD_TYPES);

/** Anything a user could type into, pick from, or toggle. */
const EDITABLE_CONTROL = [
  'input',
  'select',
  'textarea',
  'button',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="spinbutton"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(', ');

const retiredName = (spelling: string) => `retired_${spelling}`;
const retiredLabel = (spelling: string) => `Retired ${spelling}`;
const LIVE = { name: 'live_text', label: 'Live text' };

const OBJECT_SCHEMA = {
  name: 'probe',
  label: 'Probe',
  fields: {
    ...Object.fromEntries(RETIRED.map((t) => [retiredName(t), { type: t, label: retiredLabel(t) }])),
    [LIVE.name]: { type: 'text', label: LIVE.label },
  },
};

const FIELD_NAMES = [...RETIRED.map(retiredName), LIVE.name];

function stubFetch(routes: Array<{ match: string; body: unknown }>) {
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
}

/** Both routes the card names. They share one field layer, and both are driven. */
const ROUTES = [
  {
    route: '/forms/:name',
    render: () => {
      stubFetch([
        {
          match: '/meta/view/',
          body: {
            name: 'probe.form',
            object: 'probe',
            viewKind: 'form',
            label: 'Probe',
            config: { type: 'simple', sections: [{ label: 'Probe', fields: FIELD_NAMES }] },
          },
        },
        { match: '/meta/object/', body: OBJECT_SCHEMA },
      ]);
      render(
        <MemoryRouter initialEntries={['/forms/probe.form']}>
          <Routes>
            <Route path="/forms/:name" element={<FormPage mode="internal" />} />
          </Routes>
        </MemoryRouter>,
      );
    },
  },
  {
    route: '/f/:slug',
    render: () => {
      stubFetch([
        {
          match: '/forms/probe',
          body: {
            slug: 'probe',
            object: 'probe',
            form: { type: 'simple', title: 'Probe', sections: [{ label: 'Probe', fields: FIELD_NAMES }] },
            objectSchema: OBJECT_SCHEMA,
          },
        },
      ]);
      render(
        <MemoryRouter initialEntries={['/f/probe']}>
          <Routes>
            <Route path="/f/:slug" element={<FormPage mode="public" />} />
          </Routes>
        </MemoryRouter>,
      );
    },
  },
];

/** A row: the element that holds the row's label and its control. */
function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: 'label' }).parentElement;
  if (!row) throw new Error(`no row holds the label ${label}`);
  return row;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the retired set is read from the resolver\'s table, not restated', () => {
  it('is non-empty and contains `owner`, the card\'s case', () => {
    expect(RETIRED.length).toBeGreaterThan(0);
    expect(RETIRED).toContain('owner');
  });
});

describe.each(ROUTES)('objectui#10176 on $route', ({ render: renderRoute }) => {
  it.each(RETIRED)(
    'a row whose type is the retired `%s` renders the tombstone and no editable control',
    async (spelling) => {
      // The tombstone reports the retirement on the console; that report is
      // not what this file judges.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderRoute();
      // The live row's widget is lazy. Once it is on screen, every row is.
      await screen.findByRole('textbox', { name: LIVE.label });

      const row = rowOf(retiredLabel(spelling));
      const tombstone = row.querySelector('[data-testid="field-retired-tombstone"]');
      // One object, so a failure reports every fact at once: a row that
      // renders a control instead of the refusal fails on both halves.
      expect({
        tombstoneNames: tombstone?.getAttribute('data-retired-field-type') ?? null,
        tombstoneRole: tombstone?.getAttribute('role') ?? null,
        editableControls: row.querySelectorAll(EDITABLE_CONTROL).length,
      }).toEqual({ tombstoneNames: spelling, tombstoneRole: 'alert', editableControls: 0 });
    },
  );

  it('CONTROL — the live `text` row renders its widget, an editable textbox', async () => {
    renderRoute();
    const input = await screen.findByRole('textbox', { name: LIVE.label });
    const row = rowOf(LIVE.label);
    expect(row).toContainElement(input);
    expect(input).toBeEnabled();
    expect(row.querySelectorAll(EDITABLE_CONTROL).length).toBeGreaterThan(0);
    expect(row.querySelector('[data-testid="field-retired-tombstone"]')).toBeNull();
  });
});
