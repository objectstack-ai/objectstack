/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3c — ChatDockPanel chrome contract: the `children` body override
 * (the Studio dock's seam), the maximize button rendered only when a target is
 * provided, and the collapse button still driving the dock state.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatDockPanel, ChatDockMobileSheet, type ChatDockState } from '../ChatDock';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

// The default body (ChatDockConversation) drags in the whole chat graph
// (plugin-chatbot, hooks, AiChatPage) — irrelevant to the chrome under test,
// and every case here overrides the body via `children` anyway.
vi.mock('../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: (explicit?: string) => explicit ?? '/api/v1/ai',
}));
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [], isLoading: false, error: undefined }),
}));
vi.mock('../../hooks', () => ({
  useChatConversation: () => ({ conversationId: undefined, initialMessages: [] }),
}));
// The header usage indicator has its own tests; stub it so these chrome tests
// stay focused and don't hit the usage endpoint.
vi.mock('../AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));

function dockState(overrides: Partial<ChatDockState> = {}): ChatDockState {
  return {
    expanded: true,
    width: 420,
    dragging: false,
    maximized: false,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    onResizePointerDown: vi.fn(),
    ...overrides,
  };
}

describe('ChatDockPanel', () => {
  it('renders the children body override instead of the default conversation', () => {
    render(
      <ChatDockPanel dock={dockState()}>
        <div data-testid="studio-dock-body" />
      </ChatDockPanel>,
    );
    expect(screen.getByTestId('studio-dock-body')).toBeInTheDocument();
  });

  it('shows the maximize button only when onMaximize is provided, and fires it', () => {
    const { rerender } = render(
      <ChatDockPanel dock={dockState()}>
        <div />
      </ChatDockPanel>,
    );
    expect(screen.queryByTestId('chat-dock-maximize')).not.toBeInTheDocument();

    const onMaximize = vi.fn();
    rerender(
      <ChatDockPanel dock={dockState()} onMaximize={onMaximize}>
        <div />
      </ChatDockPanel>,
    );
    fireEvent.click(screen.getByTestId('chat-dock-maximize'));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it('renders the title override and keeps collapse wired to the dock state', () => {
    const dock = dockState();
    render(
      <ChatDockPanel dock={dock} title="AI copilot">
        <div />
      </ChatDockPanel>,
    );
    expect(screen.getByText('AI copilot')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-dock-collapse'));
    expect(dock.collapse).toHaveBeenCalledTimes(1);
  });
});

describe('ChatDockMobileSheet', () => {
  it('renders the children body when open and closes via onOpenChange', () => {
    const onOpenChange = vi.fn();
    render(
      <ChatDockMobileSheet open onOpenChange={onOpenChange}>
        <div data-testid="mobile-dock-body" />
      </ChatDockMobileSheet>,
    );
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-dock-body')).toBeInTheDocument();
    // No maximize button unless a target is wired.
    expect(screen.queryByTestId('chat-dock-mobile-maximize')).not.toBeInTheDocument();
    // The built-in close ✕ / Escape drives onOpenChange(false).
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('maximize CLOSES first and only navigates once the sheet has shut (deferred bridge)', () => {
    const onOpenChange = vi.fn();
    const onMaximize = vi.fn();
    const { rerender } = render(
      <ChatDockMobileSheet open onOpenChange={onOpenChange} onMaximize={onMaximize}>
        <div />
      </ChatDockMobileSheet>,
    );
    // Clicking maximize must NOT navigate yet — navigating from an open Radix
    // sheet leaks its scroll-lock/overlay onto the destination. It only closes.
    fireEvent.click(screen.getByTestId('chat-dock-mobile-maximize'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onMaximize).not.toHaveBeenCalled();
    // The controlled parent honors the close → `open` flips false → NOW the
    // deferred effect fires the navigation, with the sheet already unmounted.
    rerender(
      <ChatDockMobileSheet open={false} onOpenChange={onOpenChange} onMaximize={onMaximize}>
        <div />
      </ChatDockMobileSheet>,
    );
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it('a normal close (no maximize) never navigates', () => {
    const onMaximize = vi.fn();
    const { rerender } = render(
      <ChatDockMobileSheet open onOpenChange={() => {}} onMaximize={onMaximize}>
        <div />
      </ChatDockMobileSheet>,
    );
    rerender(
      <ChatDockMobileSheet open={false} onOpenChange={() => {}} onMaximize={onMaximize}>
        <div />
      </ChatDockMobileSheet>,
    );
    expect(onMaximize).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    render(
      <ChatDockMobileSheet open={false} onOpenChange={() => {}}>
        <div data-testid="mobile-dock-body" />
      </ChatDockMobileSheet>,
    );
    expect(screen.queryByTestId('mobile-dock-body')).not.toBeInTheDocument();
  });
});
