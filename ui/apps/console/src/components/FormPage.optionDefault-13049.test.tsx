// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13049 — the public form page (`/f/:slug`) seeds a field's
 * option-list default (`options[].default: true`) the way the create form does.
 *
 * ## What this reproduces
 *
 * HotCRM's public support form: `crm_case.priority` is `required`, its options
 * mark Low `default: true`, and the field declares no `defaultValue`. The
 * server accepts a submit that omits `priority` and stores `low`, but this page
 * opened the select empty and refused the submit on the client with
 * "Required: Priority". The create form had the same defect and was fixed in
 * objectui#11914; this page now calls the SAME reading, `@object-ui/plugin-form`'s
 * `optionListDefault`, from `readPrefill`.
 *
 * ## The legs
 *
 * - SINGLE: a required select opens on the marked option and an untouched
 *   submit sends it (no client refusal).
 * - MULTI: a multi-valued field seeds every marked option, as an array.
 * - Controls, each one a precedence rule the create form already holds:
 *   a literal `defaultValue` wins over the flag; a RUNTIME `defaultValue` is not
 *   replaced (the key stays absent for the server to resolve); a
 *   `prefill_FIELD` query value wins; with no marked option the field stays
 *   empty and the required refusal still fires; an edit form is not seeded.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage, readPrefill } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SLUG = 'support';

let submits: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubFetch(payload: unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      submits.push({ url, body: init.body ? JSON.parse(String(init.body)) : {} });
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({ ok: true }),
        text: async () => '{"ok":true}',
      } as unknown as Response;
    }
    if (!String(url).includes(`/forms/${SLUG}`)) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  });
}

/** A served `/forms/:slug` payload over one object whose fields are `fields`. */
function payloadFor(fields: Record<string, unknown>) {
  return {
    slug: SLUG,
    object: 'crm_case',
    label: 'Support',
    form: { type: 'simple', sections: [{ fields: ['subject', ...Object.keys(fields)] }] },
    objectSchema: {
      name: 'crm_case',
      fields: { subject: { type: 'text', label: 'Subject' }, ...fields },
    },
  };
}

function renderPublic(fields: Record<string, unknown>, search = '') {
  vi.stubGlobal('fetch', stubFetch(payloadFor(fields)));
  return render(
    <MemoryRouter initialEntries={[`/f/${SLUG}${search}`]}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Wait for the form to load, submit it untouched, and return what was posted (or null). */
async function submitUntouched(): Promise<Record<string, unknown> | null> {
  await screen.findByLabelText(/Subject/);
  await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
  await waitFor(() =>
    expect(submits.length > 0 || screen.queryByText(/Required:/) !== null).toBe(true),
  );
  return submits.length > 0 ? submits[0].body : null;
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', default: true },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

beforeEach(() => {
  submits = [];
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('objectui#13049 — the public form seeds an option-list default', () => {
  it('SINGLE: a required select opens on the marked option and an untouched submit sends it', async () => {
    renderPublic({
      priority: { type: 'select', label: 'Priority', required: true, options: PRIORITY_OPTIONS },
    });
    await screen.findByLabelText(/Subject/);
    // Rendered selected: the select's trigger shows the marked option's label.
    expect(screen.getByRole('combobox', { name: /Priority/ }).textContent).toContain('Low');

    const body = await submitUntouched();
    expect(screen.queryByText(/Required:/)).toBeNull();
    expect(body).not.toBeNull();
    expect(body!.priority).toBe('low');
  });

  it('MULTI: a multi-valued field seeds every marked option, as an array', async () => {
    renderPublic({
      channels: {
        type: 'select',
        multiple: true,
        label: 'Channels',
        required: true,
        options: [
          { value: 'email', label: 'Email', default: true },
          { value: 'phone', label: 'Phone' },
          { value: 'chat', label: 'Chat', default: true },
        ],
      },
    });
    const body = await submitUntouched();
    expect(screen.queryByText(/Required:/)).toBeNull();
    expect(body!.channels).toEqual(['email', 'chat']);
  });

  it('CONTROL: a literal `defaultValue` wins over the flag', async () => {
    renderPublic({
      priority: {
        type: 'select',
        label: 'Priority',
        required: true,
        defaultValue: 'high',
        options: PRIORITY_OPTIONS,
      },
    });
    const body = await submitUntouched();
    expect(body!.priority).toBe('high');
  });

  it('CONTROL: a runtime `defaultValue` is not replaced by the flag', async () => {
    renderPublic({
      priority: {
        type: 'select',
        label: 'Priority',
        defaultValue: { dialect: 'cel', source: 'initialPriority()' },
        options: PRIORITY_OPTIONS,
      },
    });
    const body = await submitUntouched();
    // Absent, so the server resolves the declaration — never `low` from the flag.
    expect(body).not.toBeNull();
    expect('priority' in body!).toBe(false);
  });

  it('CONTROL: a `prefill_FIELD` query value wins over the flag', async () => {
    renderPublic(
      { priority: { type: 'select', label: 'Priority', required: true, options: PRIORITY_OPTIONS } },
      '?prefill_priority=medium',
    );
    const body = await submitUntouched();
    expect(body!.priority).toBe('medium');
  });

  it('CONTROL: with no marked option the field stays empty and the required refusal fires', async () => {
    renderPublic({
      priority: {
        type: 'select',
        label: 'Priority',
        required: true,
        options: PRIORITY_OPTIONS.map(({ value, label }) => ({ value, label })),
      },
    });
    const body = await submitUntouched();
    expect(body).toBeNull();
    expect(submits).toHaveLength(0);
    expect(screen.getAllByText(/Required: .*Priority/).length).toBeGreaterThan(0);
  });
});

describe('objectui#13049 — `readPrefill` keeps the stored record first', () => {
  it('CONTROL: an edit form is not seeded from the flag', () => {
    const field = {
      name: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      readonly: false,
      hidden: false,
      colSpan: 1 as const,
      meta: { type: 'select', options: PRIORITY_OPTIONS },
    };
    const search = new URLSearchParams();
    // Create (no record): seeded from the flag.
    expect(readPrefill([field], search)).toEqual({ priority: 'low' });
    // Edit, column unset on the stored row: not this form's to fill.
    expect(readPrefill([field], search, { id: 'case-1' })).toEqual({});
    // Edit, stored value: the stored value.
    expect(readPrefill([field], search, { id: 'case-1', priority: 'high' })).toEqual({
      priority: 'high',
    });
  });
});
