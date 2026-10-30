// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27398 row 2 — on the public form, an empty
 * optional currency field reads as empty.
 *
 * Measured on HotCRM's Contact Us form: the optional Annual Revenue box showed
 * `0.00` before anyone typed, which reads as an answer. The page hands the
 * shared `CurrencyField` the row's merged `placeholder`; the widget used to
 * fall back to `0.00` when that was absent. These pins drive the real public
 * route (`/f/:slug`) over a served payload.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const LEAD_SCHEMA = {
  name: 'crm_lead',
  label: 'Lead',
  fields: {
    company: { type: 'text', label: 'Company', required: true },
    annual_revenue: { type: 'currency', label: 'Annual Revenue', currency: 'USD' },
    budget: { type: 'currency', label: 'Budget', currency: 'USD', placeholder: 'Rough figure' },
  },
};

function stubFetch(body: unknown) {
  return vi.fn(async (url: string) => {
    if (!String(url).includes('/forms/contact-us')) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

function renderPublic(fields: unknown[]) {
  vi.stubGlobal(
    'fetch',
    stubFetch({
      slug: 'contact-us',
      object: 'crm_lead',
      form: { type: 'simple', title: 'Contact us', sections: [{ name: 'about', label: 'About you', fields }] },
      objectSchema: LEAD_SCHEMA,
    }),
  );
  return render(
    <MemoryRouter initialEntries={['/f/contact-us']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The currency box of one row, once its lazy widget has resolved. */
async function currencyBox(container: HTMLElement, name: string): Promise<HTMLInputElement> {
  let el: HTMLInputElement | null = null;
  await waitFor(() => {
    el = container.querySelector(`[data-field="${name}"] input[type=number]`)
      ?? container.querySelector(`input[type=number][name="${name}"]`);
    expect(el).not.toBeNull();
  });
  return el!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('public form — an empty currency field shows no 0.00 stand-in (objectstack#27398 row 2)', () => {
  it('an optional amount with no placeholder renders an empty box with no placeholder', async () => {
    const { container } = renderPublic(['company', 'annual_revenue']);
    const input = await currencyBox(container, 'annual_revenue');
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder') ?? '').toBe('');
  });

  it("CONTROL — the object field's own placeholder still reaches the box", async () => {
    const { container } = renderPublic(['budget']);
    const input = await currencyBox(container, 'budget');
    expect(input).toHaveAttribute('placeholder', 'Rough figure');
  });

  it("CONTROL — the form row's placeholder override still wins", async () => {
    const { container } = renderPublic([{ field: 'annual_revenue', placeholder: 'Optional' }]);
    const input = await currencyBox(container, 'annual_revenue');
    expect(input).toHaveAttribute('placeholder', 'Optional');
  });
});
