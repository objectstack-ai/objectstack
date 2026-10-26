// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12894 (the console wiring) and objectui#12725 phase 6 — what
 * `ChatPane` hands `ChatbotEnhanced` for the copilot's applied card, and the
 * column it hosts the chat in.
 *
 *  - 查看变更并发布 (`onReviewDrafts`) opens Studio's 变更 drawer through its one
 *    declared way in, `?changes=review`: on one of the package's Studio pillars
 *    the param goes onto the current location (replace, nothing remounts; the
 *    in-place half is pinned end to end in
 *    `StudioDesignSurface.copilotDoors-12894.test.tsx`); anywhere else — this
 *    full-page chat, the console dock — the link opens the package's Studio.
 *  - 撤销 (`onDiscardDrafts`) is the SDK client's `packages.discardDrafts`, and
 *    is offered only while the console's adapter is up.
 *  - The chat column is bounded by its parent (`min-w-0`), so the chat follows
 *    the Studio copilot's slot instead of the min-content width of a one-line
 *    tool summary. No layout runs here; the measured widths, before and after,
 *    are on objectui#12725 phase 6's evidence branch.
 *
 * Same harness as `AiChatPage.appContextComposer-11658.test.tsx`: the real pane,
 * with `ChatbotEnhanced` replaced by a prop recorder.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';

let captured: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      captured = props;
      return <div data-testid="ai-chat-panel" />;
    },
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

const discardDrafts = vi.fn();
let adapter: unknown = null;
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => adapter };
});

import { I18nProvider } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';

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

const AGENTS = [{ name: 'build', label: 'Build' }] as unknown as AgentDescriptor[];

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPane(entry: string, editPackageId?: string) {
  cleanup();
  captured = {};
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <ChatPane
          agents={AGENTS}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent="build"
          chatApi="/api/v1/ai/agents/build/chat"
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          editPackageId={editPackageId}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  return captured;
}

beforeEach(() => {
  window.localStorage.clear();
  discardDrafts.mockReset();
  adapter = { getClient: () => ({ packages: { discardDrafts } }) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#12894 — 查看变更并发布 opens Studio\'s 变更 drawer', () => {
  it('from the full-page chat: the package\'s Studio, with the drawer requested', () => {
    const props = renderPane('/ai/build/conv-1?package=app.hcpl', 'app.hcpl');
    const onReviewDrafts = props.onReviewDrafts as (packageId: string) => void;
    expect(typeof onReviewDrafts).toBe('function');
    act(() => onReviewDrafts('app.hcpl'));
    expect(screen.getByTestId('location').textContent).toBe('/studio/app.hcpl/interfaces?changes=review');
  });

  it('on one of the package\'s Studio pillars: the same pillar and selection, with the param added', () => {
    const props = renderPane('/studio/app.hcpl/data?surface=object%3Ahcpl_borrowing', 'app.hcpl');
    act(() => (props.onReviewDrafts as (packageId: string) => void)('app.hcpl'));
    expect(screen.getByTestId('location').textContent).toBe(
      '/studio/app.hcpl/data?surface=object%3Ahcpl_borrowing&changes=review',
    );
  });

  it('CONTROL: on ANOTHER package\'s Studio, the card\'s own package opens', () => {
    const props = renderPane('/studio/app.other/data', 'app.other');
    act(() => (props.onReviewDrafts as (packageId: string) => void)('app.hcpl'));
    expect(screen.getByTestId('location').textContent).toBe('/studio/app.hcpl/interfaces?changes=review');
  });
});

describe('objectui#12894 — 撤销 is the SDK client\'s discard-drafts', () => {
  it('calls `packages.discardDrafts` with the card\'s package and reports success', async () => {
    discardDrafts.mockResolvedValue({ success: true, discardedCount: 2, failedCount: 0, discarded: [], failed: [] });
    const props = renderPane('/ai/build/conv-1?package=app.hcpl', 'app.hcpl');
    const onDiscardDrafts = props.onDiscardDrafts as (packageId: string) => Promise<unknown>;
    await expect(onDiscardDrafts('app.hcpl')).resolves.toEqual({ ok: true });
    expect(discardDrafts).toHaveBeenCalledWith('app.hcpl');
  });

  it('a thrown request is a failure carrying its message', async () => {
    discardDrafts.mockRejectedValue(new Error('Forbidden'));
    const props = renderPane('/ai/build/conv-1?package=app.hcpl', 'app.hcpl');
    await expect((props.onDiscardDrafts as (p: string) => Promise<unknown>)('app.hcpl')).resolves.toEqual({
      ok: false,
      error: 'Forbidden',
    });
  });

  it('CONTROL: with no adapter yet, no 撤销 is offered', () => {
    adapter = null;
    const props = renderPane('/ai/build/conv-1?package=app.hcpl', 'app.hcpl');
    expect(props.onDiscardDrafts).toBeUndefined();
    expect(typeof props.onReviewDrafts).toBe('function');
  });
});

describe('objectui#12725 — the chat column follows its slot', () => {
  it('the column that hosts the chat is bounded by its parent (`min-w-0`), not by its content', () => {
    renderPane('/studio/app.hcpl/interfaces', 'app.hcpl');
    const column = screen.getByTestId('ai-chat-panel').closest('[data-chat-column]');
    expect(column).not.toBeNull();
    expect(column!.className.split(/\s+/)).toContain('min-w-0');
  });
});
