// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34461 — the notes the console adds to a user turn about its
 * attachments (the spreadsheet brief, the "sent as files" line and each
 * not-read line) follow the CONVERSATION's language, like every other piece
 * of outbound text (`outboundAgentText.ts`): Chinese for a Chinese
 * conversation, English for any other. They used to be Chinese always.
 *
 * ## Real subjects
 *
 * As in `AiChatPage.attachmentsUpload-32749.test.tsx`: the full-page chat with
 * the REAL `ChatPane` send path, `useChatConversation` and `useObjectChat`
 * transport; what is pinned is the text of the user message in the chat POST.
 * Stand-ins: the agent catalog, `ChatbotEnhanced` (a recorder), the upload
 * adapter and the spreadsheet parser.
 *
 * Pins:
 *  - an English turn with a spreadsheet, an uploaded image and an over-cap
 *    file: the brief and every note are English;
 *  - the same three files in a Chinese turn: the brief and every note are
 *    Chinese;
 *  - a turn with files and no words, in a thread held in Chinese, takes the
 *    thread's language;
 *  - CONTROL: a turn with no attachment is sent exactly as typed.
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

async function ready(): Promise<void> {
  mountPage();
  await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'), { timeout: 4000 });
}

/** Sends one turn and answers the text of the user message that left with it. */
async function sendTurn(text: string, files?: File[]): Promise<string> {
  const before = state.sent.length;
  await act(async () => {
    state.pane!.onSendMessage!(text, files);
  });
  await waitFor(() => expect(state.sent.length).toBe(before + 1), { timeout: 4000 });
  const user = [...(state.sent[before].messages ?? [])].reverse().find((m) => m.role === 'user');
  return (user?.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
}

function file(name: string, type: string, size?: number): File {
  const f = new File(['bytes'], name, { type });
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
}

const threeFiles = () => [
  file('claims.csv', 'text/csv'),
  file('receipt.png', 'image/png'),
  file('huge.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1),
];

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

describe("AiChatPage — attachment notes follow the conversation's language (objectstack#34461)", () => {
  it('an English turn gets the spreadsheet brief and every file note in English', async () => {
    await ready();
    const text = await sendTurn('Build an app from these', threeFiles());

    expect(state.uploads).toEqual(['receipt.png']);
    expect(text).toContain('[Attached spreadsheet claims.csv — 1 data rows × 2 columns');
    expect(text).toContain('Headers: merchant | amount');
    expect(text).toContain('Sample 1: Taxi | 42');
    expect(text).toContain('Files the user attached (1): receipt.png — sent as files with this message.');
    expect(text).toContain('over the 10 MB cap, were not uploaded, and their content was not read: huge.jpg');
    // Not one Chinese character anywhere in the turn.
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('a Chinese turn gets the spreadsheet brief and every file note in Chinese', async () => {
    await ready();
    const text = await sendTurn('用这些搭一个报销应用', threeFiles());

    expect(state.uploads).toEqual(['receipt.png']);
    expect(text).toContain('[附件表格 claims.csv — 1 数据行 × 2 列');
    expect(text).toContain('表头: merchant | amount');
    expect(text).toContain('样例1: Taxi | 42');
    expect(text).toContain('用户附上了 1 个文件:receipt.png — 已作为文件随本条消息发送。');
    expect(text).toContain('超过 10 MB 上限,未上传,内容未读取:huge.jpg');
    expect(text).not.toMatch(/Attached spreadsheet|Files the user attached|not read/);
  });

  it('a turn with files and no words takes the language the thread is held in', async () => {
    await ready();
    await sendTurn('你好');
    await waitFor(() => expect(state.pane?.isLoading).not.toBe(true), { timeout: 4000 });
    const text = await sendTurn('', [file('receipt.png', 'image/png')]);

    expect(text).toContain('用户附上了 1 个文件:receipt.png');
    expect(text).not.toContain('Files the user attached');
  });

  it('CONTROL: a turn with no attachment is sent exactly as typed', async () => {
    await ready();
    expect(await sendTurn('Hello there')).toBe('Hello there');
    expect(state.uploads).toEqual([]);
    expect(parseSpreadsheetFile).not.toHaveBeenCalled();
  });
});
