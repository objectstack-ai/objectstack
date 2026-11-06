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
 * The key form lives in the collapsed "Advanced: scripts and CI" section, so
 * those cases open it first. The last block holds the page's shape: the
 * endpoint and SKILL.md on top, a picker that shows one client's steps and
 * remembers the choice on this browser, and the key form collapsed. The
 * reachability block holds that claude.ai (web) and Doubao Work's cloud tasks
 * are marked not available on an address that is not public HTTPS. The
 * capabilities block holds the page's opening: what a connected assistant can
 * do and example requests above everything else, and no protocol word in any
 * pack except where a client's own form or menu names it.
 *
 * `fetch` is stubbed by path; `t` echoes the KEY (with the `name` or
 * `address` option appended when one is passed), as the sibling suites do,
 * so the assertions read which string the widget asked for and with which
 * value.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { name?: string; address?: string }) => {
      const arg = opts?.name ?? opts?.address;
      return typeof arg === 'string' ? `«${key}|${arg}»` : `«${key}»`;
    },
    language: 'en',
  }),
}));

import { ConnectAgent } from './ConnectAgentWidget';
import { isPublicHttpsAddress } from './deploymentReach';
import { builtInLocales } from '@object-ui/i18n/locales';

const MINTED_KEY = 'osk_test_0123456789';

let fetchMock: ReturnType<typeof vi.fn>;
/** The `routes.mcp` discovery answers; a case may point it at another address. */
let discoveredMcp = '/api/v1/mcp';

/** The bodies of every `POST /api/v1/keys` the widget sent. */
function keyPosts(): unknown[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).includes('/api/v1/keys'))
    .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? 'null')));
}

beforeEach(() => {
  window.localStorage.clear();
  discoveredMcp = '/api/v1/mcp';
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/discovery')) {
      return new Response(JSON.stringify({ data: { routes: { mcp: discoveredMcp } } }), {
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

/** Render and wait for discovery to settle: the client picker is up. */
async function renderPage() {
  const view = render(<ConnectAgent />);
  await screen.findByRole('tablist');
  return view;
}

/** The API key form sits in the collapsed Advanced section; open it and return its name box. */
async function renderSettled() {
  await renderPage();
  fireEvent.click(screen.getByRole('button', { name: /«connectAgent\.advanced\.title»/ }));
  return screen.findByPlaceholderText('«connectAgent.apiKey.namePlaceholder»');
}

/** Pick a client in the picker (Radix tabs activate on mouse-down). */
function pickClient(label: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name: label }), { button: 0 });
}

const PICKER_LABELS = [
  'Claude',
  'Codex',
  'Cursor',
  'WorkBuddy',
  // Product names a pack may write in its own script (zh: 豆包工作 / 千问办公).
  '«connectAgent.doubao.title»',
  '«connectAgent.qwenwork.title»',
];

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

  it('offers one picker, international clients first, then WorkBuddy, Doubao Work and QwenWork', async () => {
    await renderPage();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(PICKER_LABELS);
    for (const dropped of ['DuMate', 'VS Code / Copilot']) {
      expect(screen.queryByText(dropped)).not.toBeInTheDocument();
    }
    // Claude carries both ways in: the connector, then the CLI.
    const desktop = screen.getByText('claude.ai / Claude Desktop');
    const code = screen.getByText('Claude Code');
    expect(desktop.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const [label, key] of [
      ['Codex', 'codex'],
      ['WorkBuddy', 'workbuddy'],
      ['«connectAgent.doubao.title»', 'doubao'],
      ['«connectAgent.qwenwork.title»', 'qwenwork'],
    ]) {
      pickClient(label);
      expect(await screen.findByText(`«connectAgent.${key}.body»`)).toBeInTheDocument();
      expect(screen.getByText(`«connectAgent.${key}.hint»`)).toBeInTheDocument();
    }
  });

  it('hands each client its own transport spelling for this deployment\'s MCP URL', async () => {
    await renderPage();
    const json = (type: string) =>
      JSON.stringify({ mcpServers: { objectstack: { type, url: MCP_URL } } }, null, 2);
    // WorkBuddy's mcp.json and QwenWork's JSON import spell Streamable HTTP differently.
    pickClient('WorkBuddy');
    await waitFor(() => expect(copyable()).toContain(json('streamableHttp')));
    pickClient('«connectAgent.qwenwork.title»');
    await waitFor(() => expect(copyable()).toContain(json('streamable-http')));
    // The Codex app and Doubao Work are dialog forms: name, transport and URL, each copyable
    // (after the endpoint's own URL on top).
    pickClient('Codex');
    await waitFor(() => expect(copyable()).toEqual([MCP_URL, 'objectstack', 'Streamable HTTP', MCP_URL]));
    // The Codex steps describe the app's form, not a config.toml snippet.
    expect(copyable().some((v) => v.includes('[mcp_servers.objectstack]'))).toBe(false);
    pickClient('«connectAgent.doubao.title»');
    await waitFor(() => expect(copyable()).toEqual([MCP_URL, 'objectstack', 'HTTP', MCP_URL]));
  });

  it('reveals a minted key in the Authorization: Bearer form the steps point to', async () => {
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

describe('Connect an Agent asks which client the person uses and shows only those steps', () => {
  const PREFERENCE_KEY = 'os:pref:connect.client';
  const CLAUDE_CODE = /^claude mcp add --transport http objectstack /;

  it('§1 the endpoint and SKILL.md stay on top; one client\'s steps show; the API key form is collapsed', async () => {
    await renderPage();
    // On top, for everyone: the endpoint and the skill download.
    const endpoint = screen.getByText('«connectAgent.url.title»');
    const picker = screen.getByText('«connectAgent.client.title»');
    expect(endpoint.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: /«connectAgent\.url\.downloadSkill»/ })).toHaveAttribute(
      'download',
      'SKILL.md',
    );
    // A person who never chose sees Claude, and only Claude.
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(CLAUDE_CODE)).toBeInTheDocument();
    for (const key of ['codex', 'cursor', 'workbuddy', 'doubao', 'qwenwork']) {
      expect(screen.queryByText(`«connectAgent.${key}.body»`)).not.toBeInTheDocument();
    }
    // Scripts and CI: the API key form waits behind the collapsed Advanced section, after the picker.
    const advanced = screen.getByRole('button', { name: /«connectAgent\.advanced\.title»/ });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    expect(picker.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('«connectAgent.apiKey.title»')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('«connectAgent.apiKey.namePlaceholder»')).not.toBeInTheDocument();
    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('«connectAgent.apiKey.title»')).toBeInTheDocument();
  });

  it('§2 one click switches clients, and this browser remembers the choice', async () => {
    const first = await renderPage();
    pickClient('Cursor');
    expect(await screen.findByText('«connectAgent.cursor.body»')).toBeInTheDocument();
    expect(screen.queryByText(CLAUDE_CODE)).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(PREFERENCE_KEY) ?? 'null')).toEqual({ client: 'cursor', v: 1 });

    first.unmount();
    await renderPage();
    expect(screen.getByRole('tab', { name: 'Cursor' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('«connectAgent.cursor.body»')).toBeInTheDocument();
  });

  it('§3 a stored client the page does not offer reads as no choice', async () => {
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ client: 'copilot', v: 1 }));
    await renderPage();
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(CLAUDE_CODE)).toBeInTheDocument();
  });
});

