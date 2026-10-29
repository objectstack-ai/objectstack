// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27417 — a refused submit marks the fields it names.
 *
 * Every refusal on this page used to end in one string, on the banner and the
 * outcome toast, and nothing on the inputs: the submitter read "Required: Name,
 * Email" or a server sentence and had to find the rows themselves. Each refused
 * row now carries `aria-invalid` and a reason under its control, which the
 * control names in `aria-describedby`.
 *
 * The server half reads the refusal with the record dialog's reader of the
 * server's field paths, `extractFieldErrors` (`@object-ui/react`); this page
 * only attaches the response body to the error it throws. So the fixtures below
 * are the envelopes the server actually answers: the flat `400
 * VALIDATION_FAILED` with `fields[]` the public submit route maps a validation
 * error to, the same refusal in the runtime dispatcher's wrapped envelope, and
 * the flat `409 UNIQUE_VIOLATION` naming its one `field`.
 *
 * The banner and the toast are unchanged: a refusal that names no field marks
 * no row and still says what it said before.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
  company: { type: 'text', label: 'Company' },
};

function publicPayload(sectionFields: unknown[], fields: Record<string, unknown> = FIELDS) {
  return {
    slug: 'contact-us',
    object: 'showcase_inquiry',
    label: 'Contact us',
    form: { type: 'simple', sections: [{ fields: sectionFields }] },
    objectSchema: { name: 'showcase_inquiry', fields },
  };
}

let posts = 0;

/** Answers the resolver, and every submit with `refusal` (status + JSON body). */
function stubPublic(
  sectionFields: unknown[],
  refusal: { status: number; body: unknown },
  fields?: Record<string, unknown>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return {
          ok: false,
          status: refusal.status,
          statusText: 'Refused',
          text: async () => JSON.stringify(refusal.body),
          json: async () => refusal.body,
        } as unknown as Response;
      }
      if (!String(url).includes('/forms/')) throw new Error(`unstubbed fetch: ${url}`);
      const payload = publicPayload(sectionFields, fields);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
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

