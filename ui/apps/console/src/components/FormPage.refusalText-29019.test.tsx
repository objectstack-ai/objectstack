// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29019 — a refused write says a sentence in the
 * reader's language, never the response body.
 *
 * A member with read but no create right opened a form link, pressed Submit,
 * and the banner and the toast both read the server's answer verbatim:
 * `Create failed (403): {"error":"You do not have permission…","code":
 * "PERMISSION_DENIED","object":"…"}` — English JSON, with the object's machine
 * name, under a page whose report twin says "You don't have access".
 *
 * The page now reads the refusal the way the record dialog does: a denial is
 * the localized `form.noPermissionToSave` line, a server fault (`5xx`) the
 * localized `form.submitFailed` line, a `4xx` the server's own sentence out of
 * the envelope, and the rows a refusal names are still marked. The fixtures
 * are the envelopes the server answers: the flat body the data routes answer,
 * the runtime dispatcher's wrapped one, and a proxy's markup page.
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
};

/** The QA run's refusal, byte for byte: a `POST /data/:object` without create. */
const PERMISSION_DENIED = {
  status: 403,
  body: {
    error: 'You do not have permission to perform this action. Contact your administrator if you need access.',
    code: 'PERMISSION_DENIED',
    object: 'qar8_fsb',
  },
};

let posts = 0;

type Refusal = { status: number; body: unknown };

/** One answer of the stubbed server; a string body goes out as it is. */
function answer(ok: boolean, status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Refused',
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

/** The internal route `/forms/:name`, refusing its `POST /data/:object` with `refusal`. */
function stubInternal(refusal: Refusal) {
  const view = {
    name: 'qar8_fsb.form',
    object: 'qar8_fsb',
    viewKind: 'form',
    label: 'Feedback',
    config: { type: 'simple', sections: [{ fields: ['name', 'email'] }] },
  };
  const object = { name: 'qar8_fsb', label: 'Feedback', fields: FIELDS };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
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
    <MemoryRouter initialEntries={['/forms/qar8_fsb.form']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The public route `/f/:slug`, refusing its `POST /forms/:slug/submit` with `refusal`. */
function stubPublic(refusal: Refusal) {
  const payload = {
    slug: 'feedback',
    object: 'qar8_fsb',
    label: 'Feedback',
    form: { type: 'simple', sections: [{ fields: ['name', 'email'] }] },
    objectSchema: { name: 'qar8_fsb', fields: FIELDS },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return answer(false, refusal.status, refusal.body);
      }
      if (!String(url).includes('/forms/')) throw new Error(`unstubbed fetch: ${url}`);
      return answer(true, 200, payload);
    }),
  );
  return render(
    <MemoryRouter initialEntries={['/f/feedback']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(submitName: RegExp | string = /Submit/) {
  await userEvent.type(await screen.findByLabelText('Name'), 'Ada');
  await userEvent.click(screen.getByRole('button', { name: submitName }));
}

/** The banner's text, once the refusal has drawn it. */
async function bannerText(): Promise<string> {
  await waitFor(() => expect(document.querySelector('[id^="form-error:"]')).not.toBeNull());
  return document.querySelector('[id^="form-error:"]')?.textContent ?? '';
}

/** The one refusal toast's content, as a string. */
function toastText(): string {
  expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  return String(vi.mocked(toast.error).mock.calls[0][0]);
}

/** Neither the body nor the transport's prose reached the reader. */
function expectNoRawBody(text: string, status: number) {
  expect(text).not.toContain('{');
  expect(text).not.toContain(String(status));
  expect(text).not.toMatch(/failed \(/);
}

beforeEach(() => {
  posts = 0;
  vi.mocked(toast.error).mockClear();
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#29019 — a denied create reads the localized denial', () => {
  it('internal route: the 403 PERMISSION_DENIED banner and toast say the same localized sentence', async () => {
    stubInternal(PERMISSION_DENIED);
    await fillAndSubmit();

    const banner = await bannerText();
    expect(posts).toBe(1);
    expect(banner).toBe("You don't have permission to save this record.");
    expect(toastText()).toBe(banner);
    expectNoRawBody(banner, 403);
    // No row is to blame for a denial.
    expect(document.querySelectorAll('[id$="-error"]')).toHaveLength(0);
  });

  it('zh: the same refusal reads in the reader\'s language', async () => {
    createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
    stubInternal(PERMISSION_DENIED);
    await fillAndSubmit('提交');

    const banner = await bannerText();
    expect(banner).toBe('您没有权限保存这条记录。');
    expect(toastText()).toBe(banner);
    expectNoRawBody(banner, 403);
  });

  it('public route: the dispatcher\'s wrapped 403 envelope reads the same denial', async () => {
    stubPublic({
      status: 403,
      body: {
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'Access denied for qar8_fsb', httpStatus: 403 },
      },
    });
    await fillAndSubmit();

    const banner = await bannerText();
    expect(banner).toBe("You don't have permission to save this record.");
    expect(toastText()).toBe(banner);
    expectNoRawBody(banner, 403);
  });

  it('a sentence the producer marked for the end user is said as written', async () => {
    stubInternal({
      status: 403,
      body: { ...PERMISSION_DENIED.body, userMessage: 'Feedback closes on Fridays.' },
    });
    await fillAndSubmit();

    expect(await bannerText()).toBe('Feedback closes on Fridays.');
    expect(toastText()).toBe('Feedback closes on Fridays.');
  });
});

describe('#29019 — every other refusal', () => {
  it('a 400 with field details still marks its fields, and says no body', async () => {
    stubInternal({
      status: 400,
      body: {
        error: 'Validation failed',
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'email', code: 'required', message: 'Email is required' }],
      },
    });
    await fillAndSubmit();

    const email = screen.getByLabelText('Email');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(email.getAttribute('aria-describedby') ?? '')?.textContent).toContain(
      'Email is required',
    );
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
    const banner = await bannerText();
    expect(banner).toBe('Validation failed');
    expect(toastText()).toBe(banner);
    expectNoRawBody(banner, 400);
  });

  it('a 500 reads the localized generic sentence, not the server fault', async () => {
    stubInternal({
      status: 500,
      body: { error: 'SQLITE_ERROR: no such table: qar8_fsb', code: 'INTERNAL_ERROR' },
    });
    await fillAndSubmit();

    const banner = await bannerText();
    expect(banner).toBe('Could not save. Please try again.');
    expect(toastText()).toBe(banner);
    expectNoRawBody(banner, 500);
    expect(banner).not.toContain('SQLITE');
  });

  it('a proxy\'s markup page reads the localized generic sentence', async () => {
    stubPublic({ status: 502, body: '<html><body><h1>502 Bad Gateway</h1></body></html>' });
    await fillAndSubmit();

    const banner = await bannerText();
    expect(banner).toBe('Could not save. Please try again.');
    expect(toastText()).toBe(banner);
    expect(banner).not.toContain('<');
  });
});
