// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11071 — the form page's own controls speak the session locale.
 *
 * `objectui#11039` moved the page's feedback chrome (the loading line, the
 * success toast, the thank-you panel) onto the pack keys. What it left behind
 * was the page's own action chrome, still typed as English literals: the
 * submit button's `Submit` / `Submitting…` / `Uploading…`, the `Redirecting…`
 * line a redirect submit shows, and the frame of the `Required: …` refusal. So
 * a zh visitor read a Chinese form with an English button and an English
 * refusal. They now resolve through the same catalogue:
 * `publicForm.submit`, `publicForm.submitting`, `fields.file.uploading` (the
 * key every other form's in-flight Save label already reads),
 * `publicForm.redirectPending` and `publicForm.requiredFields`.
 *
 * The `Required: …` frame is ONE key with a `{{fields}}` hole, not a
 * concatenation: the colon, its spacing and the word order are the pack's.
 * The labels that fill the hole are the FORM'S own — an authored field label
 * still reads exactly as authored inside the localised frame (the `CONTROL`
 * case).
 *
 * Same harness as `FormPage.chromeI18n-11039.test.tsx`: the route under test is
 * the one `App` declares, the catalogue reaches it through the global instance
 * `createI18n` registers, and the harness puts the pristine global back after
 * every test.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { UploadProvider } from '@object-ui/providers';
import { FormPage } from './FormPage';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

/** uuid/nanoid-shaped, so the platform's `isFileIdToken` accepts it. */
const MINTED_FILE_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

/** Every upload parks its resolver here and settles only when released. */
const pendingUploads: Array<() => void> = [];
const uploadAdapter = {
  name: 'spy-objectstack',
  upload: vi.fn(async (file: File | Blob) => {
    await new Promise<void>((resolve) => {
      pendingUploads.push(resolve);
    });
    return {
      url: `/api/v1/storage/files/${MINTED_FILE_ID}`,
      name: (file as File).name ?? 'upload',
      size: file.size,
      mimeType: file.type,
      meta: { fileId: MINTED_FILE_ID },
    };
  }),
};

interface PayloadOptions {
  submitBehavior?: unknown;
  /** The authored label of the one required text row. */
  titleLabel?: string;
  withPhoto?: boolean;
  /** A second required text row, so the refusal names two. */
  withPriority?: boolean;
}

/** The public `/forms/:slug` resolver payload: one required text row. */
function publicPayload({
  submitBehavior,
  titleLabel = 'Title',
  withPhoto = false,
  withPriority = false,
}: PayloadOptions = {}) {
  return {
    slug: 'contact-us',
    object: 'showcase_inquiry',
    label: 'Contact us',
    form: {
      type: 'simple',
      sections: [{ fields: ['title', ...(withPriority ? ['priority'] : []), ...(withPhoto ? ['photo'] : [])] }],
      ...(submitBehavior ? { submitBehavior } : {}),
    },
    objectSchema: {
      name: 'showcase_inquiry',
      fields: {
        title: { type: 'text', label: titleLabel, required: true },
        ...(withPriority ? { priority: { type: 'text', label: 'Priority', required: true } } : {}),
        ...(withPhoto ? { photo: { type: 'avatar', label: 'Photo' } } : {}),
      },
    },
  };
}

/**
 * Answers the resolver, and the submit unless `holdSubmit` — then the write
 * never settles, so the page stays on its in-flight button.
 */
function stubFetch(payload: unknown, { holdSubmit = false } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && holdSubmit) return new Promise<Response>(() => {});
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
    <UploadProvider adapter={uploadAdapter}>
      <MemoryRouter initialEntries={['/f/contact-us']}>
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>
    </UploadProvider>,
  );
}

function inLanguage(language: string) {
  createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
}

/** The form's one submit button, whatever it is labelled at the moment. */
function submitButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

beforeEach(() => {
  toastError.mockClear();
  pendingUploads.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FormPage action chrome resolves through the i18n catalogue (objectui#11071)', () => {
  it('zh: the submit button is 提交', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload()));
    const { container } = renderPublic();

    expect(await screen.findByRole('button', { name: '提交' })).toBeInTheDocument();
    expect(submitButton(container).textContent).toBe('提交');
    expect(document.body.textContent).not.toContain('Submit');
  });

  it('zh: the in-flight button is 提交中…', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload(), { holdSubmit: true }));
    const { container } = renderPublic();
    await userEvent.type(await screen.findByLabelText(/Title/), 'Hello');
    await userEvent.click(await screen.findByRole('button', { name: '提交' }));

    await waitFor(() => expect(submitButton(container).textContent).toBe('提交中…'));
    expect(submitButton(container)).toBeDisabled();
    expect(document.body.textContent).not.toContain('Submitting');
  });

  it('zh: the button while an upload is in flight is 上传中…', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload({ withPhoto: true })));
    const { container } = renderPublic();
    await screen.findByLabelText(/Title/);
    await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeNull());

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', {
      value: [new File(['x'], 'me.png', { type: 'image/png' })],
      configurable: true,
    });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(pendingUploads).toHaveLength(1));

    await waitFor(() => expect(submitButton(container).textContent).toBe('上传中…'));
    expect(submitButton(container)).toBeDisabled();
    expect(document.body.textContent).not.toContain('Uploading');
    pendingUploads[0]();
  });

  it('zh: a pending redirect reads 正在跳转…', async () => {
    inLanguage('zh');
    vi.stubGlobal(
      'fetch',
      stubFetch(publicPayload({ submitBehavior: { kind: 'redirect', url: '/thanks', delayMs: 60_000 } })),
    );
    renderPublic();
    await userEvent.type(await screen.findByLabelText(/Title/), 'Hello');
    await userEvent.click(await screen.findByRole('button', { name: '提交' }));

    expect(await screen.findByText('正在跳转…')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Redirecting');
  });

  it('zh: the required refusal is the pack frame around the row labels, on the page and in the toast', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload()));
    renderPublic();
    await userEvent.click(await screen.findByRole('button', { name: '提交' }));

    expect(await screen.findByText('必填项：Title')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith('必填项：Title', expect.anything());
    expect(document.body.textContent).not.toContain('Required');
  });

  it('zh: two empty rows are joined with the pack\'s own list separator', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload({ withPriority: true })));
    renderPublic();
    await userEvent.click(await screen.findByRole('button', { name: '提交' }));

    expect(await screen.findByText('必填项：Title、Priority')).toBeInTheDocument();
  });

  it('CONTROL zh: an authored field label reads as authored inside the localised frame', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubFetch(publicPayload({ titleLabel: 'Ticket subject' })));
    renderPublic();
    await userEvent.click(await screen.findByRole('button', { name: '提交' }));

    expect(await screen.findByText('必填项：Ticket subject')).toBeInTheDocument();
  });

  it('en: the English is the en pack\'s, byte for byte what the literals were', async () => {
    inLanguage('en');
    vi.stubGlobal('fetch', stubFetch(publicPayload()));
    const { container } = renderPublic();
    await userEvent.click(await screen.findByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Required: Title')).toBeInTheDocument();
    expect(submitButton(container).textContent).toBe('Submit');
  });
});
