// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11039 — the form page's feedback chrome speaks the session locale.
 *
 * `/f/:slug` (and the internal `/forms/:name`) rendered its loading line, its
 * success toast and its thank-you panel from English literals, so a zh visitor
 * who submitted a published form read `Submitted`, `Thanks!` and `Your
 * submission has been received.` under a Chinese form. They now resolve through
 * the app's i18n catalogue, with the same pack keys plugin-form's forms read:
 * `common.loading`, `form.submitted`, and `publicForm.thankYouTitle` /
 * `publicForm.thankYouMessage`.
 *
 * Only the DEFAULTS move: a thank-you `title` / `message` the form declares
 * still renders as declared (the `CONTROL` case).
 *
 * ## Why no `I18nProvider` appears in this file
 *
 * Same reason as `FormPage.sectionLabelI18n.test.tsx`: the route under test is
 * exactly the one `App` declares, with nothing wrapped around it that
 * production does not have. The catalogue reaches it the way it reaches every
 * unwrapped consumer: `createI18n` — the factory `I18nProvider` itself calls —
 * registers its instance as react-i18next's process-global, and the harness
 * puts the pristine global back after every test (`installI18nGlobalReset`).
 * The DOM setup makes every built-in catalogue resident, as `main.tsx`'s
 * `preloadBootstrapLocale()` does before first paint.
 *
 * Measured against the merge-base `FormPage` (this file at this head): the three
 * zh cases fail, because the literals render verbatim, and the `en` case fails
 * at its first assertion, because two strings' English changed with their keys:
 * `Thanks!` is now `Thank you!`, and the message gained `successfully`. The
 * `CONTROL` case passes there too: declared copy always won.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

/** The public `/forms/:slug` resolver payload. */
function publicPayload(submitBehavior?: unknown) {
  return {
    slug: 'contact-us',
    object: 'showcase_inquiry',
    label: 'Contact us',
    form: {
      type: 'simple',
      sections: [{ fields: ['title'] }],
      ...(submitBehavior ? { submitBehavior } : {}),
    },
    objectSchema: { name: 'showcase_inquiry', fields: { title: { type: 'text', label: 'Title' } } },
  };
}

/**
 * Answers the resolver and the submit. With `holdLoad`, the resolver read never
 * settles, so the page stays on its loading line.
 */
function stubFetch(payload: unknown, { holdLoad = false } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method !== 'POST' && holdLoad) return new Promise<Response>(() => {});
    const body = init?.method === 'POST' ? { ok: true } : payload;
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

function renderPublic() {
  return render(
    <MemoryRouter initialEntries={['/f/contact-us']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Submit the loaded form through the button's name in the session language:
 * the button is chrome the catalogue localises (objectui#11071), so a zh page
 * offers `提交`, not `Submit`.
 */
async function submit(name: string) {
  await screen.findByLabelText(/Title/);
  await userEvent.click(screen.getByRole('button', { name }));
}

function inLanguage(language: string) {
  createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
}

beforeEach(() => {
  toastSuccess.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FormPage chrome resolves through the i18n catalogue (objectui#11039)', () => {
  it('zh: the loading line is the zh pack\'s', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload(), { holdLoad: true }));
    renderPublic();

    expect(await screen.findByText('加载中…')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Loading');
  });

  it('zh: the success toast is 已提交', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload()));
    renderPublic();
    await submit('提交');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toBe('已提交');
  });

  it('zh: the default thank-you panel is the zh pack\'s heading and message', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload()));
    renderPublic();
    await submit('提交');

    expect(await screen.findByRole('heading', { name: '感谢您的提交！' })).toBeInTheDocument();
    expect(screen.getByText('我们已成功收到您的信息。')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Thank');
    expect(document.body.textContent).not.toContain('submission has been received');
  });

  it('CONTROL zh: a declared thank-you title and message render as declared', async () => {
    inLanguage('zh');
    vi.stubGlobal(
      'fetch',
      stubFetch(publicPayload({ kind: 'thank-you', title: 'Merci', message: 'We will be in touch.' })),
    );
    renderPublic();
    await submit('提交');

    expect(await screen.findByRole('heading', { name: 'Merci' })).toBeInTheDocument();
    expect(screen.getByText('We will be in touch.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('感谢您的提交');
  });

  it('en: the English is the en pack\'s', async () => {
    inLanguage('en');
    vi.stubGlobal('fetch', stubFetch(publicPayload()));
    renderPublic();
    await submit('Submit');

    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeInTheDocument();
    expect(screen.getByText('Your submission has been received successfully.')).toBeInTheDocument();
    expect(toastSuccess.mock.calls[0][0]).toBe('Submitted');
  });
});