describe('Connect an Agent marks the cloud-connected ways in as not available on an address that is not public HTTPS', () => {
  const notes = () => screen.queryAllByRole('note').map((n) => n.textContent ?? '');

  it('§1 classifies the address: http, localhost, single-label and private hosts are not public HTTPS', () => {
    for (const address of [
      'http://crm.example.com/api/v1/mcp',
      'https://localhost:3000/api/v1/mcp',
      'https://app.localhost/api/v1/mcp',
      'https://crm/api/v1/mcp',
      'https://crm.local/api/v1/mcp',
      'https://10.1.2.3/api/v1/mcp',
      'https://172.20.0.5/api/v1/mcp',
      'https://192.168.1.10/api/v1/mcp',
      'https://127.0.0.1/api/v1/mcp',
      'https://169.254.1.1/api/v1/mcp',
      'https://100.64.0.1/api/v1/mcp',
      'https://[::1]/api/v1/mcp',
      'https://[fd12:3456::1]/api/v1/mcp',
      'https://[fe80::1]/api/v1/mcp',
      'https://[::ffff:10.0.0.1]/api/v1/mcp',
      'not a url',
    ]) {
      expect(isPublicHttpsAddress(address), address).toBe(false);
    }
    for (const address of [
      'https://crm.example.com/api/v1/mcp',
      'https://crm.example.com:8443/api/v1/mcp',
      'https://8.8.8.8/api/v1/mcp',
      'https://172.32.0.1/api/v1/mcp',
      'https://[2001:db8::1]/api/v1/mcp',
    ]) {
      expect(isPublicHttpsAddress(address), address).toBe(true);
    }
  });

  it('§2 on an http://localhost address, claude.ai (web) and Doubao cloud tasks say why and what fixes it; local clients unchanged', async () => {
    discoveredMcp = 'http://localhost:3000/api/v1/mcp';
    await renderPage();
    expect(notes()).toEqual([
      '«connectAgent.unreachable.claudeWebTitle»«connectAgent.unreachable.claudeWebReason|http://localhost:3000»«connectAgent.unreachable.remedy»',
    ]);
    expect(screen.queryByText('«connectAgent.claude.reachability»')).not.toBeInTheDocument();
    // Claude Desktop and Claude Code keep their steps.
    expect(screen.getByText('«connectAgent.claude.body»')).toBeInTheDocument();
    expect(screen.getByText(/^claude mcp add --transport http objectstack http:\/\/localhost:3000\/api\/v1\/mcp$/)).toBeInTheDocument();

    pickClient('«connectAgent.doubao.title»');
    await screen.findByText('«connectAgent.doubao.body»');
    expect(notes()).toEqual([
      '«connectAgent.unreachable.doubaoCloudTitle»«connectAgent.unreachable.doubaoCloudReason|http://localhost:3000»«connectAgent.unreachable.remedy»',
    ]);

    for (const local of ['Codex', 'Cursor']) {
      pickClient(local);
      await waitFor(() => expect(screen.getByRole('tab', { name: local })).toHaveAttribute('aria-selected', 'true'));
      expect(notes()).toEqual([]);
    }
  });

  it('§3 on a public HTTPS address nothing is marked', async () => {
    discoveredMcp = 'https://crm.example.com/api/v1/mcp';
    await renderPage();
    expect(notes()).toEqual([]);
    expect(screen.getByText('«connectAgent.claude.reachability»')).toBeInTheDocument();
    pickClient('«connectAgent.doubao.title»');
    await screen.findByText('«connectAgent.doubao.body»');
    expect(notes()).toEqual([]);
  });
});

