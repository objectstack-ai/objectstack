// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27496 — an `email` row renders `type="email"`, so
 * the browser blocks a malformed address before the page's submit handler
 * runs. The banner used to keep "Required: Name, Email, Message" after all
 * three were filled; it now describes that blocked attempt, a fixed address
 * submits, and a server refusal still shows its banner.
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
    sections: [{ fields: ['name', 'email', 'message'].map((field) => ({ field, required: true })) }],
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

function stubPublic(ok: boolean, status: number, body: unknown) {
  const reply = (o: boolean, s: number, b: unknown) =>
    ({ ok: o, status: s, statusText: '', json: async () => b, text: async () => JSON.stringify(b) }) as unknown as Response;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return reply(ok, status, body);
    }
    if (!String(url).includes('/forms/')) throw new Error(`unstubbed fetch: ${url}`);
    return reply(true, 200, PAYLOAD);
  }));
  const route = <Route path="/f/:slug" element={<FormPage mode="public" />} />;
  render(<MemoryRouter initialEntries={['/f/contact-us']}><Routes>{route}</Routes></MemoryRouter>);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /Submit/ }));

/** Empty submit, then all three filled with a malformed address and submitted. */
async function refuseThenSubmitBadEmail() {
  await screen.findByLabelText(/^Name/);
  await submit();
  expect(await screen.findByText('Required: Name, Email, Message')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/^Name/), 'Ada Lovelace');
  await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email');
  await userEvent.type(screen.getByLabelText(/^Message/), 'Hello');
  await submit();
}

async function fixEmailAndSubmit() {
  const email = screen.getByLabelText(/^Email/);
  await userEvent.clear(email);
  await userEvent.type(email, 'ada@example.com');
  await submit();
}

beforeEach(() => {
  posts = [];
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => vi.unstubAllGlobals());

describe('#27496 — a submit the browser blocks replaces the stale banner', () => {
  it('clears "Required: …" and marks only the email row', async () => {
    stubPublic(true, 201, { id: 'r1' });
    await refuseThenSubmitBadEmail();
    const email = screen.getByLabelText(/^Email/) as HTMLInputElement;
    expect(email.validity.valid).toBe(false);
    await waitFor(() => expect(screen.queryByText(/^Required:/)).toBeNull());
    expect(posts).toHaveLength(0);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Name/)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('a fixed address then submits', async () => {
    stubPublic(true, 201, { id: 'r1' });
    await refuseThenSubmitBadEmail();
    await fixEmailAndSubmit();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ email: 'ada@example.com' });
  });

  it('a server refusal after the fix still shows its banner', async () => {
    stubPublic(false, 400, { error: 'Validation failed', code: 'VALIDATION_FAILED' });
    await refuseThenSubmitBadEmail();
    await fixEmailAndSubmit();
    expect(await screen.findByText(/Submit failed \(400\)/)).toBeInTheDocument();
  });
});
