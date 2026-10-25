// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10167 — a `file` field on a FormView renders the shared upload
 * control, not a plain text box.
 *
 * `/f/:slug` and `/forms/:name` go through `FormPage`, whose hand-rolled input
 * switch had no `file` arm, so the field fell through to the default text
 * input. The card is the identical shape as objectui#10129 (PR objectui#10158):
 * a field type whose control exists and works on one renderer, degraded on
 * another because that renderer re-spells the switch.
 *
 * ## What each test can see, and why the negatives are not enough on their own
 *
 * "There is no longer a text box" is one bit, and a form that rendered nothing
 * at all would satisfy it. So the positives are on the VALUE and on the
 * author's declaration:
 *
 *  - the control is the shared `FileField`, reached through ADR-0059's
 *    resolver, and picking a file puts the `sys_file` id the upload adapter
 *    minted into the submitted payload — the same assertion objectui#10131
 *    settled on for the dialog host, for the same reason (asserting "no 400"
 *    would pass on a control that submits nothing);
 *  - the object's declared `multiple` / `accept` / `maxSize` reach the widget.
 *    Those three were dropped by this app's narrowed view of the object
 *    payload, so without them the control would be a single-file, unfiltered,
 *    unbounded dropzone whatever the author wrote — declared but not
 *    delivered;
 *  - submit is blocked while an upload is in flight, which is what the widget
 *    contract's `onUploadingChange` exists for.
 *
 * ## Control legs, so no assertion here is vacuous
 *
 * Every test that says "not a text input" runs against a form that also holds
 * a `text` field AND a field of a type this switch has never had an arm for.
 * Both must still render plain text inputs: the first shows the form rendered
 * at all, the second shows the default arm — the fall-through this card is
 * about — is untouched for every type that is genuinely unhandled here.
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

/**
 * Armed by the in-flight test only. While set, every upload parks its own
 * resolver in {@link pendingUploads} instead of settling, so "an upload is
 * still running" is a state the assertions can stand in.
 */
let deferUploads = false;
const pendingUploads: Array<() => void> = [];

const uploadSpy = vi.fn(async (file: File | Blob) => {
  if (deferUploads) {
    await new Promise<void>((resolve) => {
      pendingUploads.push(resolve);
    });
  }
  return {
    url: `/api/v1/storage/files/${MINTED_FILE_ID}`,
    name: (file as File).name ?? 'upload',
    size: file.size,
    mimeType: file.type,
    meta: { fileId: MINTED_FILE_ID },
  };
});

const uploadAdapter = { name: 'spy-objectstack', upload: uploadSpy };

/**
 * The public resolver payload. `attachment` is the card's field; `title` and
 * `oddball` are the two control legs described in this file's header —
 * `oddball` names a type no arm of the switch has ever spelled.
 */
function publicPayload(fileDef: Record<string, unknown> = {}) {
  return {
    slug: 'contact-us',
    object: 'showcase_inquiry',
    label: 'Contact us',
    form: {
      type: 'simple',
      sections: [{ fields: ['title', 'attachment', 'oddball'] }],
    },
    objectSchema: {
      name: 'showcase_inquiry',
      fields: {
        title: { type: 'text', label: 'Title' },
        attachment: { type: 'file', label: 'Attachment', ...fileDef },
        oddball: { type: 'no_such_field_type', label: 'Oddball' },
      },
    },
  };
}

let submits: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      submits.push({
        url: String(url),
        body: init.body ? JSON.parse(String(init.body)) : {},
      });
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
  });
}

/**
 * Renders the public route under a real `UploadProvider`, which is where the
 * console mounts it — above every route, `/f/:slug` included. `useUpload`
 * fails OPEN (objectui#10131), so a test that omitted the provider would
 * silently measure the object-URL fallback instead of the adapter.
 */
function renderPublicForm() {
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

function stubPublic(fileDef: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    stubFetch({
      '/forms/contact-us/submit': { ok: true },
      '/forms/contact-us': publicPayload(fileDef),
    }),
  );
}

/**
 * The widget's native picker, once the lazy chunk has arrived.
 *
 * ADR-0059's resolver hands back a `React.lazy` component, so the control is
 * one Suspense boundary away from the first paint. Every test awaits it
 * through this helper rather than relying on a sibling test having warmed
 * `React.lazy`'s module cache first — a test that did would pass in a full run
 * and fail when run alone.
 */
