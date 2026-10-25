// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7252 — a form never ends on a screen that asserts BOTH outcomes.
 *
 * The card was filed against the console's WIZARD path, where the refusal and
 * the confirmation are raised by two different modules (`@object-ui/components`'
 * form renderer and `@object-ui/plugin-form`'s `WizardForm`); that end-to-end
 * flow is pinned in
 * `packages/plugin-form/src/WizardForm.outcomeToastSupersede.test.tsx`.
 *
 * This page carried the SAME defect in a single function. `handleSubmit` clears
 * the `error` banner at the top of every attempt but published its toast under
 * sonner's auto-generated id, so nothing here could retire it: a refused submit
 * left its toast up, and the confirmation of the retry landed beside it. Both
 * outcomes now travel under one per-form id, so the later one supersedes the
 * earlier in place.
 *
 * ## Why the assertion is a registry rather than a call count
 *
 * `toast.error` was called and `toast.success` was called is true both before
 * and after the fix — it is exactly the reading under which the defect looks
 * fine. What the card is about is what remains ON SCREEN, so `sonner` is
 * replaced by a registry modelling the one behaviour the fix relies on: raising
 * a toast under an id the registry already holds REPLACES that entry.
 *
 * ## Reverse verification — predicted, then measured
 *
 * Dropping `{ id: outcomeToastId }` from the two submit-outcome toasts turns
 * the first test RED (two entries on screen: the refusal and the confirmation)
 * and leaves the second one — which asserts that the redirect refusal is NOT
 * folded into that id — green, since it never depended on the id at all.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

type ToastEntry = { type: string; message: string };

const { toastRegistry, fakeToast } = vi.hoisted(() => {
  const toastRegistry = new Map<string | number, { type: string; message: string }>();
  let auto = 0;
  const raise =
    (type: string) =>
    (message: unknown, options?: { id?: string | number }) => {
      // No id is sonner's auto-id — a NEW toast every time, which is precisely
      // the pre-fix behaviour that let two outcomes share the screen.
      const id = options?.id ?? `auto:${(auto += 1)}`;
      toastRegistry.set(id, { type, message: String(message) });
      return id;
    };
  const fakeToast = {
    success: raise('success'),
    error: raise('error'),
    info: raise('info'),
    warning: raise('warning'),
    dismiss: (id?: string | number) => {
      if (id === undefined) toastRegistry.clear();
      else toastRegistry.delete(id);
      return id;
    },
  };
  return { toastRegistry, fakeToast };
});

vi.mock('sonner', () => ({ toast: fakeToast }));

/** What the submitter can actually see, in the order sonner holds it. */
const onScreen = (): ToastEntry[] => [...toastRegistry.values()];

const publicPayload = (submitBehavior?: unknown) => ({
  slug: 'contact-us',
  object: 'showcase_inquiry',
  label: 'Contact us',
  form: {
    type: 'simple',
    sections: [{ fields: ['title'] }],
    ...(submitBehavior ? { submitBehavior } : {}),
  },
  objectSchema: { name: 'showcase_inquiry', fields: { title: { type: 'text', label: 'Title' } } },
});

/**
 * Answers the form resolver, then refuses the first N submits with a 400 the
 * way the reported flow was refused, and accepts every one after that.
 */
function stubFetchRefusingFirst(refusals: number, payload: Record<string, unknown>) {
  let posts = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts += 1;
      if (posts <= refusals) {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Invalid project status transition.',
          json: async () => ({ error: 'Invalid project status transition.' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({ object: 'showcase_inquiry', id: 'inq-1', record: { id: 'inq-1' } }),
        text: async () => '{}',
      } as unknown as Response;
    }
    if (!String(url).includes('/forms/')) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  });
}

const renderPublic = () =>
  render(
    <MemoryRouter initialEntries={['/f/contact-us']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  toastRegistry.clear();
  // FormPage's feedback chrome reads the i18n catalogue (objectui#11039)
  // through the provider `main.tsx` mounts above this route. The app's own
  // factory registers its instance as react-i18next's global, which is how
  // this unwrapped route reaches the `en` pack; the harness restores the
  // global after every test (`installI18nGlobalReset`).
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FormPage — the later submit outcome supersedes the earlier one', () => {
  it('leaves only the confirmation after a refused submit is retried and accepted', async () => {
    vi.stubGlobal('fetch', stubFetchRefusingFirst(1, publicPayload()));
    renderPublic();

    await screen.findByLabelText(/Title/);
    await userEvent.type(screen.getByLabelText(/Title/), 'Ship it');

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(onScreen()).toHaveLength(1));
    expect(onScreen()[0].type).toBe('error');
    expect(onScreen()[0].message).toContain('Invalid project status transition.');

    // The retry the card describes: same form, same page, and it is accepted.
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(await screen.findByText('Your submission has been received successfully.')).toBeInTheDocument();

    await waitFor(() => expect(onScreen()).toEqual([{ type: 'success', message: 'Submitted' }]));
  });

  /**
   * The objectui#4190 arm is NOT a submit outcome: the write succeeded and only
   * the declared destination is out of contract, so its refusal has to stay
   * readable BESIDE the confirmation. It therefore keeps its own toast — folding
   * it into the shared id would silently delete the confirmation of a write that
   * really happened.
   */
  it('keeps a refused redirect destination beside the confirmation it qualifies', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchRefusingFirst(0, publicPayload({ kind: 'redirect', url: 'https://evil.example/x' })),
    );
    renderPublic();

    await screen.findByLabelText(/Title/);
    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    await waitFor(() => expect(onScreen()).toHaveLength(2));
    expect(onScreen().map((e) => e.type)).toEqual(['success', 'error']);
  });
});
