// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12894 (the console wiring), carried by objectui#12725 phase 6 — the
 * two doors on the Studio copilot's applied card, end to end.
 *
 * A change the copilot saved as a draft (objectstack-ai/cloud#2924) ends in the
 * applied card 「已存为草稿 · N 项」 with 查看变更并发布 and 撤销. The card is
 * `plugin-chatbot`'s; the doors are the host's, and `ChatPane` is the host the
 * Studio copilot mounts:
 *
 *  - 撤销 → `POST /packages/:id/discard-drafts` for the card's package (through
 *    the SDK client the console's adapter holds), then the assistant bus's
 *    pulse, so the top bar's 变更 badge re-reads its ledger;
 *  - 查看变更并发布 → the surface's 变更 drawer, through its one declared way in
 *    (`?changes=review`, `studioChangesLink.ts`). The copilot is already inside
 *    Studio, so the surface stays mounted: same tree, same pillar, same
 *    selection, and the param is dropped once read.
 *
 * Real: the surface, its top bar and `usePendingDrafts`, the right slot, the
 * Studio copilot (`StudioChatDock` → `StudioCopilotConversation` → `ChatPane`),
 * and the chat itself (`ChatbotEnhanced`, with the chat package's own mapping
 * of each tool part), fed the producer's envelope shapes. Stubbed:
 * `globalThis.fetch` (the server), the SDK client's `packages.discardDrafts`,
 * the chat transport (`useObjectChat` serves a scripted thread), the agent
 * catalog, the conversation lookup, and the drawer's body (`DraftChangesPanel`,
 * reduced to its `open` and `posture`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const PACKAGE_ID = 'app.hcpl';
const DRAFTS = `/api/v1/meta/_drafts?packageId=${encodeURIComponent(PACKAGE_ID)}`;

/** The scripted thread the mocked transport serves. */
const chat = vi.hoisted(() => {
  type Snapshot = { messages: unknown[]; isLoading: boolean };
  let snapshot: Snapshot = { messages: [], isLoading: false };
  const listeners = new Set<() => void>();
  return {
    get: (): Snapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: Snapshot): void {
      snapshot = next;
      for (const l of listeners) l();
    },
  };
});

/** The SDK client's discard door (`packages.discardDrafts`). */
const sdk = vi.hoisted(() => ({ discardDrafts: vi.fn() }));

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    // `ChatbotEnhanced` stays REAL: its applied card and the two buttons on it
    // are what the user clicks.
    useObjectChat: () => {
      const s = React.useSyncExternalStore(chat.subscribe, chat.get, chat.get);
      return {
        messages: s.messages,
        isLoading: s.isLoading,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'build', label: 'Builder', capabilities: ['build'] }],
    isLoading: false,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../hooks/useChatConversation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatConversation: () => ({ conversationId: 'conv-hcpl', initialMessages: [] }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'hcpl' }]),
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const adapter = { getClient: () => ({ packages: { discardDrafts: sdk.discardDrafts } }) };
  return { ...actual, useAdapter: () => adapter };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: ({ open, posture }: { open: boolean; posture?: string }) => (
    <div data-testid="draft-changes-panel" data-open={String(open)} data-posture={posture ?? ''} />
  ),
}));

import { uiMessagesToChatMessages } from '@object-ui/plugin-chatbot';
import { I18nProvider } from '@object-ui/i18n';
import { StudioDesignSurface } from './StudioDesignSurface';
import { subscribeMetadataRefresh } from '../../assistant/assistantBus';

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
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

/** What `_drafts` answers: the package's pending drafts, server-side. */
let serverDrafts: Array<Record<string, unknown>> = [];
/** How many `_drafts` reads the page sent. */
let draftReads = 0;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

// ── The producer's envelopes (objectstack-ai/cloud#2924) ──────────────────

const BORROWING_ROW = {
  type: 'object',
  name: 'hcpl_borrowing',
  label: '借阅记录',
  packageId: PACKAGE_ID,
  updatedAt: null,
  updatedBy: 'u1',
};

/** The 确认修改 card: `apply_edit` answered `changes_proposed`, draft posture. */
const PROPOSED = {
  status: 'changes_proposed',
  applied: false,
  changes: [{ verb: 'add_field', object: 'hcpl_borrowing', field: 'renew_count', type: 'number', details: '续借次数 · 默认 0 · 不必填' }],
  summary: '这个应用已上线，有 12 条记录在用。改动先存为草稿；画布和右侧属性里能看到效果，你在「变更」里核对后再发布。',
  posture: { mode: 'draft', liveRecords: 12 },
  primaryAction: 'save_draft',
};

/** Its confirm replay: one draft staged, the applied card's title and lines. */
const DRAFTED = {
  status: 'drafted',
  kind: 'edit',
  drafted: [{ type: 'object', name: 'hcpl_borrowing' }],
  packageId: PACKAGE_ID,
  summary: '已起草 1 处改动',
  posture: { mode: 'draft', liveRecords: 12 },
  draftState: { pending: 1, items: [{ type: 'object', name: 'hcpl_borrowing' }], others: 0 },
  existingRows: [{ object: 'hcpl_borrowing', field: 'renew_count', label: '续借次数', rows: 12 }],
  appliedCard: { title: '已存为草稿 · 1 项未发布', lines: ['已有 12 条记录的续借次数为空', '核对：结构 ✓'] },
};

