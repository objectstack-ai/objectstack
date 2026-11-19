/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3c — ChatDockPanel chrome contract: the `children` body override,
 * and the collapse button still driving the dock state.
 *
 * objectstack#34608 (ui ADR-0057 as amended) — the drawer is the assistant's
 * only container: its expand button fills the window IN PLACE (the same aside,
 * no navigation; acceptance 2 of the card) and the same button restores it;
 * the rail keeps the conversation history behind a History button, the full
 * window draws it as a column beside the chat. The phone sheet already takes
 * the screen, so it has no expand button, only History.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ChatDockPanel, ChatDockMobileSheet, useChatDockState, type ChatDockState } from '../ChatDock';

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
// The default body, as a recorder of the presentation and history state the
// chrome hands it (its own behaviour is pinned in the ChatDock.* body files).
vi.mock('../ChatDockConversation', () => ({
  ChatDockConversation: (props: { presentation?: string; historyOpen?: boolean }) => (
    <div
      data-testid="default-dock-body"
      data-presentation={props.presentation}
      data-history-open={String(Boolean(props.historyOpen))}
    />
  ),
}));

function dockState(overrides: Partial<ChatDockState> = {}): ChatDockState {
  return {
    expanded: true,
    width: 420,
    dragging: false,
    fullWindow: false,
    setFullWindow: vi.fn(),
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
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

  it('the expand button asks the dock to fill the window; filled, the same button restores it', () => {
    const dock = dockState();
    const { rerender } = render(
      <ChatDockPanel dock={dock}>
        <div />
      </ChatDockPanel>,
    );
    const button = screen.getByTestId('chat-dock-maximize');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAccessibleName('Expand');
    expect(screen.getByTestId('chat-dock-panel')).not.toHaveAttribute('data-full-window');
    fireEvent.click(button);
    expect(dock.setFullWindow).toHaveBeenCalledWith(true);

    const full = dockState({ fullWindow: true });
    rerender(
      <ChatDockPanel dock={full}>
        <div />
      </ChatDockPanel>,
    );
    const panel = screen.getByTestId('chat-dock-panel');
    expect(panel).toHaveAttribute('data-full-window', 'true');
    expect(panel.className).toContain('fixed');
    expect(panel.className).toContain('inset-0');
    // No resize handle on a window-filling panel.
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    const restore = screen.getByTestId('chat-dock-maximize');
    expect(restore).toHaveAttribute('aria-pressed', 'true');
    expect(restore).toHaveAccessibleName('Restore side panel');
    fireEvent.click(restore);
    expect(full.setFullWindow).toHaveBeenCalledWith(false);
  });

  it('the rail shows History behind a button; the full window shows it as a column (no button)', async () => {
    const { rerender } = render(<ChatDockPanel dock={dockState()} />);
    const body = await screen.findByTestId('default-dock-body');
    expect(body).toHaveAttribute('data-presentation', 'rail');
    expect(body).toHaveAttribute('data-history-open', 'false');
    const history = screen.getByTestId('chat-dock-history-toggle');
    expect(history).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(history);
    expect(screen.getByTestId('default-dock-body')).toHaveAttribute('data-history-open', 'true');
    expect(history).toHaveAttribute('aria-pressed', 'true');

    rerender(<ChatDockPanel dock={dockState({ fullWindow: true })} />);
    expect(screen.getByTestId('default-dock-body')).toHaveAttribute('data-presentation', 'full');
    expect(screen.queryByTestId('chat-dock-history-toggle')).not.toBeInTheDocument();
  });

  it('the same aside element switches to full window — the conversation is not remounted', async () => {
    function Host() {
      const dock = useChatDockState();
      return <ChatDockPanel dock={dock} />;
    }
    render(<Host />);
    const before = await screen.findByTestId('default-dock-body');
    const aside = screen.getByTestId('chat-dock-panel');
    fireEvent.click(screen.getByTestId('chat-dock-maximize'));
    expect(screen.getByTestId('chat-dock-panel')).toBe(aside);
    expect(aside).toHaveAttribute('data-full-window', 'true');
    expect(screen.getByTestId('default-dock-body')).toBe(before);
    fireEvent.click(screen.getByTestId('chat-dock-maximize'));
    expect(aside).not.toHaveAttribute('data-full-window');
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
    // The built-in close ✕ / Escape drives onOpenChange(false).
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('has no expand button, and its History button opens the history inside the sheet', async () => {
    render(<ChatDockMobileSheet open onOpenChange={() => {}} />);
    const body = await screen.findByTestId('default-dock-body');
    expect(body).toHaveAttribute('data-presentation', 'sheet');
    expect(screen.queryByTestId('chat-dock-maximize')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-dock-mobile-history-toggle'));
    expect(screen.getByTestId('default-dock-body')).toHaveAttribute('data-history-open', 'true');
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

describe('useChatDockState — full window (objectstack#34608)', () => {
  function Probe({ onState }: { onState: (s: ChatDockState) => void }) {
    onState(useChatDockState({ persistFullWindow: true }));
    return null;
  }

  it('filling the window opens the drawer; closing or toggling it off leaves full window', () => {
    window.sessionStorage.clear();
    let state!: ChatDockState;
    render(<Probe onState={(s) => (state = s)} />);
    expect(state.expanded).toBe(false);
    expect(state.fullWindow).toBe(false);

    act(() => state.setFullWindow(true));
    expect(state.expanded).toBe(true);
    expect(state.fullWindow).toBe(true);

    act(() => state.collapse());
    expect(state.expanded).toBe(false);
    expect(state.fullWindow).toBe(false);

    act(() => state.setFullWindow(true));
    act(() => state.toggle());
    expect(state.expanded).toBe(false);
    expect(state.fullWindow).toBe(false);
  });

  it('persists per tab, so an old full-page link can arm it before the layout mounts', () => {
    window.sessionStorage.clear();
    let state!: ChatDockState;
    const first = render(<Probe onState={(s) => (state = s)} />);
    act(() => state.setFullWindow(true));
    first.unmount();
    render(<Probe onState={(s) => (state = s)} />);
    expect(state.fullWindow).toBe(true);
    window.sessionStorage.clear();
  });
});
