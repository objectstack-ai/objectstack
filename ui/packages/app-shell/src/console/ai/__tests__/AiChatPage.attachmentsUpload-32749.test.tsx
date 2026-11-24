// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32749 (ruling A, console half) — an image or PDF attached in the
 * AI chat is uploaded as the signed-in user and rides the user turn as an AI
 * SDK file part carrying its `sys_file` id; a spreadsheet keeps the in-page
 * parse; any file not sent is named in the turn as not read.
 *
 * ## Real subjects
 *
 * The full-page chat (`AiChatPage` at `/ai/build`) with the REAL `ChatPane`
 * send path, the REAL `useChatConversation` and the REAL `useObjectChat`
 * transport. What is pinned is the user message inside the JSON body of the
 * POST to the agent's chat route (captured off a `fetch` stub) and the calls
 * the ambient upload adapter received. The stand-ins: the agent catalog,
 * `ChatbotEnhanced` (a recorder exposing the composer's send), the upload
 * adapter (mounted through the real `UploadProvider`) and the spreadsheet
 * parser.
 *
 * Pins:
 *  - an image and a PDF are uploaded, and the turn carries one file part per
 *    file, with the stored file's URL and its id under
 *    `providerMetadata.objectstack.fileId`;
 *  - CONTROL: a spreadsheet is parsed in the page, uploaded never, and the
 *    turn carries no file part;
 *  - an over-cap image and an unsupported type are not uploaded and are named
 *    in the turn's text;
 *  - a failed upload is named in the turn's text, and the turn still sends
 *    the file that did upload;
 *  - a spreadsheet beside an image: the sheet is parsed, the image uploaded,
 *    and one turn carries both.
 *
 * The turns here are typed in English, so their attachment notes are English
 * (objectstack#34461: the notes follow the conversation's language).
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
  pane: undefined as { onSendMessage?: (text: string, files?: File[]) => void } | undefined,
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

/** The storage adapter: answers a stored file per upload, and fails `broken.png`. */
const uploadAdapter: UploadAdapter = {
  name: 'test-storage',
  async upload(file) {
    const name = (file as File).name;
    state.uploads.push(name);
    if (name === 'broken.png') throw new Error('Upload completion failed (500)');
    const fileId = `file-${name}`;
    return {
      url: `/api/v1/storage/files/${fileId}`,
      name,
      size: file.size,
      mimeType: file.type,
      meta: { fileId },
    };
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

/** Sends one turn through the composer, and returns the user message that left. */
async function send(text: string, files: File[]): Promise<{ parts: SentPart[]; text: string; files: SentPart[] }> {
  mountPage();
  await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'), { timeout: 4000 });
  await act(async () => {
    state.pane!.onSendMessage!(text, files);
  });
  await waitFor(() => expect(state.sent.length).toBe(1), { timeout: 4000 });
  const user = [...(state.sent[0].messages ?? [])].reverse().find((m) => m.role === 'user');
  const parts = user?.parts ?? [];
  return {
    parts,
    text: parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join(''),
    files: parts.filter((p) => p.type === 'file'),
  };
}

function file(name: string, type: string, size?: number): File {
  const f = new File(['bytes'], name, { type });
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
}

const storedUrl = (fileId: string) => new URL(`/api/v1/storage/files/${fileId}`, window.location.href).href;

beforeEach(() => {
  state.pane = undefined;
  state.sent = [];
  state.uploads = [];
  state.minted = 0;
  parseSpreadsheetFile.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AiChatPage — image and PDF attachments ride the turn as stored file parts (objectstack#32749)', () => {
  it('uploads an image and a PDF and sends one file part per file, carrying its sys_file id', async () => {
    const turn = await send('Fill a claim from these', [
      file('receipt.png', 'image/png'),
      file('invoice.pdf', 'application/pdf'),
    ]);

    expect(state.uploads).toEqual(['receipt.png', 'invoice.pdf']);
    expect(turn.files).toEqual([
      {
        type: 'file',
        mediaType: 'image/png',
        filename: 'receipt.png',
        url: storedUrl('file-receipt.png'),
        providerMetadata: { objectstack: { fileId: 'file-receipt.png' } },
      },
      {
        type: 'file',
        mediaType: 'application/pdf',
        filename: 'invoice.pdf',
        url: storedUrl('file-invoice.pdf'),
        providerMetadata: { objectstack: { fileId: 'file-invoice.pdf' } },
      },
    ]);
    expect(turn.text).toContain('Fill a claim from these');
    expect(turn.text).toContain('receipt.png, invoice.pdf');
    expect(turn.text).not.toContain('not read');
    expect(parseSpreadsheetFile).not.toHaveBeenCalled();
  });

  it('CONTROL: a spreadsheet is parsed in the page, never uploaded, and sends no file part', async () => {
    const turn = await send('Build an app from this', [file('claims.csv', 'text/csv')]);

    expect(parseSpreadsheetFile).toHaveBeenCalledTimes(1);
    expect(state.uploads).toEqual([]);
    expect(turn.files).toEqual([]);
    expect(turn.text).toContain('[Attached spreadsheet claims.csv');
  });

  it('names an over-cap image and an unsupported type as not read, and uploads neither', async () => {
    const turn = await send('Here', [
      file('huge.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1),
      file('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ]);

    expect(state.uploads).toEqual([]);
    expect(turn.files).toEqual([]);
    expect(turn.text).toMatch(/over the 10 MB cap, were not uploaded, and their content was not read: huge\.jpg/);
    expect(turn.text).toMatch(/cannot be read yet, were not uploaded, and their content was not read: notes\.docx/);
  });

  it('names a failed upload as not read, and still sends the turn with the file that did upload', async () => {
    const turn = await send('Two photos', [file('broken.png', 'image/png'), file('ok.png', 'image/png')]);

    expect(state.uploads).toEqual(['broken.png', 'ok.png']);
    expect(turn.files.map((p) => p.providerMetadata?.objectstack?.fileId)).toEqual(['file-ok.png']);
    expect(turn.text).toMatch(/failed to upload, and their content was not read: broken\.png/);
  });

  it('parses a spreadsheet and uploads an image attached beside it, in one turn', async () => {
    const turn = await send('Claims and a receipt', [file('claims.csv', 'text/csv'), file('receipt.jpg', 'image/jpeg')]);

    expect(parseSpreadsheetFile).toHaveBeenCalledTimes(1);
    expect(state.uploads).toEqual(['receipt.jpg']);
    expect(turn.files.map((p) => p.providerMetadata?.objectstack?.fileId)).toEqual(['file-receipt.jpg']);
    expect(turn.text).toContain('[Attached spreadsheet claims.csv');
  });
});
