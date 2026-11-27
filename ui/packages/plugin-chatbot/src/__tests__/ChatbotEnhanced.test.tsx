/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Smoke tests for the AI-Elements-composed ChatbotEnhanced. Heavier
 * interaction tests (streaming, tool-call rendering) live in the app-level
 * e2e suite — these only validate the public surface stays stable.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

describe('ChatbotEnhanced (AI Elements composition)', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the empty conversation state with suggestion chips', () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        suggestions={["Show me today's tasks", 'Summarise this account']}
        onSendMessage={onSendMessage}
      />
    );

    expect(screen.getByText(/Summarise this account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Show me today's tasks/i));
    expect(onSendMessage).toHaveBeenCalledWith("Show me today's tasks");
  });

  it('renders user and assistant messages', () => {
    const messages: ChatbotEnhancedMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello' },
      { id: 'a1', role: 'assistant', content: 'Hi! How can I help?' },
    ];
    render(<ChatbotEnhanced messages={messages} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText(/How can I help/i)).toBeInTheDocument();
  });


  // #2458 item 3 — while the ask agent is still deciding (no prose, no rendered
  // tool row yet), a mid-stream turn whose only text is the persisted
  // "(called …)" tool-call placeholder must show the LIVE thinking indicator,
  // not the static 执行过程 note (a hydrated-history affordance) or a blank bubble.
  it('shows live thinking dots — not the static activity note — for a mid-stream tool-call placeholder', () => {
    render(
      <ChatbotEnhanced
        isLoading
        labels={{ agentActivity: 'AGENT_ACTIVITY_NOTE' }}
        messages={[
          { id: 'u1', role: 'user', content: '帮我搭一个客户管理应用' },
          {
            id: 'a1',
            role: 'assistant',
            content: '(called suggest_builder)',
            streaming: true,
          },
        ]}
      />,
    );
    expect(screen.getByText(/Assistant is responding/i)).toBeInTheDocument();
    expect(screen.queryByText('AGENT_ACTIVITY_NOTE')).not.toBeInTheDocument();
  });

  // The static 执行过程 note is still the right thing once the turn has ENDED
  // (re-hydrated history): a tool-call-only turn shows the quiet activity note,
  // never leaks the internal placeholder as prose (#772 preserved).
  it('keeps the quiet activity note for a FINISHED tool-call placeholder turn (#772)', () => {
    render(
      <ChatbotEnhanced
        labels={{ agentActivity: 'AGENT_ACTIVITY_NOTE' }}
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            content: '(called suggest_builder)',
          },
        ]}
      />,
    );
    expect(screen.getByText('AGENT_ACTIVITY_NOTE')).toBeInTheDocument();
    expect(screen.queryByText('(called suggest_builder)')).not.toBeInTheDocument();
  });


  it('shows an error banner with a retry affordance', () => {
    const onReload = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[{ id: 'a1', role: 'assistant', content: 'oops' }]}
        error={new Error('network down')}
        onReload={onReload}
      />
    );
    expect(screen.getByText(/Response failed/i)).toBeInTheDocument();
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Retry/i));
    expect(onReload).toHaveBeenCalled();
  });

  it('shows an assistant thinking row while waiting for a response', () => {
    render(
      <ChatbotEnhanced
        messages={[{ id: 'u1', role: 'user', content: 'Find recent deals' }]}
        isLoading
      />
    );

    expect(screen.getByText('Find recent deals')).toBeInTheDocument();
    expect(screen.getByText(/Assistant is responding/i)).toBeInTheDocument();
  });

  // issue #432: the count-up timer must be visible from the first second (not
  // only once the server starts streaming), so a turn never looks frozen.
  it('shows a live elapsed timer in the thinking row from the start', () => {
    const { container } = render(
      <ChatbotEnhanced messages={[{ id: 'u1', role: 'user', content: 'hi' }]} isLoading />,
    );
    const liveness = container.querySelector('[data-liveness-tier]');
    expect(liveness).not.toBeNull();
    expect(liveness).toHaveAttribute('data-liveness-tier', 'waiting');
    expect(liveness?.textContent).toContain('0:00');
  });

  // issue #432: a real network drop surfaces immediately as an "offline" state,
  // not a silent wait until the stream-quiet timeout.
  it('surfaces an offline state when the browser reports no network', () => {
    const orig = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      const { container } = render(
        <ChatbotEnhanced
          messages={[{ id: 'u1', role: 'user', content: 'hi' }]}
          isLoading
          labels={{ connectionOfflineLabel: 'OFFLINE_BADGE' }}
        />,
      );
      expect(container.querySelector('[data-liveness-tier]')).toHaveAttribute(
        'data-liveness-tier',
        'offline',
      );
      expect(screen.getByText(/OFFLINE_BADGE/)).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: orig });
    }
  });

  // issue #432: a running tool (e.g. "Propose blueprint · Running") shows a live
  // elapsed timer instead of a static "Running", so a long blueprint call has a
  // visible countdown.
  it('shows a live elapsed timer for a running tool in the activity summary', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={[
          { id: 'u1', role: 'user', content: 'build me a CRM' },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            streaming: true,
            toolInvocations: [
              { toolCallId: 't1', toolName: 'propose_blueprint', state: 'input-available' },
            ],
          },
        ]}
      />,
    );
    const timer = container.querySelector('[data-tool-running-timer]');
    expect(timer).not.toBeNull();
    expect(timer?.textContent).toContain('0:00');
  });

  it('renders thinking dots inside an empty streaming assistant message', () => {
    render(
      <ChatbotEnhanced
        messages={[
          { id: 'u1', role: 'user', content: 'Find recent deals' },
          { id: 'a1', role: 'assistant', content: '', streaming: true },
        ]}
        isLoading
      />
    );

    expect(screen.getByText(/Assistant is responding/i)).toBeInTheDocument();
    expect(screen.queryByText('Copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Regenerate')).not.toBeInTheDocument();
  });

  it('turns the submit control into a stop control while streaming', () => {
    const onStop = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[{ id: 'u1', role: 'user', content: 'Find recent deals' }]}
        isLoading
        onStop={onStop}
      />
    );

    expect(screen.queryByLabelText('Submit')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Stop response'));
    expect(onStop).toHaveBeenCalled();
  });

  it('exposes a copy action on assistant messages', () => {
    render(
      <ChatbotEnhanced
        messages={[{ id: 'a1', role: 'assistant', content: 'copy me' }]}
      />
    );
    const copyBtn = screen.getByText('Copy').closest('button')!;
    fireEvent.click(copyBtn);
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'copy me'
    );
  });

  it('summarizes tool invocations and hides reasoning by default', () => {
    render(
      <ChatbotEnhanced
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            content: 'Found 3 deals.',
            reasoning: 'Picked the query_data tool because the user asked for deals.',
            toolInvocations: [
              {
                toolCallId: 'tc1',
                toolName: 'query_data',
                args: { objectName: 'deal', limit: 3 },
                result: { count: 3 },
                state: 'output-available',
              },
            ],
            sources: [
              { id: 's1', title: 'CRM docs', url: 'https://docs.example.com/crm' },
            ],
          },
        ]}
      />
    );
    expect(screen.queryByText(/Agent activity/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Query data/i)).toBeInTheDocument();
    expect(screen.getByText(/Completed/i)).toBeInTheDocument();
    expect(screen.queryByText(/query_data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Picked the query_data tool/i)).not.toBeInTheDocument();
    // Sources trigger renders count
    expect(screen.getByText(/Used 1 sources/i)).toBeInTheDocument();
  });

  it('renders raw tool invocations and reasoning in debug mode', () => {
    render(
      <ChatbotEnhanced
        processVisibility="debug"
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            content: 'Found 3 deals.',
            reasoning: 'Picked the query_data tool because the user asked for deals.',
            toolInvocations: [
              {
                toolCallId: 'tc1',
                toolName: 'query_data',
                args: { objectName: 'deal', limit: 3 },
                result: { count: 3 },
                state: 'output-available',
              },
            ],
          },
        ]}
      />
    );
    expect(screen.getAllByText(/query_data/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Completed/i)).toBeInTheDocument();
    expect(screen.getByText(/Picked the query_data tool/i)).toBeInTheDocument();
  });

  it('renders a model picker and forwards changes', async () => {
    const onModelChange = vi.fn();
    render(
      <ChatbotEnhanced
        models={[
          { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai' },
          { id: 'claude-3-5-sonnet', label: 'Claude 3.5', provider: 'anthropic' },
        ]}
        selectedModelId="gpt-4o-mini"
        onModelChange={onModelChange}
      />
    );
    // The shared `Select` (objectui#11865), still named by its aria-label.
    const picker = screen.getByLabelText(/Model/i);
    expect(picker).toHaveAttribute('role', 'combobox');
    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Claude 3.5 · anthropic' }));
    expect(onModelChange).toHaveBeenCalledWith('claude-3-5-sonnet');
  });

  it('hides the model picker when only one model is offered (no real choice)', () => {
    // Free / single-model envs return one model — a dropdown with a single
    // option is pure noise. The lone model is still sent via selectedModelId.
    render(
      <ChatbotEnhanced
        models={[{ id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai' }]}
        selectedModelId="gpt-4o-mini"
        onModelChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/Model/i)).toBeNull();
  });
});

describe('ChatbotEnhanced — activity-driven liveness (not a fake clock)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('pre-first-token turn shows a neutral "waiting" WITH a live timer, not a fake "receiving"', () => {
    const { container } = render(<ChatbotEnhanced isLoading messages={[]} />);
    // Honest: the tier is the muted "waiting", never the emerald "receiving"
    // that would imply data is already flowing…
    expect(container.querySelector('[data-liveness-tier]')).toHaveAttribute(
      'data-liveness-tier',
      'waiting',
    );
    expect(screen.getByText(/Waiting for server/i)).toBeInTheDocument();
    // …but the count-up timer is now visible from the first second (issue #432),
    // so the turn never looks frozen.
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('escalates to an amber "still working" + elapsed timer once the stream is genuinely quiet', () => {
    const { container } = render(<ChatbotEnhanced isLoading messages={[]} />);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    const liveness = container.querySelector('[data-liveness-tier]');
    expect(liveness).toHaveAttribute('data-liveness-tier', 'stalled');
    expect(screen.getByText(/Still working/i)).toBeInTheDocument();
    // The seconds-since-last-byte stay available on the hover title.
    expect(liveness?.getAttribute('title')).toMatch(/7s with no response/);
  });
});
