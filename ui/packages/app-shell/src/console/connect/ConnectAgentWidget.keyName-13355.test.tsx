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

describe('Connect an Agent offers the Chinese clients after the international ones (WorkBuddy, Doubao Work, QwenWork)', () => {
  const MCP_URL = `${window.location.origin}/api/v1/mcp`;

  /** Every copy-ready value the widget renders: snippets (`code`) and form rows (`dd`). */
  const copyable = () =>
    Array.from(document.querySelectorAll('code, dd')).map((el) => el.textContent ?? '');

  it('renders one card list, international clients first, then WorkBuddy, Doubao Work and QwenWork', async () => {
    await renderSettled();
    const order = [
      // One Claude card carries both ways in: the connector, then the CLI.
      'Claude',
      'claude.ai / Claude Desktop',
      'Claude Code',
      'Cursor',
      'Codex',
      'WorkBuddy',
      // Product names a pack may write in its own script (zh: 豆包工作 / 千问办公).
      '«connectAgent.doubao.title»',
      '«connectAgent.qwenwork.title»',
    ].map((title) => screen.getByText(title));
    for (let i = 1; i < order.length; i++) {
      const follows = order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(follows, `${order[i].textContent} renders after ${order[i - 1].textContent}`).toBeTruthy();
    }
    // One list: no group headings split the cards.
    expect(document.querySelectorAll('h3')).toHaveLength(0);
    for (const dropped of ['DuMate', 'VS Code / Copilot']) {
      expect(screen.queryByText(dropped)).not.toBeInTheDocument();
    }
    for (const key of ['codex', 'workbuddy', 'doubao', 'qwenwork']) {
      expect(screen.getByText(`«connectAgent.${key}.body»`)).toBeInTheDocument();
      expect(screen.getByText(`«connectAgent.${key}.hint»`)).toBeInTheDocument();
    }
  });

  it('hands each client its own transport spelling for this deployment\'s MCP URL', async () => {
    await renderSettled();
    const values = copyable();
    const json = (type: string) =>
      JSON.stringify({ mcpServers: { objectstack: { type, url: MCP_URL } } }, null, 2);
    // WorkBuddy's mcp.json and QwenWork's JSON import spell Streamable HTTP differently.
    expect(values).toContain(json('streamableHttp'));
    expect(values).toContain(json('streamable-http'));
    // The Codex app and Doubao Work are dialog forms: name, transport and URL, each copyable.
    expect(values.filter((v) => v === 'objectstack')).toHaveLength(2);
    expect(values).toContain('Streamable HTTP');
    expect(values).toContain('HTTP');
    expect(values.filter((v) => v === MCP_URL).length).toBeGreaterThanOrEqual(4);
    // The Codex card describes the app's form, not a config.toml snippet.
    expect(values.some((v) => v.includes('[mcp_servers.objectstack]'))).toBe(false);
  });

  it('reveals a minted key in the Authorization: Bearer form the cards point to', async () => {
    const input = await renderSettled();
    fireEvent.change(input, { target: { value: 'ci-agent' } });
    fireEvent.click(createButton());
    const dialog = await screen.findByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === '«connectAgent.apiKey.mint»',
    );
    fireEvent.click(confirm!);
    expect(await screen.findByText(`Authorization: Bearer ${MINTED_KEY}`)).toBeInTheDocument();
    expect(screen.getByText(`x-api-key: ${MINTED_KEY}`)).toBeInTheDocument();
  });
});
