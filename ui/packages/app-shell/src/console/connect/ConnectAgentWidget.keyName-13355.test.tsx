// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Connect an Agent → API keys mints a key only under a name the administrator
 * typed, and only after a confirm that names it (objectui#13355).
 *
 * The defect: `mintKey` posted `name: keyName.trim() || 'agent-key'`, so one
 * click on "Create key" with the name box empty minted a key called
 * `agent-key`, with no confirm. Setup → API Keys → Create Key (the
 * `sys_api_key` `create_api_key` action) requires the name. This file holds the
 * widget to that:
 *
 *  - §1 a blank (or whitespace-only) name cannot mint: the button is disabled
 *    and `POST /api/v1/keys` is never sent;
 *  - §2 a typed name opens the in-app confirm naming the key, and Cancel mints
 *    nothing;
 *  - §3 confirming posts exactly the typed (trimmed) name, never a default, and
 *    the key is revealed once.
 *
 * `fetch` is stubbed by path; `t` echoes the KEY (with the `name` option
 * appended when one is passed), as the sibling suites do, so the assertions
 * read which string the widget asked for and with which name.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts && typeof opts.name === 'string' ? `«${key}|${opts.name}»` : `«${key}»`,
    language: 'en',
  }),
}));

import { ConnectAgent } from './ConnectAgentWidget';

const MINTED_KEY = 'osk_test_0123456789';

let fetchMock: ReturnType<typeof vi.fn>;

/** The bodies of every `POST /api/v1/keys` the widget sent. */
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
        { status: 200, headers: { 'content-type': 'application/json' } },
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
  render(<ConnectAgent />);
  return screen.findByPlaceholderText('«connectAgent.apiKey.namePlaceholder»');
}

const createButton = () => screen.getByRole('button', { name: '«connectAgent.apiKey.mint»' });

describe('Connect an Agent mints a key only under a typed, confirmed name (objectui#13355)', () => {
  it('§1 a blank or whitespace-only name cannot mint', async () => {
    const input = await renderSettled();

    expect(createButton()).toBeDisabled();
    fireEvent.click(createButton());

    fireEvent.change(input, { target: { value: '   ' } });
    expect(createButton()).toBeDisabled();
    fireEvent.click(createButton());

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(keyPosts()).toEqual([]);
  });

  it('§2 a typed name opens a confirm naming the key, and Cancel mints nothing', async () => {
    const input = await renderSettled();
    fireEvent.change(input, { target: { value: 'ci-agent' } });
    expect(createButton()).toBeEnabled();

    fireEvent.click(createButton());
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('«connectAgent.apiKey.confirmTitle|ci-agent»');
    // Opening the confirm is not minting.
    expect(keyPosts()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: '«common.cancel»' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(keyPosts()).toEqual([]);
    // The typed name survives a Cancel, so the administrator can try again.
    expect(input).toHaveValue('ci-agent');
  });

  it('§3 confirming posts exactly the typed name and reveals the key once', async () => {
    const input = await renderSettled();
    fireEvent.change(input, { target: { value: '  ci-agent  ' } });
    fireEvent.click(createButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('«connectAgent.apiKey.confirmTitle|ci-agent»');
    // The dialog's confirm button carries the same label as the card's button;
    // the card's one sits behind the modal, so pick the one inside the dialog.
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === '«connectAgent.apiKey.mint»',
    );
    expect(confirm, 'the confirm offers a Create key action').toBeDefined();
    fireEvent.click(confirm!);

    await waitFor(() => expect(keyPosts()).toEqual([{ name: 'ci-agent' }]));
    expect(await screen.findByText('«connectAgent.apiKey.showOnce|ci-agent»')).toBeInTheDocument();
    expect(screen.getByText(MINTED_KEY)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