const THREAD = [
  { id: 'm-user-1', role: 'user', parts: [{ type: 'text', text: '给借阅记录加一个续借次数字段' }] },
  {
    id: 'm-asst-1',
    role: 'assistant',
    parts: [{ type: 'tool-apply_edit', toolCallId: 'call_1', state: 'output-available', input: {}, output: JSON.stringify(PROPOSED) }],
  },
  { id: 'm-user-2', role: 'user', parts: [{ type: 'text', text: '存为草稿' }] },
  {
    id: 'm-asst-2',
    role: 'assistant',
    parts: [
      { type: 'tool-apply_edit', toolCallId: 'replay_t2_0', state: 'output-available', input: {}, output: JSON.stringify(DRAFTED) },
      { type: 'text', text: '已存为草稿。' },
    ],
  },
];

beforeEach(() => {
  serverDrafts = [BORROWING_ROW];
  draftReads = 0;
  sdk.discardDrafts.mockReset();
  chat.set({ messages: uiMessagesToChatMessages(THREAD as never, { isStreaming: false }), isLoading: false });
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === DRAFTS) {
        draftReads += 1;
        return json({ drafts: serverDrafts });
      }
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderStudio(entry = `/studio/${PACKAGE_ID}/interfaces?surface=object%3Ahcpl_borrowing`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Mount the surface with one pending draft and the applied card on screen. */
async function mountWithAppliedCard() {
  const view = renderStudio();
  const card = await screen.findByTestId('applied-card');
  await waitFor(() => expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('1'));
  await act(drain);
  return { view, card };
}

describe('the Studio copilot\'s applied card opens the 变更 drawer in place (objectui#12894)', () => {
  it('查看变更并发布 opens the drawer to review, with no remount and no change of pillar', async () => {
    const { view, card } = await mountWithAppliedCard();
    const surfaceRoot = view.container.lastElementChild;
    const location = screen.getByTestId('location').textContent;
    expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-open', 'false');

    fireEvent.click(within(card).getByTestId('applied-card-review'));

    await waitFor(() => expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-open', 'true'));
    expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-posture', 'review');
    // The param was read and dropped: the URL is the one the user was on.
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(location));
    // In place: the same surface tree, and the conversation is still there.
    expect(view.container.lastElementChild).toBe(surfaceRoot);
    expect(screen.getByTestId('applied-card')).toBe(card);
  });

  it('arriving with ?changes=review (the full-page chat\'s link) opens the drawer, then drops the param', async () => {
    renderStudio(`/studio/${PACKAGE_ID}/interfaces?changes=review`);
    await waitFor(() => expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-open', 'true'));
    expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-posture', 'review');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/studio/${PACKAGE_ID}/interfaces`));
  });

  it('CONTROL: a value the surface does not know opens nothing, and is dropped all the same', async () => {
    renderStudio(`/studio/${PACKAGE_ID}/interfaces?changes=publish`);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/studio/${PACKAGE_ID}/interfaces`));
    await act(drain);
    expect(screen.getByTestId('draft-changes-panel')).toHaveAttribute('data-open', 'false');
  });
});

describe('the Studio copilot\'s composer (objectui#12725 Target item 4)', () => {
  it('zh: the placeholder reads「问问数据，或让我改改这个应用…」, and the chip names the item in view', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data?surface=object%3Ahcpl_borrowing`]}>
          <Routes>
            <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    const slot = await screen.findByTestId('studio-slot-copilot');
    const composer = await within(slot).findByRole('textbox');
    expect(composer).toHaveAttribute('placeholder', '问问数据，或让我改改这个应用…');
    // The chip `plugin-chatbot` declares (`surfaceContextLabel`), naming the
    // item the URL has open.
    const chip = within(slot).getByTestId('surface-context-chip');
    expect(chip).toHaveTextContent('正在讨论：');
    expect(chip).toHaveTextContent('hcpl_borrowing');
  });
});

describe('the Studio copilot\'s applied card undoes through discard-drafts (objectui#12894)', () => {
  it('撤销 discards the card\'s package and the 变更 badge re-reads its ledger', async () => {
    sdk.discardDrafts.mockImplementation(async () => {
      serverDrafts = [];
      return {
        success: true,
        discardedCount: 1,
        failedCount: 0,
        discarded: [{ type: 'object', name: 'hcpl_borrowing' }],
        failed: [],
      };
    });
    const { card } = await mountWithAppliedCard();
    const readsBefore = draftReads;

    fireEvent.click(within(card).getByTestId('applied-card-discard'));

    await waitFor(() => expect(within(card).getByTestId('applied-card-discarded')).toBeInTheDocument());
    expect(sdk.discardDrafts).toHaveBeenCalledTimes(1);
    expect(sdk.discardDrafts).toHaveBeenCalledWith(PACKAGE_ID);
    await waitFor(() => expect(screen.queryByTestId('studio-changes-count')).toBeNull());
    expect(draftReads).toBeGreaterThan(readsBefore);
  });

  it('a draft the server could not drop is a failure the card shows with the server\'s reason; the pulse still goes out', async () => {
    sdk.discardDrafts.mockImplementation(async () => ({
      success: false,
      discardedCount: 0,
      failedCount: 1,
      discarded: [],
      failed: [{ type: 'object', name: 'hcpl_borrowing', error: 'draft is locked by a publish in progress' }],
    }));
    const { card } = await mountWithAppliedCard();
    let pulses = 0;
    const unsubscribe = subscribeMetadataRefresh(() => {
      pulses += 1;
    });
    try {
      fireEvent.click(within(card).getByTestId('applied-card-discard'));

      const failed = await within(card).findByTestId('applied-card-discard-failed');
      expect(failed).toHaveTextContent('object/hcpl_borrowing: draft is locked by a publish in progress');
      expect(within(card).queryByTestId('applied-card-discarded')).toBeNull();
      expect(pulses).toBe(1);
      expect(screen.getByTestId('studio-changes-count')).toHaveTextContent('1');
    } finally {
      unsubscribe();
    }
  });
});
