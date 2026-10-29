// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27496 — the banner describes the current attempt
 * when the browser blocks the submit.
 *
 * An `email` row renders `type="email"`, so a malformed address stops the
 * submit in the browser before the page's own submit handler runs. The banner
 * used to keep the previous attempt's "Required: Name, Email, Message" after
 * all three were filled. The page now judges the blocked attempt again: its own
 * checks refuse nothing, so the banner clears, and the email row is marked with
 * the browser's own reason. A fixed address then submits, and a server refusal
 * still shows its banner.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PAYLOAD = {
  slug: 'contact-us',
  object: 'showcase_inquiry',
  label: 'Contact us',
  form: {
    type: 'simple',
    sections: [{
      fields: [
        { field: 'name', required: true },
        { field: 'email', required: true },
        { field: 'message', required: true },
      ],
    }],
  },
  objectSchema: {
    name: 'showcase_inquiry',
    fields: {
      name: { type: 'text', label: 'Name' },
      email: { type: 'email', label: 'Email' },
      message: { type: 'text', label: 'Message' },
    },
  },
};

let posts: unknown[] = [];

function stubPublic(answer: { ok: boolean; status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const reply = (ok: boolean, status: number, body: unknown) =>
        ({
          ok,
          status,
          statusText: ok ? 'OK' : 'Refused',
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as unknown as Response;
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return reply(answer.ok, answer.status, answer.body);
      }
      if (!String(url).includes('/forms/')) throw new Error(`unstubbed fetch: ${url}`);
      return reply(true, 200, PAYLOAD);
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

const submit = () => userEvent.click(screen.getByRole('button', { name: /Submit/ }));

/** Empty submit, then all three filled with a malformed address. */
async function refuseThenFillWithBadEmail() {
  await screen.findByLabelText(/^Name/);
  await submit();
  expect(await screen.findByText('Required: Name, Email, Message')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/^Name/), 'Ada Lovelace');
  await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email');
  await userEvent.type(screen.getByLabelText(/^Message/), 'Hello');
  await submit();
}

beforeEach(() => {
  posts = [];
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#27496 — a submit the browser blocks replaces the stale banner', () => {
  it('clears "Required: …" and marks the email row with the browser reason', async () => {
    stubPublic({ ok: true, status: 201, body: { id: 'r1' } });
    await refuseThenFillWithBadEmail();

    const email = screen.getByLabelText(/^Email/) as HTMLInputElement;
    expect(email.validity.valid).toBe(false);
    await waitFor(() => expect(screen.queryByText(/^Required:/)).toBeNull());
    expect(posts).toHaveLength(0);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Name/)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Message/)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('a fixed address then submits', async () => {
    stubPublic({ ok: true, status: 201, body: { id: 'r1' } });
    await refuseThenFillWithBadEmail();

    const email = screen.getByLabelText(/^Email/);
    await userEvent.clear(email);
    await userEvent.type(email, 'ada@example.com');
    await submit();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ email: 'ada@example.com' });
  });

  it('a server refusal after the fix still shows its banner', async () => {
    stubPublic({ ok: false, status: 400, body: { error: 'Validation failed', code: 'VALIDATION_FAILED' } });
    await refuseThenFillWithBadEmail();

    const email = screen.getByLabelText(/^Email/);
    await userEvent.clear(email);
    await userEvent.type(email, 'ada@example.com');
    await submit();
    expect(await screen.findByText(/Submit failed \(400\)/)).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });
});
