// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10471 — a `FormPage` row whose retired spelling arrives through
 * `widget` renders the tombstone for THAT spelling, not for the row's live
 * `type`.
 *
 * ## The defect
 *
 * `FormPage` resolves a row's widget key from `field.widget` first
 * (`resolveFieldWidgetKey`), so a row authored `{ type: 'user', widget:
 * 'owner' }` is answered by the `owner` tombstone. The tombstone used to
 * re-derive its spelling from the `field` it was handed, whose `type` is the
 * row's LIVE type — so the page said "Field type `user` was retired", named
 * `user` in `data-retired-field-type`, and the migration prescription for the
 * spelling the author actually wrote was lost.
 *
 * The fix is in `@object-ui/fields`: `getLazyFieldWidget`, the door this page
 * renders every row through, now answers a retired key with a tombstone bound
 * to that key. This page is unchanged; this file pins what it puts on screen.
 *
 * ## The rows
 *
 *  - the card's two reproductions: a form-view `{ field, widget }` over a
 *    `user` object field, and an object field `{ type: 'text', widget }`;
 *  - CONTROL: an object field whose `type` IS the retired spelling, the
 *    objectui#10176 case — it must still name that spelling, so the pin's
 *    expected value is the one the working path produces;
 *  - a live `text` row, awaited so every lazy row is on screen.
 *
 * Every key of `RETIRED_FIELD_TYPES` is driven, read at runtime from
 * `@object-ui/fields`, and the prescription is compared against the table's
 * own value — never restated here.
 *
 * Real widgets, not stubs: a stubbed `getLazyFieldWidget` would answer the
 * question by construction.
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RETIRED_FIELD_TYPES, resetRetiredFieldTypeReports } from '@object-ui/fields';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** The retired spellings, from the resolver's own table. */
const RETIRED: readonly string[] = Object.keys(RETIRED_FIELD_TYPES);

/** The rows each retired spelling is driven through, per the card. */
const ROWS = [
  {
    kind: 'REPRODUCTION — a form-view `widget` over a `user` field',
    name: (s: string) => `view_widget_${s}`,
    label: (s: string) => `View widget ${s}`,
    def: (s: string) => ({ type: 'user', label: `View widget ${s}` }),
    entry: (s: string) => ({ field: `view_widget_${s}`, widget: s }),
  },
  {
    kind: 'REPRODUCTION — an object field `{ type: \'text\', widget }`',
    name: (s: string) => `object_widget_${s}`,
    label: (s: string) => `Object widget ${s}`,
    def: (s: string) => ({ type: 'text', widget: s, label: `Object widget ${s}` }),
    entry: (s: string) => `object_widget_${s}`,
  },
  {
    kind: 'CONTROL — an object field whose `type` is the retired spelling',
    name: (s: string) => `typed_${s}`,
    label: (s: string) => `Typed ${s}`,
    def: (s: string) => ({ type: s, label: `Typed ${s}` }),
    entry: (s: string) => `typed_${s}`,
  },
] as const;

const LIVE = { name: 'live_text', label: 'Live text' };

const OBJECT_SCHEMA = {
  name: 'probe',
  label: 'Probe',
  fields: {
    ...Object.fromEntries(RETIRED.flatMap((s) => ROWS.map((r) => [r.name(s), r.def(s)]))),
    [LIVE.name]: { type: 'text', label: LIVE.label },
  },
};

const SECTION_FIELDS = [...RETIRED.flatMap((s) => ROWS.map((r) => r.entry(s))), LIVE.name];

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

/** Both routes; they share one field layer, and both are driven. */
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
            config: { type: 'simple', sections: [{ label: 'Probe', fields: SECTION_FIELDS }] },
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
            form: { type: 'simple', title: 'Probe', sections: [{ label: 'Probe', fields: SECTION_FIELDS }] },
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

beforeEach(() => {
  resetRetiredFieldTypeReports();
});

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

describe.each(ROUTES)('objectui#10471 on $route', ({ render: renderRoute }) => {
  describe.each(RETIRED)('retired spelling `%s`', (spelling) => {
    it.each(ROWS.map((row) => [row.kind, row] as const))('%s names the resolved spelling and says its prescription', async (_kind, row) => {
      // The tombstone reports the retirement on the console; `@object-ui/fields`'
      // own pin judges that half.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderRoute();
      // The rows are lazy. Once the live row is on screen, every row is.
      await screen.findByRole('textbox', { name: LIVE.label });

      const tombstone = rowOf(row.label(spelling)).querySelector(
        '[data-testid="field-retired-tombstone"]',
      );
      // One object, so a failure reports every fact at once.
      expect({
        names: tombstone?.getAttribute('data-retired-field-type') ?? null,
        role: tombstone?.getAttribute('role') ?? null,
        says: tombstone?.textContent ?? null,
      }).toEqual({ names: spelling, role: 'alert', says: RETIRED_FIELD_TYPES[spelling] });
    });
  });
});