/** The internal route, refusing its `POST /data/:object` with `refusal`. */
function stubInternal(refusal: { status: number; body: unknown }) {
  const view = {
    name: 'showcase_inquiry.contact',
    object: 'showcase_inquiry',
    viewKind: 'form',
    label: 'Contact',
    config: { type: 'simple', sections: [{ fields: ['name', 'email', 'company'] }] },
  };
  const object = { name: 'showcase_inquiry', label: 'Inquiry', fields: FIELDS };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const answer = (ok: boolean, status: number, body: unknown) =>
        ({
          ok,
          status,
          statusText: ok ? 'OK' : 'Refused',
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as unknown as Response;
      if (init?.method === 'POST') {
        posts += 1;
        return answer(false, refusal.status, refusal.body);
      }
      if (String(url).includes('/meta/view/')) return answer(true, 200, view);
      if (String(url).includes('/meta/object/')) return answer(true, 200, object);
      throw new Error(`unstubbed fetch: ${url}`);
    }),
  );
  return render(
    <MemoryRouter initialEntries={['/forms/showcase_inquiry.contact']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The text a control names in `aria-describedby`, or null when it names none. */
function describedText(control: HTMLElement): string | null {
  const id = control.getAttribute('aria-describedby');
  if (!id) return null;
  return id
    .split(/\s+/)
    .map((ref) => document.getElementById(ref)?.textContent ?? '')
    .join(' ')
    .trim();
}

async function fillAndSubmit(fill: Record<string, string>) {
  await screen.findByLabelText(/^Name/);
  for (const [label, value] of Object.entries(fill)) {
    await userEvent.type(screen.getByLabelText(label), value);
  }
  await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
}

const VALIDATION_FAILED_FIELDS = [
  { field: 'name', code: 'max_length', message: 'Name must be at most 3 characters' },
  { field: 'email', code: 'invalid_format', message: 'Email is not a valid email address' },
];

beforeEach(() => {
  posts = 0;
  vi.mocked(toast.error).mockClear();
  // The page's chrome reads the `en` pack through react-i18next's global, as
  // the sibling FormPage suites set it up.
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#27417 — a server refusal naming fields marks each of them', () => {
  it('public route: the flat 400 VALIDATION_FAILED marks both named fields and no other', async () => {
    stubPublic(['name', 'email', 'company'], {
      status: 400,
      body: { error: 'Validation failed', code: 'VALIDATION_FAILED', fields: VALIDATION_FAILED_FIELDS },
    });
    await fillAndSubmit({ Name: 'Ada Lovelace', Email: 'ada' });

    const name = screen.getByLabelText('Name');
    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(name)).toContain('Name must be at most 3 characters');
    expect(describedText(email)).toContain('Email is not a valid email address');
    // The row the refusal does not name stays unmarked.
    expect(screen.getByLabelText('Company')).not.toHaveAttribute('aria-invalid', 'true');
    // The banner and the toast are unchanged.
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('Submit failed (400)');
  });

  it('internal route: the wrapped dispatcher envelope marks both named fields', async () => {
    stubInternal({
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          httpStatus: 400,
          details: { fields: VALIDATION_FAILED_FIELDS },
        },
      },
    });
    await fillAndSubmit({ Name: 'Ada Lovelace', Email: 'ada' });

    const name = screen.getByLabelText('Name');
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Company')).not.toHaveAttribute('aria-invalid', 'true');
    expect(describedText(name)).toContain('Name must be at most 3 characters');
  });

  it('marks the one field a 409 UNIQUE_VIOLATION names, with the server sentence', async () => {
    stubPublic(['name', 'email', 'company'], {
      status: 409,
      body: {
        error: 'An inquiry with this email already exists.',
        code: 'UNIQUE_VIOLATION',
        field: 'email',
        object: 'showcase_inquiry',
      },
    });
    await fillAndSubmit({ Name: 'Ada', Email: 'ada@example.com' });

    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(describedText(email)).toContain('An inquiry with this email already exists.');
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('an edit to a marked row clears its mark and leaves the others', async () => {
    stubPublic(['name', 'email', 'company'], {
      status: 400,
      body: { error: 'Validation failed', code: 'VALIDATION_FAILED', fields: VALIDATION_FAILED_FIELDS },
    });
    await fillAndSubmit({ Name: 'Ada Lovelace', Email: 'ada' });
    const name = screen.getByLabelText('Name');
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));

    await userEvent.type(name, '!');
    expect(name).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Name must be at most 3 characters')).toBeNull();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('#27417 — a refusal naming no field marks none', () => {
  it('a 400 with no field list leaves every row unmarked and keeps the banner', async () => {
    stubPublic(['name', 'email', 'company'], {
      status: 400,
      body: { error: 'Invalid inquiry status transition.', code: 'VALIDATION_ERROR' },
    });
    await fillAndSubmit({ Name: 'Ada', Email: 'ada@example.com' });

    expect(await screen.findByText(/Invalid inquiry status transition\./)).toBeInTheDocument();
    for (const label of ['Name', 'Email', 'Company']) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute('aria-invalid', 'true');
    }
    // No row was given a reason to point at.
    expect(document.querySelectorAll('[id$="-error"]')).toHaveLength(0);
  });

  it('a field the form does not draw marks nothing', async () => {
    stubPublic(['name', 'email'], {
      status: 400,
      body: {
        error: 'Validation failed',
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'company', message: 'Company is required' }],
      },
    });
    await fillAndSubmit({ Name: 'Ada', Email: 'ada@example.com' });

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Company is required')).toBeNull();
  });
});

describe('#27417 — the client required refusal marks the missing fields', () => {
  it('marks each required row left empty, writes nothing, and leaves the filled one', async () => {
    stubPublic(
      [{ field: 'name', required: true }, { field: 'email', required: true }, 'company'],
      { status: 500, body: { error: 'must not be reached' } },
    );
    await fillAndSubmit({ Company: 'Analytical Engines' });

    expect(await screen.findByText('Required: Name, Email')).toBeInTheDocument();
    expect(posts).toBe(0);
    const name = screen.getByLabelText(/^Name/);
    const email = screen.getByLabelText(/^Email/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(name)).toBe('Name is required');
    expect(describedText(email)).toBe('Email is required');
    expect(screen.getByLabelText('Company')).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('#27417 — a faulted visibleWhen marks its row and points it at the banner', () => {
  it('marks the faulted row, names the banner, and repeats no text under it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubPublic(
      ['name', 'email', 'company'],
      { status: 500, body: { error: 'must not be reached' } },
      { ...FIELDS, company: { type: 'text', label: 'Company', visibleWhen: 'record.name ==' } },
    );
    await fillAndSubmit({ Name: 'Ada', Email: 'ada@example.com' });

    const banner = await screen.findByText(/visibleWhen rule of Company could not be evaluated/);
    expect(posts).toBe(0);
    const company = screen.getByLabelText('Company');
    expect(company).toHaveAttribute('aria-invalid', 'true');
    expect(company.getAttribute('aria-describedby')).toBe(banner.id);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
    warn.mockRestore();
  });
});
