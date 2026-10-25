// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The API console's method selector is the shared `Select` (objectui#11865).
 *
 * The request editor picked its HTTP method with a browser-native select,
 * beside the shared Radix `Select` the rest of the console picks with. The
 * card asks for one control for one kind of choice, surface by surface.
 *
 * What is pinned:
 *   - the selector IS the primitive (a Radix combobox trigger), in the verb's
 *     colours; no native select is left on the page;
 *   - it had no accessible name and still has none (kept for parity; see the
 *     pull request's acceptance notes);
 *   - it lists the five verbs the native control listed, in its order;
 *   - every verb sends the request the native control led to, compared as
 *     JSON text, with and without a body typed under POST first, and the page
 *     opens on GET, or on the verb a request preset carries;
 *   - the keyboard alone opens the selector and selects.
 *
 * The page has no read-only or disabled state for the selector, and every
 * source of the method it holds is typed `HttpMethod`, the five verbs the
 * selector lists, so no value outside them reaches it.
 *
 * DIRECTION, observed against the native control: every pin here is red there,
 * because each one reads the selector as the primitive's trigger, except three
 * green on both sides by design: the name pin, the literal control and the
 * no-pick case. What makes the send rows guards of "the conversion changed nothing
 * the page sends" is the literal each compares against: a `change` event on
 * the pre-conversion page's native control, then Send, led to that same
 * `fetch` call, read once on that page with these fixtures.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** A stable adapter, as the app's provider hands out, whose client sends to `http://api.test`. */
const ADAPTER = vi.hoisted(() => {
  const client = { baseUrl: 'http://api.test' };
  return { getClient: () => client };
});
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

import { ApiConsolePage } from './ApiConsolePage';

/** Endpoint discovery finds nothing (404); a request to the client's base URL answers 200. */
const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
  String(input).startsWith('http://api.test')
    ? new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    : new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }),
);

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PATH = '/api/v1/data/crm_deal';
const VERBS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
const trigger = () => screen.getByRole('combobox');

function renderPageAt(url = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="*" element={<ApiConsolePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openSelector(): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(verb: string): Promise<void> {
  const option = (await openSelector()).find((o) => o.textContent === verb);
  if (!option) throw new Error(`no "${verb}" listed`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

/** Press Send and return the requests sent to the client's base URL, as JSON text. */
async function send(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: /Send/ }));
  await settle();
  return JSON.stringify(fetchSpy.mock.calls.filter(([input]) => String(input).startsWith('http://api.test')));
}

const sent = (verb: string, body?: string) =>
  JSON.stringify([
    [`http://api.test${PATH}`, { method: verb, headers: { 'Content-Type': 'application/json' }, ...(body ? { body } : {}) }],
  ]);

describe('the method selector is the shared Select (objectui#11865)', () => {
  it('renders the selector as the Radix combobox trigger, on GET, in its colours', async () => {
    const { container } = renderPageAt();
    await settle();
    expect(trigger().tagName).toBe('BUTTON');
    expect(trigger()).toHaveTextContent(/^GET$/);
    expect(trigger()).toHaveClass('font-mono', 'text-emerald-600');
    expect(container.querySelectorAll('select')).toHaveLength(0);
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('has no accessible name, as the native control had none', async () => {
    renderPageAt();
    await settle();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: '' })).toBe(trigger());
  });

  it('lists the five verbs the native control listed, in its order', async () => {
    renderPageAt();
    await settle();
    expect((await openSelector()).map((o) => o.textContent)).toEqual([...VERBS]);
  });
});

/**
 * [verb, the JSON text of the request Send made with a URL typed, the JSON text
 * with `{"name":"Acme"}` typed in POST's body editor first].
 */
const SENDS: ReadonlyArray<readonly [verb: string, plain: string, withBody: string]> = [
  ['GET', '[["http://api.test/api/v1/data/crm_deal",{"method":"GET","headers":{"Content-Type":"application/json"}}]]', '[["http://api.test/api/v1/data/crm_deal",{"method":"GET","headers":{"Content-Type":"application/json"}}]]'],
  ['POST', '[["http://api.test/api/v1/data/crm_deal",{"method":"POST","headers":{"Content-Type":"application/json"}}]]', '[["http://api.test/api/v1/data/crm_deal",{"method":"POST","headers":{"Content-Type":"application/json"},"body":"{\\"name\\":\\"Acme\\"}"}]]'],
  ['PATCH', '[["http://api.test/api/v1/data/crm_deal",{"method":"PATCH","headers":{"Content-Type":"application/json"}}]]', '[["http://api.test/api/v1/data/crm_deal",{"method":"PATCH","headers":{"Content-Type":"application/json"},"body":"{\\"name\\":\\"Acme\\"}"}]]'],
  ['PUT', '[["http://api.test/api/v1/data/crm_deal",{"method":"PUT","headers":{"Content-Type":"application/json"}}]]', '[["http://api.test/api/v1/data/crm_deal",{"method":"PUT","headers":{"Content-Type":"application/json"},"body":"{\\"name\\":\\"Acme\\"}"}]]'],
  ['DELETE', '[["http://api.test/api/v1/data/crm_deal",{"method":"DELETE","headers":{"Content-Type":"application/json"}}]]', '[["http://api.test/api/v1/data/crm_deal",{"method":"DELETE","headers":{"Content-Type":"application/json"}}]]'],
];

describe('every verb sends what the native control sent', () => {
  it('the fixture literals are the shape `sent` builds (control)', () => {
    for (const [verb, plain, withBody] of SENDS) {
      expect(plain).toBe(sent(verb));
      expect(withBody).toBe(['POST', 'PATCH', 'PUT'].includes(verb) ? sent(verb, '{"name":"Acme"}') : sent(verb));
    }
  });

  it.each(SENDS)('%s', async (verb, plain) => {
    renderPageAt();
    await settle();
    fireEvent.change(screen.getByPlaceholderText('/api/v1/...'), { target: { value: PATH } });
    await pick(verb);
    expect(trigger()).toHaveTextContent(new RegExp(`^${verb}$`));
    expect(await send()).toBe(plain);
  });

  it.each(SENDS)('%s, with a body typed under POST first', async (verb, _plain, withBody) => {
    renderPageAt();
    await settle();
    fireEvent.change(screen.getByPlaceholderText('/api/v1/...'), { target: { value: PATH } });
    await pick('POST');
    fireEvent.change(screen.getByPlaceholderText('{ "key": "value" }'), { target: { value: '{"name":"Acme"}' } });
    await pick(verb);
    // The body editor shows for the verbs that send one, as it did.
    expect(screen.queryByText('Request Body (JSON)') !== null).toBe(['POST', 'PATCH', 'PUT'].includes(verb));
    expect(await send()).toBe(withBody);
  });

  // Green against the native control too, by design: no pick is made.
  it('with no pick, Send uses GET', async () => {
    renderPageAt();
    await settle();
    fireEvent.change(screen.getByPlaceholderText('/api/v1/...'), { target: { value: PATH } });
    expect(await send()).toBe(SENDS[0][1]);
  });

  it('a request preset’s verb is what the selector shows and Send uses', async () => {
    renderPageAt(`/?path=${encodeURIComponent(PATH)}&method=patch`);
    await settle();
    expect(trigger()).toHaveTextContent(/^PATCH$/);
    expect(await send()).toBe(SENDS[2][1]);
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens the selector and Enter on a verb selects it', async () => {
    renderPageAt();
    await settle();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'DELETE' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger()).toHaveTextContent(/^DELETE$/);
    expect(trigger()).toHaveClass('text-red-600');
  });
});
