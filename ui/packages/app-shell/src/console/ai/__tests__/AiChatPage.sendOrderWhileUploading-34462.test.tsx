// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34462 — a turn with an image or PDF is sent only once its upload
 * settles, while a turn without one sends at once. A message sent while the
 * upload ran used to reach the agent FIRST. Turns now reach the agent in the
 * order the user sent them, and the composer reads as busy while a turn's
 * attachments are read, so a message typed meanwhile queues in the composer.
 *
 * ## Real subjects
 *
 * As in `AiChatPage.attachmentsUpload-32749.test.tsx`: the full-page chat
 * (`AiChatPage` at `/ai/build`) with the REAL `ChatPane` send path, the REAL
 * `useChatConversation` and the REAL `useObjectChat` transport; what is pinned
 * is the order of the POSTs to the agent's chat route (captured off a `fetch`
 * stub) and the `isLoading` the page hands the composer. Stand-ins: the agent
 * catalog, `ChatbotEnhanced` (a recorder exposing the composer's send and its
 * props), and an upload adapter whose upload the test settles by hand.
 *
 * Pins:
 *  - a turn sent while an earlier turn's upload is still running reaches the
 *    agent AFTER that turn, and the composer is busy until the upload settles;
 *  - an upload that fails releases the busy state, and the turn still sends,
 *    naming the file as not read;
 *  - CONTROL: a turn with no attachment sends at once, uploading nothing.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type { UploadAdapter } from '@object-ui/types';

interface SentPart {
  type: string;
  text?: string;
  mediaType?: string;
  filename?: string;
  url?: string;
  providerMetadata?: { objectstack?: { fileId?: string } };
}
interface SentBody {
  messages?: Array<{ role: string; parts: SentPart[] }>;
}

const state = {
  pane: undefined as { onSendMessage?: (text: string, files?: File[]) => void; isLoading?: boolean } | undefined,
  sent: [] as SentBody[],
  uploads: [] as string[],
  minted: 0,
};

const parseSpreadsheetFile = vi.fn(async (_file: File) => [
  ['merchant', 'amount'],
  ['Taxi', '42'],
]);

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  parseSpreadsheetFile: (file: File) => parseSpreadsheetFile(file),
}));
vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    ChatbotEnhanced: (props: typeof state.pane) => {
      state.pane = props;
      return <div data-testid="pane" />;
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'build', label: 'Build', capabilities: ['build'] }],
    isLoading: false,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../ConversationsSidebar', () => ({ ConversationsSidebar: () => null }));

vi.mock('../PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { UploadProvider } from '@object-ui/fields';
import { AiChatPage } from '../AiChatPage';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

/** One pending upload per file name; the test settles it. */
const pending = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
const uploadAdapter: UploadAdapter = {
  name: 'test-storage',
  async upload(file) {
    const name = (file as File).name;
    state.uploads.push(name);
    await new Promise<void>((resolve, reject) => pending.set(name, { resolve, reject }));
    const fileId = `file-${name}`;
    return { url: `/api/v1/storage/files/${fileId}`, name, size: file.size, mimeType: file.type, meta: { fileId } };
  },
};

function dataStreamResponse(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (/\/agents\/[^/]+\/chat$/.test(url) && method === 'POST') {
        state.sent.push(JSON.parse(String(init?.body ?? '{}')));
        return dataStreamResponse();
      }
      if (/\/conversations$/.test(url) && method === 'POST') {
        state.minted += 1;
        return json({ id: `conv-${state.minted}`, messages: [] });
      }
      const one = /\/conversations\/([^/?]+)$/.exec(url);
      if (one && method === 'GET') return json({ id: decodeURIComponent(one[1]), messages: [] });
      return json({ success: true, data: [] });
    }),
  );
}

function mountPage(): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <UploadProvider adapter={uploadAdapter}>
        <MemoryRouter initialEntries={['/ai/build']}>
          <Routes>
            <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
            <Route path="/ai/:agent" element={<AiChatPage />} />
          </Routes>
        </MemoryRouter>
      </UploadProvider>
    </I18nProvider>,
  );
}

/** The text of the newest user message in the n-th chat POST. */
function userText(n: number): string {
  const user = [...(state.sent[n]?.messages ?? [])].reverse().find((m) => m.role === 'user');
  return (user?.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
}

async function ready(): Promise<void> {
  mountPage();
  await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'), { timeout: 4000 });
}

async function sendTurn(text: string, files?: File[]): Promise<void> {
  await act(async () => {
    state.pane!.onSendMessage!(text, files);
  });
}

/** Lets the conversation create, the upload start and any send go out. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const photo = () => new File(['bytes'], 'receipt.png', { type: 'image/png' });

beforeEach(() => {
  state.pane = undefined;
  state.sent = [];
  state.uploads = [];
  state.minted = 0;
  pending.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AiChatPage — turns reach the agent in the order sent, while attachments upload (objectstack#34462)', () => {
  it('a turn sent during a slow upload reaches the agent after the turn carrying the upload', async () => {
    await ready();
    // The first send creates the conversation; a plain turn makes it exist.
    await sendTurn('Hello');
    await waitFor(() => expect(state.sent.length).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(state.pane?.isLoading).toBe(false), { timeout: 4000 });

    await sendTurn('Fill a claim from this receipt', [photo()]);
    await waitFor(() => expect(state.uploads).toEqual(['receipt.png']), { timeout: 4000 });
    // Busy while the photo uploads.
    expect(state.pane?.isLoading).toBe(true);

    await sendTurn('Use today as the claim date');
    await settle();
    // Nothing overtakes the turn still uploading.
    expect(state.sent.length).toBe(1);

    await act(async () => {
      pending.get('receipt.png')!.resolve();
    });
    await waitFor(() => expect(state.sent.length).toBe(3), { timeout: 4000 });
    expect(userText(1)).toContain('Fill a claim from this receipt');
    expect(userText(2)).toContain('Use today as the claim date');
    await waitFor(() => expect(state.pane?.isLoading).toBe(false), { timeout: 4000 });
  });

  it('an upload that fails releases the busy state, and the turn still sends naming the file', async () => {
    await ready();
    await sendTurn('Hello');
    await waitFor(() => expect(state.sent.length).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(state.pane?.isLoading).toBe(false), { timeout: 4000 });

    await sendTurn('Read this', [photo()]);
    await waitFor(() => expect(state.uploads).toEqual(['receipt.png']), { timeout: 4000 });
    expect(state.pane?.isLoading).toBe(true);

    await act(async () => {
      pending.get('receipt.png')!.reject(new Error('Upload completion failed (500)'));
    });
    await waitFor(() => expect(state.sent.length).toBe(2), { timeout: 4000 });
    expect(userText(1)).toMatch(/failed to upload, and their content was not read: receipt\.png/);
    await waitFor(() => expect(state.pane?.isLoading).toBe(false), { timeout: 4000 });
  });

  it('CONTROL: a turn with no attachment sends at once, uploading nothing', async () => {
    await ready();
    await sendTurn('Hello');
    await waitFor(() => expect(state.sent.length).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(state.pane?.isLoading).toBe(false), { timeout: 4000 });

    await sendTurn('And a second question');
    await waitFor(() => expect(state.sent.length).toBe(2), { timeout: 4000 });
    expect(userText(1)).toContain('And a second question');
    expect(state.uploads).toEqual([]);
  });
});