describe('Connect an Agent says what a connected assistant can do, in plain words, before any setup', () => {
  /**
   * The `connectAgent.*` strings that may name a protocol: a client's own menu
   * or form spells it there (Codex's "MCP servers", WorkBuddy's "Configure
   * MCP", QwenWork's Streamable HTTP transport choice), or the operator's
   * setting is quoted by name (`OS_MCP_SERVER_ENABLED`).
   */
  const CLIENT_FORM_KEYS = new Set(['codex.body', 'workbuddy.body', 'qwenwork.hint', 'disabled.body']);
  const PROTOCOL_WORDS = /\bMCP\b|OAuth|Streamable HTTP/;

  function flatten(node: unknown, prefix = ''): Array<[string, string]> {
    if (typeof node === 'string') return [[prefix, node]];
    if (!node || typeof node !== 'object') return [];
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it('§1 opens with what the assistant can do, then example requests to copy, above the address', async () => {
    await renderPage();
    const capabilities = screen.getByText('«connectAgent.capabilities.title»');
    const endpoint = screen.getByText('«connectAgent.url.title»');
    expect(capabilities.compareDocumentPosition(endpoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('«connectAgent.capabilities.body»')).toBeInTheDocument();
    const examples = ['example1', 'example2', 'example3'].map((n) =>
      screen.getByText(`«connectAgent.capabilities.${n}»`),
    );
    for (const example of examples) {
      // Each request sits beside its own copy button.
      expect(example.closest('li')?.querySelector('button')).not.toBeNull();
      expect(example.compareDocumentPosition(endpoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // What to try first is said to everyone: the page cannot tell whether you have connected.
    expect(screen.getByText('«connectAgent.capabilities.tryFirst»')).toBeInTheDocument();
  });

  it('§2 every pack says it in its own words: the capability strings are present and not English copies', () => {
    const en = flatten((builtInLocales.en as Record<string, unknown>).connectAgent);
    const caps = en.filter(([key]) => key.startsWith('capabilities.'));
    expect(caps.map(([key]) => key)).toEqual([
      'capabilities.title',
      'capabilities.body',
      'capabilities.examplesTitle',
      'capabilities.example1',
      'capabilities.example2',
      'capabilities.example3',
      'capabilities.tryFirst',
    ]);
    for (const [lang, pack] of Object.entries(builtInLocales)) {
      const strings = new Map(flatten((pack as Record<string, unknown>).connectAgent));
      for (const [key, english] of caps) {
        const text = strings.get(key);
        expect(text, `${lang} ${key}`).toBeTruthy();
        if (lang !== 'en') expect(text, `${lang} ${key}`).not.toBe(english);
      }
    }
  });

  it('§3 no protocol word appears in any pack except where a client form names it', () => {
    const offenders: string[] = [];
    for (const [lang, pack] of Object.entries(builtInLocales)) {
      for (const [key, text] of flatten((pack as Record<string, unknown>).connectAgent)) {
        if (!CLIENT_FORM_KEYS.has(key) && PROTOCOL_WORDS.test(text)) offenders.push(`${lang} ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('§4 the hints that fall back to an API key point to the Advanced section, in every pack', () => {
    for (const [lang, pack] of Object.entries(builtInLocales)) {
      const strings = new Map(flatten((pack as Record<string, unknown>).connectAgent));
      const advanced = String(strings.get('advanced.title'));
      for (const key of ['codex.hint', 'workbuddy.hint', 'doubao.hint', 'qwenwork.hint']) {
        expect(strings.get(key), `${lang} ${key}`).toContain(advanced);
      }
    }
  });
});
