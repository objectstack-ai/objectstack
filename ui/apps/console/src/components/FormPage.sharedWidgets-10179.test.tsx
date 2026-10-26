// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10179 — the REAL shared widgets on `FormPage`: what they announce,
 * and what they submit.
 *
 * `FormPage.sharedFieldResolver-10179.test.tsx` pins WHICH widget each row
 * mounts, with the widgets stubbed. This file mounts the real ones, for the two
 * questions a stub cannot answer:
 *
 * ## Accessibility (the two defects objectui#10178 measured on the old arms)
 *
 * - A required boolean was named `Agree * Agree`: the row label `for` the
 *   checkbox AND the arm's own wrapping label both named it. It is now named by
 *   the row label alone — exactly once.
 * - A required radio group had no name and no required state: the row label's
 *   `for` named no element (the radios carried no id) and nothing carried
 *   `aria-required`. The shared `RadioField` declares `labelling: 'group'`, so
 *   the label publishes an id and the `radiogroup` answers by IDREF, with
 *   `aria-required` on the group (where ARIA supports it — not on `radio`).
 *
 * ## Value shapes through the real submit
 *
 * The hand-rolled controls wrote their own shapes; the shared widgets write
 * theirs. One per family the old arms did not share a shape with — a date, a
 * number, a multi-value select (an array) and a lookup (a reference id) — is
 * driven through the widget and read back off the request body the page sent.
 *
 * ## The page's own required check
 *
 * The shared widgets announce required on the state channel and never arm the
 * native attribute the hand-rolled controls carried, so the page refuses a
 * submit that leaves a required row empty itself (`findSubmitRefusals`). The
 * refusal is pinned with its control: the same form, filled, submits.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OBJECT_SCHEMA = {
  name: 'showcase_order',
  label: 'Order',
  fields: {
    due: { type: 'date', label: 'Due' },
    qty: { type: 'number', label: 'Quantity' },
    tags: {
      type: 'select',
      label: 'Tags',
      multiple: true,
      options: [
        { value: 'rush', label: 'Rush' },
        { value: 'gift', label: 'Gift' },
      ],
    },
    account: { type: 'lookup', label: 'Account', reference: 'showcase_account' },
    agree: { type: 'boolean', label: 'Agree', required: true },
    priority: {
      type: 'radio',
      label: 'Priority',
      required: true,
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
    },
    mood: {
      type: 'radio',
      label: 'Mood',
      options: [
        { value: 'calm', label: 'Calm' },
        { value: 'busy', label: 'Busy' },
      ],
    },
  },
};

const FIELD_NAMES = ['due', 'qty', 'tags', 'account', 'agree', 'priority', 'mood'];

const ACCOUNTS = [{ id: 'acc_1', name: 'Acme' }];

/** The lookup's data source — the one the console shell provides in real use. */
const dataSource = {
  find: vi.fn(async (_object: string, params?: { $filter?: { id?: { $in?: string[] } } }) => {
    const wanted = params?.$filter?.id?.$in ?? [];
    return { data: wanted.length ? ACCOUNTS.filter((a) => wanted.includes(a.id)) : ACCOUNTS };
  }),
};

let writes: Array<{ method: string; body: Record<string, unknown> }> = [];

function stubFetch() {
  const routes: Array<{ match: string; body: unknown }> = [
    {
      match: '/meta/view/',
      body: {
        name: 'showcase_order.intake',
        object: 'showcase_order',
        viewKind: 'form',
        label: 'Order intake',
        config: { type: 'simple', sections: [{ label: 'Order', fields: FIELD_NAMES }] },
      },
    },
    { match: '/meta/object/', body: OBJECT_SCHEMA },
    { match: '/data/showcase_order', body: { object: 'showcase_order', id: 'o-1', record: { id: 'o-1' } } },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' || method === 'PATCH') {
        writes.push({ method, body: init?.body ? JSON.parse(String(init.body)) : {} });
      }
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

async function renderForm() {
  stubFetch();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <MemoryRouter initialEntries={['/forms/showcase_order.intake']}>
        <Routes>
          <Route path="/forms/:name" element={<FormPage mode="internal" />} />
        </Routes>
      </MemoryRouter>
    </SchemaRendererProvider>,
  );
  // Every widget is lazy; wait for the last row's control before any case.
  await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Mood' })).toBeInTheDocument());
}

