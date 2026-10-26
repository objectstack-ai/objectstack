// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12965 (part of objectui#12725) — `ChatPane` does not draw the
 * floating pending-drafts bar in the package's own Studio.
 *
 * In the Studio copilot's right slot the bar (`PendingDraftsBar`, objectui#5694)
 * floated over the composer's input line and hid its placeholder. There the
 * Studio top bar's 变更 and 发布 and the applied card's 查看变更并发布 are the
 * ways to review and publish, and objectui#12725's ruled artboard draws no
 * bar. Outside Studio — the full-page chat and the console dock — the bar
 * stays (since objectui#12978 as a row of the composer's area, not a float).
 *
 * Every case has a draft pending for the bound package, so the bar has
 * something to draw. In Studio, the sibling probe reads the same ledger
 * through the same hook the Studio top bar's 变更 badge uses; it answers 1
 * before the bar's absence is read, so the absence is not a read taken before
 * the ledger answered. No layout runs here: the composer's unobstructed input
 * line was measured in a real browser at 1010 and 1280 px, on this card's
 * evidence branch.
 *
 * Same harness as `AiChatPage.appliedCardDoors-12894.test.tsx`: the real pane,
 * with `ChatbotEnhanced` replaced by a stub, and the real `PendingDraftsBar`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // objectui#12978 — the bar is a row of the composer's own area now, handed
    // in through `promptHeaderSlot`; the stub draws that slot so the bar can be
    // read. Where it sits against the input is pinned with the real component
    // in `AiChatPage.draftsBarInFlow-12978.test.tsx`.
    ChatbotEnhanced: ({ promptHeaderSlot }: { promptHeaderSlot?: React.ReactNode }) => (
      <div data-testid="ai-chat-panel">{promptHeaderSlot}</div>
    ),
    useObjectChat: () => ({
      messages: [],
      isLoading: false,
      error: undefined,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
  };
});

vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});

import { I18nProvider } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';
import { usePendingDrafts } from '../../../preview/usePendingDrafts';

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

const PKG = 'app.hcpl';
const AGENTS = [{ name: 'build', label: 'Build' }] as unknown as AgentDescriptor[];
const DRAFT = { type: 'object', name: 'hcpl_borrowing', label: 'Borrowing', packageId: PKG };

/** Reads the package's pending drafts the way the Studio top bar's 变更 badge does. */
function DraftsBadgeProbe({ packageId }: { packageId: string }): React.ReactElement {
  const { count } = usePendingDrafts({ packageId });
  return <div data-testid="drafts-badge-probe">{count === null ? '' : String(count)}</div>;
}

function renderPane(entry: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[entry]}>
        <ChatPane
          agents={AGENTS}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent="build"
          chatApi="/api/v1/ai/agents/build/chat"
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          editPackageId={PKG}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
        <DraftsBadgeProbe packageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // One draft pending for the bound package; every other request answers empty.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const body = String(url).includes('/meta/_drafts') ? { drafts: [DRAFT] } : { success: true, data: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#12965 — the pending-drafts bar in the Studio copilot', () => {
  it('on one of the package\'s Studio pillars, with a draft pending, no pending-drafts bar is drawn', async () => {
    renderPane('/studio/app.hcpl/interfaces?surface=object%3Ahcpl_borrowing');
    // The ledger has answered with the pending draft (the 变更 badge's reading)...
    await waitFor(() => expect(screen.getByTestId('drafts-badge-probe').textContent).toBe('1'));
    // ...and the chat draws no bar over its composer.
    expect(screen.getByTestId('ai-chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-drafts-bar')).toBeNull();
  });

  it.each([
    ['the full-page chat', '/ai/build/conv-1?package=app.hcpl'],
    ['the console dock, inside the running app', '/apps/hcpl/hcpl_borrowing'],
  ])('CONTROL: %s, with a draft pending, still draws the bar', async (_host, entry) => {
    renderPane(entry);
    expect(await screen.findByTestId('pending-drafts-bar')).toBeInTheDocument();
    expect(screen.getByTestId('drafts-badge-probe').textContent).toBe('1');
  });
});
