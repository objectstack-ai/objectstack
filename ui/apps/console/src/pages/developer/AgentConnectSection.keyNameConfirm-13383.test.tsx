// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Integrations → Connect an AI agent mints a key only under a chosen name, and
 * only after a confirm that names it (objectui#13383).
 *
 * The defect: `generateKey` posted `name: keyName.trim() || 'Agent key'`
 * straight from the "Generate key" button, so one click minted a key that acts
 * as the administrator, with no confirm, and a cleared or whitespace-only name
 * box still minted it under the default name. The sibling Connect an Agent card
 * was held to the same rule by objectui#13355. This file holds the section to
 * it:
 *
 *  - §1 a blank (or whitespace-only) name cannot mint: the button is disabled
 *    and `POST /api/v1/keys` is never sent;
 *  - §2 a click opens the in-app confirm naming the key, and Cancel mints
 *    nothing;
 *  - §3 confirming posts exactly the trimmed name, never a default, and the
 *    show-once dialog shows the key.
 *
 * `fetch` is stubbed by path; `t` echoes the KEY (with the `name` option
 * appended when one is passed), as the Connect an Agent suite does, so the
 * assertions read which string the dialog asked for and with which name. The
 * section's own chrome reads `console.developer.agentConnect.*` (objectui#13460).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts && typeof opts.name === 'string' ? `«${key}|${opts.name}»` : `«${key}»`,
    language: 'en',
  }),
}));

import { AgentConnectSection } from './AgentConnectSection';

const MINTED_KEY = 'osk_test_0123456789';

let fetchMock: ReturnType<typeof vi.fn>;

/** The bodies of every `POST /api/v1/keys` the section sent. */
function keyPosts(): unknown[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).includes('/api/v1/keys'))
    .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? 'null')));
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/discovery')) {
      return new Response(JSON.stringify({ data: { routes: { mcp: '/api/v1/mcp' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/keys')) {
      const sent = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
      return new Response(
        JSON.stringify({ success: true, data: { name: sent.name, key: MINTED_KEY } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderSettled() {
  render(<AgentConnectSection />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return screen.getByPlaceholderText('«console.developer.agentConnect.keyNamePlaceholder»');
}

const generateButton = () => screen.getByRole('button', { name: '«console.developer.agentConnect.generateKey»' });

describe('AgentConnectSection mints a key only under a chosen, confirmed name (objectui#13383)', () => {
  it('§1 a blank or whitespace-only name cannot mint', async () => {
    const input = await renderSettled();

    fireEvent.change(input, { target: { value: '' } });
    expect(generateButton()).toBeDisabled();
    fireEvent.click(generateButton());

    fireEvent.change(input, { target: { value: '   ' } });
    expect(generateButton()).toBeDisabled();
    fireEvent.click(generateButton());

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(keyPosts()).toEqual([]);
  });

  it('§2 a click opens a confirm naming the key, and Cancel mints nothing', async () => {
    const input = await renderSettled();
    fireEvent.change(input, { target: { value: 'Claude desktop' } });
    expect(generateButton()).toBeEnabled();

    fireEvent.click(generateButton());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('«connectAgent.apiKey.confirmTitle|Claude desktop»');
    // Opening the confirm is not minting.
    expect(keyPosts()).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: '«common.cancel»' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(keyPosts()).toEqual([]);
    // The name survives a Cancel, so the administrator can try again.
    expect(input).toHaveValue('Claude desktop');
  });

  it('§3 confirming posts exactly the trimmed name and shows the key once', async () => {
    const input = await renderSettled();
    fireEvent.change(input, { target: { value: '  Claude desktop  ' } });
    fireEvent.click(generateButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('«connectAgent.apiKey.confirmTitle|Claude desktop»');
    fireEvent.click(within(dialog).getByRole('button', { name: '«connectAgent.apiKey.mint»' }));

    await waitFor(() => expect(keyPosts()).toEqual([{ name: 'Claude desktop' }]));
    const shown = await screen.findByRole('dialog', { name: /«console\.developer\.agentConnect\.newKeyTitle»/ });
    expect(within(shown).getByText(MINTED_KEY)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('§4 the prefilled name is minted only once it is confirmed', async () => {
    await renderSettled();
    // The section opens with the name box prefilled; that name is offered,
    // not minted: the click still stops at the confirm naming it.
    fireEvent.click(generateButton());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('«connectAgent.apiKey.confirmTitle|Agent key»');
    expect(keyPosts()).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: '«connectAgent.apiKey.mint»' }));
    await waitFor(() => expect(keyPosts()).toEqual([{ name: 'Agent key' }]));
  });
});