beforeEach(() => {
  // The submit button reads the i18n catalogue (objectui#11071) through the
  // provider `main.tsx` mounts above this route. The app's own factory
  // registers its instance as react-i18next's global, which is how this
  // unwrapped route reaches the `en` pack; the harness restores the global
  // after every test (`installI18nGlobalReset`).
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  writes = [];
  dataSource.find.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a11y — the two defects objectui#10178 measured are gone', () => {
  it('a required boolean is named by its label exactly ONCE, and reports required', async () => {
    await renderForm();
    const agree = screen.getByRole('switch', { name: 'Agree' });
    // Exact: `Agree * Agree` (and `Agree Agree`) was the doubled name.
    expect(agree).toHaveAccessibleName('Agree');
    expect(agree).toHaveAttribute('aria-required', 'true');
  });

  it('a required radio group is reachable by its label and exposes its required state', async () => {
    await renderForm();
    const group = screen.getByRole('radiogroup', { name: 'Priority' });
    expect(group).toHaveAttribute('aria-required', 'true');
    // Each option keeps its own name inside the named group.
    expect(screen.getByRole('radio', { name: 'High' })).toBeInTheDocument();
  });

  it('CONTROL — an optional radio group is named the same way and reports no requirement', async () => {
    await renderForm();
    const group = screen.getByRole('radiogroup', { name: 'Mood' });
    expect(group).not.toHaveAttribute('aria-required');
  });
});

describe('value shapes — what the shared widgets emit is what the page submits', () => {
  it('submits a date string, a number, a multiselect array and a lookup id', async () => {
    await renderForm();

    // `date` is the platform picker (objectui#12642): its text box commits on
    // blur, and an ISO day reads in every locale.
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-03-04' } });
    fireEvent.blur(screen.getByLabelText('Due'));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '7' } });

    const tags = screen.getByRole('group', { name: 'Tags' });
    await userEvent.click(tags.querySelector('[data-testid="multiselect-option-rush"]')!);
    await userEvent.click(tags.querySelector('[data-testid="multiselect-option-gift"]')!);

    await userEvent.click(screen.getByTestId('lookup-trigger-account'));
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));

    await userEvent.click(screen.getByRole('switch', { name: 'Agree' }));
    await userEvent.click(screen.getByRole('radio', { name: 'High' }));

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].method).toBe('POST');
    expect(writes[0].body).toMatchObject({
      due: '2026-03-04',
      qty: 7,
      tags: ['rush', 'gift'],
      account: 'acc_1',
      agree: true,
      priority: 'high',
    });
  });
});

describe('the page refuses a submit that leaves a required row empty', () => {
  it('refuses, names the empty row, and writes nothing', async () => {
    await renderForm();
    // `agree` is required too, and is switched on and back OFF: `false` is a
    // VALUE for the required rule (`isMissingForRequired`), so it does not
    // block — the unpicked radio does. (An untouched switch holds no value at
    // all, and is refused like any other empty required row, as the sibling
    // chain's `required` rule refuses it.)
    const agree = screen.getByRole('switch', { name: 'Agree' });
    await userEvent.click(agree);
    await userEvent.click(agree);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByText('Required: Priority')).toBeInTheDocument();
    expect(writes).toHaveLength(0);
  });

  it('CONTROL — the same form with the required radio picked submits', async () => {
    await renderForm();
    const agree = screen.getByRole('switch', { name: 'Agree' });
    await userEvent.click(agree);
    await userEvent.click(agree);
    await userEvent.click(screen.getByRole('radio', { name: 'Low' }));
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({ priority: 'low', agree: false });
    expect(screen.queryByText(/^Required:/)).toBeNull();
  });
});