async function findFileControl(container: HTMLElement): Promise<HTMLInputElement> {
  await waitFor(() =>
    expect(container.querySelector('input[type="file"]')).not.toBeNull(),
  );
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

/** The widget's native picker, driven with a real `File`. */
function pickAFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input;
}

const A_PDF = () => new File(['bytes'], 'contract.pdf', { type: 'application/pdf' });

beforeEach(() => {
  // The submit button reads the i18n catalogue (objectui#11071) through the
  // provider `main.tsx` mounts above this route. The app's own factory
  // registers its instance as react-i18next's global, which is how this
  // unwrapped route reaches the `en` pack; the harness restores the global
  // after every test (`installI18nGlobalReset`).
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  submits = [];
  deferUploads = false;
  pendingUploads.length = 0;
  uploadSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a `file` field on a FormView', () => {
  it('renders the shared upload control instead of a text box', async () => {
    stubPublic();
    const { container } = renderPublicForm();

    await screen.findByLabelText(/Title/);
    // The shared widget's own picker is present.
    await findFileControl(container);

    // The card's symptom, gone: the row is no longer an input at all, let
    // alone a text one.
    expect(container.querySelector('input#f_attachment')).toBeNull();

    // Control legs — the form really rendered, and the default arm is intact
    // for a type that genuinely has none.
    expect(container.querySelector('input#f_title')).toHaveAttribute('type', 'text');
    expect(container.querySelector('input#f_oddball')).toHaveAttribute('type', 'text');
  });

  it('submits the `sys_file` id the upload adapter minted', async () => {
    stubPublic();
    const { container } = renderPublicForm();
    await screen.findByLabelText(/Title/);

    pickAFile(await findFileControl(container), A_PDF());
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));

    await userEvent.click(await screen.findByRole('button', { name: /^Submit$/ }));
    await waitFor(() => expect(submits).toHaveLength(1));

    // The value, not the absence of an error: a bare reference id, identical
    // to the one the adapter minted.
    expect(submits[0].body.attachment).toBe(MINTED_FILE_ID);
    expect(submits[0].url).toContain('/forms/contact-us/submit');
  });
});

describe("the object's declared upload configuration reaches the widget", () => {
  it('passes `multiple` and `accept` through to the picker', async () => {
    stubPublic({ multiple: true, accept: ['application/pdf', '.png'] });
    const { container } = renderPublicForm();
    await screen.findByLabelText(/Title/);

    const input = await findFileControl(container);
    expect(input.multiple).toBe(true);
    expect(input.getAttribute('accept')).toBe('application/pdf,.png');
  });

  it('defaults to a single-file picker with no filter when the object declares neither', async () => {
    stubPublic();
    const { container } = renderPublicForm();
    await screen.findByLabelText(/Title/);

    // The counter-probe for the test above: both attributes are observable in
    // either state, so the previous assertions are about the DECLARATION
    // arriving, not about the widget's fixed markup.
    const input = await findFileControl(container);
    expect(input.multiple).toBe(false);
    expect(input.getAttribute('accept')).toBeNull();
  });

  it('enforces the declared `maxSize` — an oversized file never reaches the adapter', async () => {
    stubPublic({ maxSize: 8 });
    const { container } = renderPublicForm();
    await screen.findByLabelText(/Title/);

    const tooBig = new File(['0123456789'], 'big.pdf', { type: 'application/pdf' });
    expect(tooBig.size).toBeGreaterThan(8);
    pickAFile(await findFileControl(container), tooBig);

    // The size guard is the widget's; what this pins is that the object's
    // ceiling got there. Asserted on the adapter rather than on the rejection
    // text, which is a translated string.
    await waitFor(() => expect(container.textContent).toMatch(/big\.pdf/));
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

describe('submit while an upload is still in flight', () => {
  it('is blocked until the adapter settles', async () => {
    // Arms the deferred branch of the spy: the upload hangs until released.
    deferUploads = true;
    stubPublic();
    const { container } = renderPublicForm();
    await screen.findByLabelText(/Title/);

    pickAFile(await findFileControl(container), A_PDF());

    const button = await screen.findByRole('button', { name: /Uploading/ });
    expect(button).toBeDisabled();
    expect(submits).toHaveLength(0);

    await waitFor(() => expect(pendingUploads).toHaveLength(1));
    pendingUploads[0]();

    const settled = await screen.findByRole('button', { name: /^Submit$/ });
    expect(settled).not.toBeDisabled();

    await userEvent.click(settled);
    await waitFor(() => expect(submits).toHaveLength(1));
    expect(submits[0].body.attachment).toBe(MINTED_FILE_ID);
  });
});
