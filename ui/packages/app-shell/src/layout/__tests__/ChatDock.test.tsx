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
 *
 * objectstack#35445 — the title bar is ONE row: History, 「···」 and the
 * drawer's 「×」 close. Usage, Share, filling the window and the Build Doctor
 * are items of the 「···」 menu; the Build Doctor is listed only when the body
 * reports it (a user who may build).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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
// The usage reading the 「···」 menu shows: the hook stands in for the endpoint.
const usageState = { usage: null as null | { pool: Record<string, unknown> } };
vi.mock('../../hooks/useAiUsage', () => ({
  useAiUsage: () => ({ usage: usageState.usage, isLoading: false, error: undefined, refetch: () => {} }),
}));
// What the default body reports to the chrome (objectstack#35445); `undefined`
// = a body that reports nothing.
const bodyState = {
  actions: undefined as undefined | { conversationId?: string; showDebug: boolean },
};
// The default body, as a recorder of the presentation, history and dialog
// state the chrome hands it (its own behaviour is pinned in the ChatDock.*
// body files).
vi.mock('../ChatDockConversation', async () => {
  const ReactActual = await import('react');
  return {
    ChatDockConversation: (props: {
      presentation?: string;
      historyOpen?: boolean;
      shareOpen?: boolean;
      debugOpen?: boolean;
      onActionsChange?: (a: unknown) => void;
    }) => {
      const { onActionsChange } = props;
      ReactActual.useEffect(() => {
        onActionsChange?.(bodyState.actions);
      }, [onActionsChange]);
      return (
        <div
          data-testid="default-dock-body"
          data-presentation={props.presentation}
          data-history-open={String(Boolean(props.historyOpen))}
          data-share-open={String(Boolean(props.shareOpen))}
          data-debug-open={String(Boolean(props.debugOpen))}
        />
      );
    },
  };
});

/** Open the drawer's 「···」 menu and return its items' visible names. */
function openMenu(): HTMLElement {
  const trigger = screen.getByTestId('chat-dock-more');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.getByTestId('chat-dock-menu');
}

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

  it('the menu\'s expand item asks the dock to fill the window; filled, the same item restores it', () => {
    const dock = dockState();
    const { rerender } = render(
      <ChatDockPanel dock={dock}>
        <div />
      </ChatDockPanel>,
    );
    openMenu();
    const button = screen.getByTestId('chat-dock-maximize');
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
    openMenu();
    const restore = screen.getByTestId('chat-dock-maximize');
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
    openMenu();
    fireEvent.click(screen.getByTestId('chat-dock-maximize'));
    expect(screen.getByTestId('chat-dock-panel')).toBe(aside);
    expect(aside).toHaveAttribute('data-full-window', 'true');
    expect(screen.getByTestId('default-dock-body')).toBe(before);
    openMenu();
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

describe('the drawer title bar is one row: History, 「···」, Close (objectstack#35445)', () => {
  afterEach(() => {
    bodyState.actions = undefined;
    usageState.usage = null;
  });

  /** The header's own controls, by accessible name, in order. */
  function headerControls(): string[] {
    const header = screen.getByTestId('chat-dock-header');
    return Array.from(header.querySelectorAll('button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent ?? '',
    );
  }

  it('the rail draws History, 「···」 and Close, and nothing else; Close is the drawer 「×」 that keeps the thread', async () => {
    bodyState.actions = { conversationId: 'c1', showDebug: true };
    usageState.usage = { pool: { fraction: 0.3, unmetered: false, upgrade: false, topUp: false } };
    const dock = dockState();
    render(<ChatDockPanel dock={dock} />);
    await screen.findByTestId('default-dock-body');
    expect(headerControls()).toEqual(['History', 'More actions', 'Close']);
    // Usage, share, fill and the doctor are not header controls.
    expect(screen.queryByTestId('ai-usage-indicator')).toBeNull();
    expect(screen.queryByTestId('chat-dock-share')).toBeNull();
    expect(screen.queryByTestId('chat-dock-maximize')).toBeNull();
    expect(screen.queryByTestId('chat-dock-build-doctor')).toBeNull();
    const close = screen.getByTestId('chat-dock-collapse');
    expect(close).toHaveAccessibleName('Close');
    expect(close.querySelector('svg.lucide-x')).not.toBeNull();
    fireEvent.click(close);
    expect(dock.collapse).toHaveBeenCalledTimes(1);
  });

  it('filled, the bar is 「···」 and the same 「×」 Close (history sits beside the chat)', async () => {
    render(<ChatDockPanel dock={dockState({ fullWindow: true })} />);
    await screen.findByTestId('default-dock-body');
    expect(headerControls()).toEqual(['More actions', 'Close']);
    expect(screen.getByTestId('chat-dock-collapse').querySelector('svg.lucide-x')).not.toBeNull();
  });

  it('the menu holds usage, Share, Expand and the Build Doctor, and opens the body\'s dialogs', async () => {
    bodyState.actions = { conversationId: 'c1', showDebug: true };
    usageState.usage = { pool: { fraction: 0.3, unmetered: false, upgrade: false, topUp: false } };
    render(<ChatDockPanel dock={dockState()} />);
    await screen.findByTestId('default-dock-body');
    const menu = openMenu();
    expect(within(menu).getByTestId('chat-dock-usage')).toHaveTextContent('AI usage');
    expect(within(menu).getByTestId('chat-dock-usage')).toHaveTextContent('Plenty left');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Share',
      'Expand',
      'Build Doctor',
    ]);
    fireEvent.click(within(menu).getByTestId('chat-dock-share'));
    expect(screen.getByTestId('default-dock-body')).toHaveAttribute('data-share-open', 'true');
    fireEvent.click(within(openMenu()).getByTestId('chat-dock-build-doctor'));
    expect(screen.getByTestId('default-dock-body')).toHaveAttribute('data-debug-open', 'true');
  });

  it('the Build Doctor is not listed when the body withholds it (a user who may not build)', async () => {
    bodyState.actions = { conversationId: 'c1', showDebug: false };
    render(<ChatDockPanel dock={dockState()} />);
    await screen.findByTestId('default-dock-body');
    const menu = openMenu();
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Share', 'Expand']);
    expect(within(menu).queryByTestId('chat-dock-build-doctor')).toBeNull();
  });

  it('a pool running low marks the 「···」 trigger, so the warning is seen with the menu closed', async () => {
    usageState.usage = { pool: { fraction: 0.9, unmetered: false, upgrade: false, topUp: false } };
    render(<ChatDockPanel dock={dockState()} />);
    await screen.findByTestId('default-dock-body');
    expect(screen.getByTestId('chat-dock-more-usage-alert')).toBeInTheDocument();
    expect(within(openMenu()).getByTestId('chat-dock-usage')).toHaveTextContent('Running low');
  });

  it('CONTROL: a pool with room left puts no marker on the trigger', async () => {
    usageState.usage = { pool: { fraction: 0.3, unmetered: false, upgrade: false, topUp: false } };
    render(<ChatDockPanel dock={dockState()} />);
    await screen.findByTestId('default-dock-body');
    expect(screen.queryByTestId('chat-dock-more-usage-alert')).toBeNull();
  });

  it('the phone sheet: History and 「···」 beside the title, no fill item', async () => {
    bodyState.actions = { conversationId: 'c1', showDebug: false };
    render(<ChatDockMobileSheet open onOpenChange={() => {}} />);
    await screen.findByTestId('default-dock-body');
    const menu = openMenu();
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Share']);
    expect(screen.queryByTestId('ai-usage-indicator')).toBeNull();
  });
});
