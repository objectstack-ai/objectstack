/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3c follow-up — issue #2477 item 2: the Studio copilot's collapse is
 * remembered under a key SCOPED to Studio, so it never fights the console
 * dock's own state.
 *
 * objectui#12725 re-points this file. The copilot moved from the shared dock
 * chrome (`useChatDockState` with Studio's own keys, which this file pinned)
 * into the surface's right slot: the slot owns showing, hiding and the width,
 * and keeps its shown state under the same Studio key (pinned in
 * `StudioDesignSurface.rightSlot-12725.test.tsx`, beside the console key it
 * must not touch). What stays here is the copilot's side of that move:
 *  - it no longer drives the dock state hook at all, so the console dock's
 *    remembered expanded state and width are the console's alone;
 *  - it reports to the slot whether the catalog serves it, and nothing on unmount;
 *  - an empty catalog renders nothing.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChatDockOptions } from '../../../layout/ChatDock';
import {
  DOCK_EXPANDED_STORAGE_KEY,
  DOCK_STUDIO_EXPANDED_STORAGE_KEY,
  DOCK_WIDTH_STORAGE_KEY,
} from '../../../layout/chatDockState';

// Every option object anything hands to useChatDockState, in order.
const dockOptions: Array<ChatDockOptions | undefined> = [];

vi.mock('../../../layout/ChatDock', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useChatDockState: (options?: ChatDockOptions) => {
      dockOptions.push(options);
      return (actual.useChatDockState as (o?: ChatDockOptions) => unknown)(options);
    },
  };
});

const catalog = vi.hoisted(() => ({ agents: [{ name: 'build' }] as Array<{ name: string }> }));
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: catalog.agents, isLoading: false, error: null }),
}));
// Partial — the module also feeds the metadata client factory, which imports
// `createAuthenticatedFetch` from it at load time.
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
// The usage probe reads the network; it is the console's, unchanged here.
vi.mock('../../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: () => '/api/v1',
}));
vi.mock('../../../hooks/useChatConversation', () => ({
  useChatConversation: () => ({ conversationId: 'c1', initialMessages: [] }),
}));

import { StudioChatDock, type StudioCopilotStatus } from '../StudioAiCopilot';

beforeEach(() => {
  dockOptions.length = 0;
  catalog.agents = [{ name: 'build' }];
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function mountCopilot(onStatusChange: (s: StudioCopilotStatus) => void) {
  return render(
    <MemoryRouter>
      <StudioChatDock packageId="app.crm" onStatusChange={onStatusChange} />
    </MemoryRouter>,
  );
}

describe('StudioChatDock as the right slot\'s copilot (#2477 item 2, objectui#12725)', () => {
  it('drives no dock state: the console dock\'s remembered state and width stay the console\'s', () => {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '0');
    window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, '512');
    mountCopilot(() => {});
    expect(dockOptions).toEqual([]);
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBe('0');
    expect(window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY)).toBe('512');
    expect(window.sessionStorage.getItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY)).toBeNull();
  });

  it('reports itself available to the slot, and unavailable on unmount', () => {
    const reports: StudioCopilotStatus[] = [];
    const { unmount } = mountCopilot((s) => reports.push(s));
    expect(reports.at(-1)).toEqual({ available: true, planPending: false });
    expect(screen.getByTestId('studio-copilot-maximize')).toBeInTheDocument();
    unmount();
    expect(reports.at(-1)).toEqual({ available: false, planPending: false });
  });

  it('an empty catalog renders nothing and reports no copilot', () => {
    catalog.agents = [];
    const reports: StudioCopilotStatus[] = [];
    const { container } = mountCopilot((s) => reports.push(s));
    expect(container).toBeEmptyDOMElement();
    expect(reports.at(-1)).toEqual({ available: false, planPending: false });
  });
});
