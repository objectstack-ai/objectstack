// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10785 — `FormPage` holds Submit while an `avatar` upload is in
 * flight, exactly as it does for `file` (objectui#10167).
 *
 * ## The defect
 *
 * `AvatarField` used to read the pick into a `data:` URL on the spot, so there
 * was nothing to wait for. It now uploads through the ambient `UploadProvider`
 * and hands the `sys_file` id to `onChange` only once the adapter settles, and
 * it reports the in-flight state through `onUploadingChange`. `FormPage` handed
 * that callback to `file` and `image` alone (`isUploadWidget`), so a Submit
 * pressed during an avatar upload went out WITHOUT the avatar and reported
 * success — the objectui#10167 silent-empty class on a new widget.
 *
 * ## What is pinned
 *
 * The REAL `AvatarField`, reached through the route's own resolver, under a
 * real `UploadProvider` whose adapter parks its promise until released:
 *
 *   - while the upload is held, Submit is disabled and reads "Uploading…";
 *   - once it settles, Submit is enabled and the payload carries the minted id.
 *
 * The first half is also the end-to-end reading of the widget's own
 * `onUploadingChange` claim: nothing else flips this button.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UploadProvider } from '@object-ui/providers';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** uuid/nanoid-shaped, so the platform's `isFileIdToken` accepts it. */
const MINTED_FILE_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

/** Every upload parks its resolver here and settles only when released. */
const pendingUploads: Array<() => void> = [];

const uploadSpy = vi.fn(async (file: File | Blob) => {
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
});

const uploadAdapter = { name: 'spy-objectstack', upload: uploadSpy };

function publicPayload() {
  return {
    slug: 'join-us',
    object: 'showcase_member',
    label: 'Join us',
    form: { type: 'simple', sections: [{ fields: ['title', 'photo'] }] },
    objectSchema: {
      name: 'showcase_member',
      fields: {
        title: { type: 'text', label: 'Title' },
        photo: { type: 'avatar', label: 'Photo' },
      },
    },
  };
}

let submits: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubPublic() {
  const routes: Record<string, unknown> = {
    '/forms/join-us/submit': { ok: true },
    '/forms/join-us': publicPayload(),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        submits.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : {} });
      }
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      if (!key) throw new Error(`unstubbed fetch: ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => routes[key],
        text: async () => JSON.stringify(routes[key]),
      } as unknown as Response;
    }),
  );
}

/** The public route under a real `UploadProvider`, where the console mounts it. */
function renderPublicForm() {
  return render(
    <UploadProvider adapter={uploadAdapter}>
      <MemoryRouter initialEntries={['/f/join-us']}>
        <Routes>
          <Route path="/f/:slug" element={<FormPage mode="public" />} />
        </Routes>
      </MemoryRouter>
    </UploadProvider>,
  );
}

/** The avatar widget's hidden picker, once its lazy chunk has arrived. */
async function findAvatarPicker(container: HTMLElement): Promise<HTMLInputElement> {
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeNull());
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The form's one submit button, whatever it is labelled at the moment. */
function submitButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

beforeEach(() => {
  // The submit button reads the i18n catalogue (objectui#11071) through the
  // provider `main.tsx` mounts above this route. The app's own factory
  // registers its instance as react-i18next's global, which is how this
  // unwrapped route reaches the `en` pack; the harness restores the global
  // after every test (`installI18nGlobalReset`).
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  submits = [];
  pendingUploads.length = 0;
  uploadSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FormPage holds Submit while an avatar upload is in flight (objectui#10785)', () => {
  it('disabled while the upload is held, enabled once it settles, and the id is submitted', async () => {
    stubPublic();
    const { container } = renderPublicForm();
    await screen.findByLabelText(/Title/);

    pick(await findAvatarPicker(container), new File(['x'], 'me.png', { type: 'image/png' }));
    // The upload IS in flight: the adapter holds it.
    await waitFor(() => expect(pendingUploads).toHaveLength(1));

    await waitFor(() => expect(submitButton(container)).toBeDisabled());
    expect(submitButton(container).textContent).toBe('Uploading…');
    expect(submits).toHaveLength(0);

    pendingUploads[0]();

    const settled = await screen.findByRole('button', { name: /^Submit$/ });
    expect(settled).not.toBeDisabled();
    await userEvent.click(settled);
    await waitFor(() => expect(submits).toHaveLength(1));
    expect(submits[0].body.photo).toBe(MINTED_FILE_ID);
  });
});
