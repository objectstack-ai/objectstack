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
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  ChatbotEnhanced,
  classifyAssumptions,
  selectDesignHintIndex,
  type ChatbotEnhancedMessage,
} from '../ChatbotEnhanced';

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

  it('renders the pre-build "Proposed plan" card instead of collapsing the propose tool into a chip', () => {
    // Regression: a propose_blueprint tool carries `proposedPlan` but no
    // draftReview — it must route to the DETAILED tool body (where the card
    // lives), not the summary chip strip, or the confirm-gate card never shows.
    const messages: ChatbotEnhancedMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolInvocations: [
          {
            toolCallId: 't1',
            toolName: 'propose_blueprint',
            state: 'output-available',
            proposedPlan: {
              summary: 'A reading list',
              objects: [{ name: 'book', label: 'Book', fieldCount: 2 }],
              counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
              questions: ['Track loans separately?'],
              assumptions: ['One shelf for now'],
            },
          },
        ],
      },
    ];
    render(<ChatbotEnhanced messages={messages} />);
    expect(screen.getByTestId('proposed-plan')).toBeInTheDocument();
    expect(screen.getByText('Proposed plan')).toBeInTheDocument();
    expect(screen.getByText(/A reading list/)).toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-questions')).toBeInTheDocument();
    expect(screen.getByText(/Track loans separately/)).toBeInTheDocument();
  });

  it('renders the "Open in Builder →" handoff card and fires onOpenBuilder (ADR-0057 P4)', () => {
    const onOpenBuilder = vi.fn();
    const messages: ChatbotEnhancedMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolInvocations: [
          {
            toolCallId: 't1',
            toolName: 'suggest_builder',
            state: 'output-available',
            builderHandoff: { prompt: 'Add a priority field to tasks', packageId: 'com.acme.crm' },
          },
        ],
      },
    ];
    render(<ChatbotEnhanced messages={messages} onOpenBuilder={onOpenBuilder} />);
    expect(screen.getByTestId('builder-handoff')).toBeInTheDocument();
    expect(screen.getByText(/Add a priority field to tasks/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('builder-handoff-open'));
    expect(onOpenBuilder).toHaveBeenCalledWith({
      prompt: 'Add a priority field to tasks',
      packageId: 'com.acme.crm',
    });
  });

  it('keeps only the LATEST handoff card actionable; older ones are superseded/inert (#2458 UX#5)', () => {
    const onOpenBuilder = vi.fn();
    const messages: ChatbotEnhancedMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolInvocations: [
          { toolCallId: 't1', toolName: 'suggest_builder', state: 'output-available', builderHandoff: { prompt: 'first request' } },
        ],
      },
      {
        id: 'a2',
        role: 'assistant',
        content: '',
        toolInvocations: [
          { toolCallId: 't2', toolName: 'suggest_builder', state: 'output-available', builderHandoff: { prompt: 'second request' } },
        ],
      },
    ];
    render(<ChatbotEnhanced messages={messages} onOpenBuilder={onOpenBuilder} />);
    // The older card (t1) is inert; the latest (t2) is actionable.
    const superseded = screen.getByTestId('builder-handoff-superseded');
    expect(superseded).toBeDisabled();
    const actionable = screen.getByTestId('builder-handoff-open');
    fireEvent.click(actionable);
    expect(onOpenBuilder).toHaveBeenCalledWith({ prompt: 'second request' });
    // Clicking the superseded one does nothing (disabled).
    fireEvent.click(superseded);
    expect(onOpenBuilder).toHaveBeenCalledTimes(1);
  });

  it('disables "Open in Builder" when no host wired onOpenBuilder', () => {
    const messages: ChatbotEnhancedMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolInvocations: [
          { toolCallId: 't1', toolName: 'suggest_builder', state: 'output-available', builderHandoff: { prompt: 'x' } },
        ],
      },
    ];
    render(<ChatbotEnhanced messages={messages} />);
    expect(screen.getByTestId('builder-handoff-open')).toBeDisabled();
  });

  // #2458 item 3 — the ask-decline handoff card is the actionable payload; it
  // must surface the moment `suggest_builder` reaches `output-available`, while
  // the turn is STILL streaming and the trailing one-line prose hasn't arrived
  // (content still empty). We must not withhold it until the text part finishes.
  it('renders the handoff card at output-available while still streaming, before prose arrives (#2458)', () => {
    const onOpenBuilder = vi.fn();
    const messages: ChatbotEnhancedMessage[] = [
      { id: 'u1', role: 'user', content: '帮我搭一个客户管理应用' },
      {
        id: 'a1',
        role: 'assistant',
        content: '', // no prose yet — the sentence streams in AFTER the card
        streaming: true,
        toolInvocations: [
          {
            toolCallId: 't1',
            toolName: 'suggest_builder',
            state: 'output-available',
            builderHandoff: { prompt: '客户管理应用', packageId: 'com.acme.crm' },
          },
        ],
      },
    ];
    render(<ChatbotEnhanced messages={messages} isLoading onOpenBuilder={onOpenBuilder} />);
    // The actionable card is present and live despite the unfinished stream.
    expect(screen.getByTestId('builder-handoff')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('builder-handoff-open'));
    expect(onOpenBuilder).toHaveBeenCalledWith({
      prompt: '客户管理应用',
      packageId: 'com.acme.crm',
    });
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

  const planMessage = (questions: string[]): ChatbotEnhancedMessage[] => [
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'propose_blueprint',
          state: 'output-available',
          proposedPlan: {
            summary: 'A reading list',
            objects: [{ name: 'book', label: 'Book', fieldCount: 2 }],
            counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
            questions,
            assumptions: ['One shelf for now'],
          },
        },
      ],
    },
  ];

  it('"Build it" on a plan with open questions approves with the accept-defaults message', () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        messages={planMessage(['Track loans separately?'])}
        onSendMessage={onSendMessage}
        planApproveMessage="APPROVE_PLAIN"
        planApproveDefaultsMessage="APPROVE_DEFAULTS"
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    // Open questions → the click must authorize defaults, not silently drop them.
    expect(onSendMessage).toHaveBeenCalledWith('APPROVE_DEFAULTS');
  });

  it('"Build it" on a plan with no open questions approves with the plain message', () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        messages={planMessage([])}
        onSendMessage={onSendMessage}
        planApproveMessage="APPROVE_PLAIN"
        planApproveDefaultsMessage="APPROVE_DEFAULTS"
      />,
    );
    expect(screen.queryByTestId('proposed-plan-questions')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    expect(onSendMessage).toHaveBeenCalledWith('APPROVE_PLAIN');
  });

  it('flips the clicked card to a "Building…" badge immediately (#2627)', () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        messages={planMessage([])}
        onSendMessage={onSendMessage}
        planBuildingLabel="BUILDING_NOW"
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    // The approval's chat-level effects land at the bottom of the thread —
    // the card ITSELF must show the state change or the click reads as lost.
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-building')).toHaveTextContent('BUILDING_NOW');
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static hint (no action buttons) when message sending is not wired', () => {
    render(<ChatbotEnhanced messages={planMessage([])} planApproveHintLabel="HINT_TEXT" />);
    expect(screen.queryByTestId('proposed-plan-actions')).not.toBeInTheDocument();
    expect(screen.getByText('HINT_TEXT')).toBeInTheDocument();
  });

  // issue #432: once the plan's build has run, re-clicking "Build it" rebuilt
  // the whole app. The card must collapse to an inert "Built" badge.
  const planThenBuild: ChatbotEnhancedMessage[] = [
    ...planMessage([]),
    {
      id: 'a2',
      role: 'assistant',
      content: '',
      toolInvocations: [
        { toolCallId: 't2', toolName: 'apply_blueprint', state: 'output-available' },
      ],
    },
  ];

  it('collapses the plan actions to an inert "Built" badge once apply_blueprint has run', () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced messages={planThenBuild} onSendMessage={onSendMessage} planBuiltLabel="BUILT_BADGE" />,
    );
    // No live "Build it" button to re-trigger the build.
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-built')).toBeInTheDocument();
    expect(screen.getByText('BUILT_BADGE')).toBeInTheDocument();
  });

  it('keeps the "Build it" button active for a plan that has NOT been built yet', () => {
    render(<ChatbotEnhanced messages={planMessage([])} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-built')).not.toBeInTheDocument();
  });

  const Q_INTERVIEW = 'Track interviews as a separate object or a stage field?';
  const planWithChoices: ChatbotEnhancedMessage[] = [
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'propose_blueprint',
          state: 'output-available',
          proposedPlan: {
            summary: 'A recruiting app',
            objects: [{ name: 'candidate', label: 'Candidate', fieldCount: 3 }],
            counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
            questions: [Q_INTERVIEW],
            questionChoices: [{ text: Q_INTERVIEW, options: ['Separate object', 'Stage field'] }],
            assumptions: [],
          },
        },
      ],
    },
  ];

  it('renders one-click answer chips for a question that has choices, and sends the answer on click', () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        messages={planWithChoices}
        onSendMessage={onSendMessage}
        planAnswerMessage={(q, o) => `ANSWER:${q}=${o}`}
      />,
    );
    expect(screen.getByTestId('proposed-plan-choice')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Stage field'));
    expect(onSendMessage).toHaveBeenCalledWith(`ANSWER:${Q_INTERVIEW}=Stage field`);
  });

  it('renders plain questions with NO chips when there are no matching choices', () => {
    render(<ChatbotEnhanced messages={planMessage(['Some open-ended question?'])} onSendMessage={vi.fn()} />);
    expect(screen.getByText(/Some open-ended question/)).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-choice')).not.toBeInTheDocument();
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

  it('hides raw tool JSON for drafting tools in summary mode but keeps the Review affordance', () => {
    const draftTool: ChatbotEnhancedMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'Built your sales CRM.',
      toolInvocations: [
        {
          toolCallId: 'tc1',
          toolName: 'apply_blueprint',
          state: 'output-available',
          args: { blueprint: { summary: 'sales', objects: [{ name: 'opportunity_secret_field' }] } },
          result: { status: 'drafted', drafted: [{ type: 'object', name: 'opportunity' }] },
          draftReview: { items: [{ type: 'object', name: 'opportunity' }], summary: 'drafted 1 artifact(s)' },
        },
      ],
    };
    const onReviewDraft = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={[draftTool]} onReviewDraft={onReviewDraft} />,
    );
    // Consumer surface (summary): the friendly card + Review affordance render,
    // but the raw blueprint PARAMETERS / drafted RESULT JSON stay hidden.
    expect(screen.getByText(/Apply blueprint/i)).toBeInTheDocument();
    expect(screen.queryByText('Parameters')).not.toBeInTheDocument();
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
    expect(screen.queryByText(/opportunity_secret_field/)).not.toBeInTheDocument();
    expect(screen.getByText(/Review/i)).toBeInTheDocument();

    // Developer surface (debug): the raw PARAMETERS JSON is revealed.
    rerender(<ChatbotEnhanced processVisibility="debug" messages={[draftTool]} onReviewDraft={onReviewDraft} />);
    expect(screen.getByText('Parameters')).toBeInTheDocument();
  });

  it('#2493 — the draft-review summary can truncate (min-w-0) and its action row wraps, so it does not overflow on mobile', () => {
    const longSummary =
      'built 5 artifact(s) — live in your new app, grouped under app.pi8e — objects, views and a task board, all wired and ready to publish';
    const draftTool: ChatbotEnhancedMessage = {
      id: 'ov1',
      role: 'assistant',
      content: 'Built your app.',
      toolInvocations: [
        {
          toolCallId: 'tc-ov',
          toolName: 'apply_blueprint',
          state: 'output-available',
          result: { status: 'drafted', drafted: [{ type: 'app', name: 'todo_app' }] },
          draftReview: {
            items: [{ type: 'app', name: 'todo_app' }],
            packageId: 'app.pi8e',
            summary: longSummary,
          },
        },
      ],
    };
    render(<ChatbotEnhanced messages={[draftTool]} onReviewDraft={vi.fn()} />);
    const summary = screen.getByText(longSummary);
    // The summary is a flex child that must be shrinkable + clipped, or its
    // nowrap text expands the chat column past a phone viewport (the bug).
    expect(summary).toHaveClass('truncate');
    expect(summary).toHaveClass('min-w-0');
    // And the action row wraps so its buttons never force horizontal scroll.
    const row = summary.closest('div');
    expect(row?.className).toContain('flex-wrap');
  });

  it('expands the verification chip into the actual lint findings (ADR-0038 L1)', () => {
    const issueTool: ChatbotEnhancedMessage = {
      id: 'a2',
      role: 'assistant',
      content: 'Drafted your app.',
      toolInvocations: [
        {
          toolCallId: 'tc2',
          toolName: 'create_metadata',
          state: 'output-available',
          args: {},
          result: { status: 'drafted', type: 'object', name: 'book' },
          draftReview: {
            items: [{ type: 'object', name: 'book' }],
            summary: 'Drafted new object "book"',
            verification: { errors: 1, warnings: 0 },
            issues: [
              {
                severity: 'error',
                code: 'select_without_options',
                message: 'genre is a required select with no options',
                fix: 'Add an options array.',
              },
            ],
          },
        },
      ],
    };
    render(<ChatbotEnhanced messages={[issueTool]} onReviewDraft={vi.fn()} />);
    // The chip still shows the COUNT, and the new detail block expands it into
    // the actual finding + fix hint \u2014 no more dead-end "1 issue" badge.
    expect(screen.getByTestId('draft-verification-chip')).toHaveTextContent('1 issue');
    const detail = screen.getByTestId('draft-issues');
    expect(detail).toHaveTextContent('genre is a required select with no options');
    expect(detail).toHaveTextContent('Add an options array.');
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

  // Improvement 1: a propose_blueprint can FINISH without its result parsing
  // into a structured `proposedPlan` (a thin/odd envelope, or a prose proposal).
  // Before, that collapsed into a "Completed" chip and the user was left with
  // prose and no button — guess-the-"确认". Now a fallback confirm card with an
  // explicit "Build it" / "Adjust" always renders.
  describe('fallback confirm gate for an unstructured propose_blueprint', () => {
    // A completed propose_blueprint with NO proposedPlan (detector returned
    // undefined) — the regression case.
    const unstructured: ChatbotEnhancedMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: "Here's a plan for a reading list. Reply to confirm and I'll build it.",
        toolInvocations: [
          { toolCallId: 't1', toolName: 'propose_blueprint', state: 'output-available' },
        ],
      },
    ];

    it('renders the fallback "Build it" card (not just prose) when the plan did not parse', () => {
      render(
        <ChatbotEnhanced messages={unstructured} onSendMessage={vi.fn()} planReadyLabel="READY_TEXT" />,
      );
      expect(screen.getByTestId('proposed-plan-fallback')).toBeInTheDocument();
      // An explicit, one-click confirm gate — no guessing the "确认" phrase.
      expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
      expect(screen.getByTestId('proposed-plan-adjust')).toBeInTheDocument();
      expect(screen.getByText('READY_TEXT')).toBeInTheDocument();
    });

    it('"Build it" on the fallback card sends the plain approve message (no open questions to default)', () => {
      const onSendMessage = vi.fn();
      render(
        <ChatbotEnhanced
          messages={unstructured}
          onSendMessage={onSendMessage}
          planApproveMessage="APPROVE_PLAIN"
          planApproveDefaultsMessage="APPROVE_DEFAULTS"
        />,
      );
      fireEvent.click(screen.getByTestId('proposed-plan-approve'));
      expect(onSendMessage).toHaveBeenCalledWith('APPROVE_PLAIN');
    });

    it('falls back to the static hint (no buttons) when message sending is not wired', () => {
      render(<ChatbotEnhanced messages={unstructured} planApproveHintLabel="HINT_TEXT" />);
      expect(screen.getByTestId('proposed-plan-fallback')).toBeInTheDocument();
      expect(screen.queryByTestId('proposed-plan-actions')).not.toBeInTheDocument();
      expect(screen.getByText('HINT_TEXT')).toBeInTheDocument();
    });

    it('collapses the fallback card to an inert "Built" badge once apply_blueprint has run', () => {
      const built: ChatbotEnhancedMessage[] = [
        ...unstructured,
        {
          id: 'a2',
          role: 'assistant',
          content: '',
          toolInvocations: [
            { toolCallId: 't2', toolName: 'apply_blueprint', state: 'output-available' },
          ],
        },
      ];
      render(<ChatbotEnhanced messages={built} onSendMessage={vi.fn()} planBuiltLabel="BUILT_BADGE" />);
      expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
      expect(screen.getByTestId('proposed-plan-built')).toBeInTheDocument();
      expect(screen.getByText('BUILT_BADGE')).toBeInTheDocument();
    });

    it('does NOT render the fallback card while the propose_blueprint is still running', () => {
      // A running proposal keeps its live timer in the summary strip; the
      // fallback confirm gate is only for the FINISHED-but-unstructured case.
      render(
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
          onSendMessage={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('proposed-plan-fallback')).not.toBeInTheDocument();
      expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
    });

    it('prefers the RICH plan card over the fallback when the plan DID parse', () => {
      const structured: ChatbotEnhancedMessage[] = [
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          toolInvocations: [
            {
              toolCallId: 't1',
              toolName: 'propose_blueprint',
              state: 'output-available',
              proposedPlan: {
                summary: 'A reading list',
                objects: [{ name: 'book', label: 'Book', fieldCount: 2 }],
                counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
                questions: [],
                assumptions: [],
              },
            },
          ],
        },
      ];
      render(<ChatbotEnhanced messages={structured} onSendMessage={vi.fn()} />);
      // Rich card present, fallback absent — no double card.
      expect(screen.getByTestId('proposed-plan')).toBeInTheDocument();
      expect(screen.queryByTestId('proposed-plan-fallback')).not.toBeInTheDocument();
    });
  });
});

describe('ChatbotEnhanced — auto-publish drafts (self-use magic moment)', () => {
  const userMsg: ChatbotEnhancedMessage = { id: 'u1', role: 'user', content: 'build a todo app' };
  // A whole-app build: the backend marks it `autoPublishable` (apply_blueprint).
  const draftMsg = (packageId: string): ChatbotEnhancedMessage => ({
    id: 'a1',
    role: 'assistant',
    content: 'Built your app.',
    toolInvocations: [
      {
        toolCallId: 'tc1',
        toolName: 'apply_blueprint',
        state: 'output-available',
        draftReview: { items: [{ type: 'object', name: 'task' }], packageId, autoPublishable: true },
      },
    ],
  });
  // An incremental edit: NOT auto-publishable — stays a draft for review.
  const editMsg = (packageId: string): ChatbotEnhancedMessage => ({
    id: 'e1',
    role: 'assistant',
    content: 'Drafted a field.',
    toolInvocations: [
      {
        toolCallId: 'tc-edit',
        toolName: 'add_field',
        state: 'output-available',
        draftReview: { items: [{ type: 'object', name: 'task' }], packageId },
      },
    ],
  });

  it('auto-fires onPublishDrafts for a NEW draft once the turn finishes', () => {
    const onPublishDrafts = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    // Draft streams in but the turn is still running → hold off.
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(onPublishDrafts).not.toHaveBeenCalled();
    // Turn finished → publish exactly once, with the drafted package id.
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(onPublishDrafts).toHaveBeenCalledTimes(1);
    expect(onPublishDrafts).toHaveBeenCalledWith('app.todo');
  });

  it('does NOT auto-publish drafts already present when the chat mounts', () => {
    const onPublishDrafts = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[draftMsg('app.old')]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[draftMsg('app.old')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(onPublishDrafts).not.toHaveBeenCalled();
  });

  it('does NOT auto-publish an incremental edit (not autoPublishable) — it stays a draft', () => {
    const onPublishDrafts = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    // Even with auto-publish ON and the turn finished, an edit must not fire —
    // destructive/incremental changes go live only on explicit review.
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, editMsg('com.workspace')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(onPublishDrafts).not.toHaveBeenCalled();
  });

  it('does not auto-publish when autoPublishDrafts is off', () => {
    const onPublishDrafts = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced isLoading={false} messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(onPublishDrafts).not.toHaveBeenCalled();
  });

  it('publishes the same draft tool call at most once across re-renders', () => {
    const onPublishDrafts = vi.fn();
    const withDraft = [userMsg, draftMsg('app.todo')];
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(<ChatbotEnhanced autoPublishDrafts isLoading={false} messages={withDraft} onPublishDrafts={onPublishDrafts} />);
    rerender(<ChatbotEnhanced autoPublishDrafts isLoading={false} messages={withDraft} onPublishDrafts={onPublishDrafts} />);
    expect(onPublishDrafts).toHaveBeenCalledTimes(1);
  });

  it('shows "Published" only on the published draft, not later edits into the same package', async () => {
    // Regression: the published badge is keyed per draft (toolCallId), not per
    // package. After a build auto-publishes com.workspace, a later edit into the
    // same package is a fresh pending draft and must still offer "Publish".
    const onPublishDrafts = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('com.workspace')]} onPublishDrafts={onPublishDrafts} />,
    );
    await waitFor(() => expect(onPublishDrafts).toHaveBeenCalledTimes(1));
    await screen.findByText('Published'); // the build card flips to published
    // A later incremental edit into the SAME package — still pending.
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('com.workspace'), editMsg('com.workspace')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(screen.getAllByText('Published')).toHaveLength(1); // only the build card
    expect(screen.getByText('Publish')).toBeInTheDocument(); // the edit card still needs publishing
  });

  it('auto-publishes a SECOND build into the SAME package (distinct tool call)', () => {
    // Regression: dedup must be per draft tool call, not per packageId — both
    // builds target com.workspace; keying by packageId would skip the second.
    const onPublishDrafts = vi.fn();
    const build = (callId: string, name: string): ChatbotEnhancedMessage => ({
      id: 'a-' + callId,
      role: 'assistant',
      content: 'built',
      toolInvocations: [
        {
          toolCallId: callId,
          toolName: 'apply_blueprint',
          state: 'output-available',
          draftReview: { items: [{ type: 'object', name }], packageId: 'com.workspace', autoPublishable: true },
        },
      ],
    });
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, build('tc1', 'task')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(onPublishDrafts).toHaveBeenCalledTimes(1);
    // Second build into the same workspace package, new tool call → fires again.
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, build('tc1', 'task'), build('tc2', 'customer')]} onPublishDrafts={onPublishDrafts} />,
    );
    expect(onPublishDrafts).toHaveBeenCalledTimes(2);
    expect(onPublishDrafts).toHaveBeenLastCalledWith('com.workspace');
  });
});

describe('ChatbotEnhanced — streaming build preview (live build tree)', () => {
  const buildMsg = (phase: 'structure' | 'data' | 'done'): ChatbotEnhancedMessage => ({
    id: 'a1',
    role: 'assistant',
    content: '',
    streaming: phase !== 'done',
    buildProgress: {
      phase,
      appLabel: 'CRM',
      items: [
        { type: 'object', name: 'customer' },
        { type: 'view', name: 'customer.list' },
        { type: 'seed', name: 'customer_sample' },
      ],
      done: 3,
      total: 6,
    },
  });

  it('renders a live build tree (not thinking dots) while a build streams', () => {
    render(<ChatbotEnhanced isLoading messages={[buildMsg('data')]} />);
    expect(screen.getByTestId('build-progress')).toBeInTheDocument();
    expect(screen.getByText(/Building CRM/i)).toBeInTheDocument();
    // Artifacts are grouped by type with friendly labels.
    expect(screen.getByText('Objects')).toBeInTheDocument();
    expect(screen.getByText('Views')).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    // The artifact names render (seeds without the _sample suffix).
    expect(screen.getAllByText(/customer/).length).toBeGreaterThan(0);
  });

  it('collapses to a "Built" summary when the build is done', () => {
    render(<ChatbotEnhanced messages={[buildMsg('done')]} />);
    expect(screen.getByText(/Built CRM/i)).toBeInTheDocument();
  });

  it('offers "Open app" on a finished build that created an app, wired to onOpenBuiltApp', () => {
    const onOpenBuiltApp = vi.fn();
    const doneWithApp: ChatbotEnhancedMessage = {
      ...buildMsg('done'),
      buildProgress: {
        ...buildMsg('done').buildProgress!,
        items: [...buildMsg('done').buildProgress!.items, { type: 'app', name: 'crm' }],
      },
    };
    render(<ChatbotEnhanced messages={[doneWithApp]} onOpenBuiltApp={onOpenBuiltApp} />);
    const btn = screen.getByTestId('build-progress-open-app');
    fireEvent.click(btn);
    expect(onOpenBuiltApp).toHaveBeenCalledWith('crm');
  });

  // objectui#12724 (the AiBuild artboard) — the finished card's PRIMARY action
  // opens the built app; Studio is the secondary door. Replaces the earlier
  // pin (objectui#2623) that put Studio in the primary slot.
  it('renders "Open app" as the PRIMARY action and Studio as the secondary door (objectui#12724)', () => {
    const onDesignBuiltApp = vi.fn();
    const onOpenBuiltApp = vi.fn();
    const doneWithApp: ChatbotEnhancedMessage = {
      ...buildMsg('done'),
      buildProgress: {
        ...buildMsg('done').buildProgress!,
        items: [...buildMsg('done').buildProgress!.items, { type: 'app', name: 'crm' }],
      },
    };
    render(
      <ChatbotEnhanced
        messages={[doneWithApp]}
        onDesignBuiltApp={onDesignBuiltApp}
        onOpenBuiltApp={onOpenBuiltApp}
      />,
    );
    const open = screen.getByTestId('build-progress-open-app');
    const design = screen.getByTestId('build-progress-design-app');
    expect(open.className).toContain('bg-primary');
    expect(design.className).toContain('border');
    expect(design.className).not.toContain('bg-primary');
    fireEvent.click(design);
    expect(onDesignBuiltApp).toHaveBeenCalledWith('crm', undefined);
  });

  it("passes the build's OWN package id (from its draft envelope) to the Studio CTA — history-safe", () => {
    const onDesignBuiltApp = vi.fn();
    const doneWithApp: ChatbotEnhancedMessage = {
      ...buildMsg('done'),
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'apply_blueprint',
          draftReview: {
            items: [{ type: 'app', name: 'crm' }],
            packageId: 'app.crm',
          },
        },
      ],
      buildProgress: {
        ...buildMsg('done').buildProgress!,
        items: [...buildMsg('done').buildProgress!.items, { type: 'app', name: 'crm' }],
      },
    };
    render(<ChatbotEnhanced messages={[doneWithApp]} onDesignBuiltApp={onDesignBuiltApp} />);
    fireEvent.click(screen.getByTestId('build-progress-design-app'));
    expect(onDesignBuiltApp).toHaveBeenCalledWith('crm', 'app.crm');
  });

  it('deep-links done-build artifacts via getArtifactAction; null renders plain text', () => {
    const open = vi.fn();
    const getArtifactAction = vi.fn(
      (a: { type: string; name: string }) => (a.type === 'object' ? () => open(a) : null),
    );
    render(<ChatbotEnhanced messages={[buildMsg('done')]} getArtifactAction={getArtifactAction} />);
    const link = screen.getByTestId('build-artifact-link-object-customer');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith({ type: 'object', name: 'customer' });
    // Seeds have no direct-edit home (host returned null) → plain text, no link.
    expect(screen.queryByTestId('build-artifact-link-seed-customer_sample')).not.toBeInTheDocument();
  });

  it('keeps artifact rows plain while the build is still streaming', () => {
    const getArtifactAction = vi.fn(() => () => {});
    render(
      <ChatbotEnhanced isLoading messages={[buildMsg('data')]} getArtifactAction={getArtifactAction} />,
    );
    expect(screen.queryByTestId('build-artifact-link-object-customer')).not.toBeInTheDocument();
  });

  it('shows no Open-app action while streaming or without an app artifact', () => {
    const onOpenBuiltApp = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced isLoading messages={[buildMsg('data')]} onOpenBuiltApp={onOpenBuiltApp} />,
    );
    expect(screen.queryByTestId('build-progress-open-app')).not.toBeInTheDocument();
    // Done but no `app` item → still no button (nothing to open).
    rerender(<ChatbotEnhanced messages={[buildMsg('done')]} onOpenBuiltApp={onOpenBuiltApp} />);
    expect(screen.queryByTestId('build-progress-open-app')).not.toBeInTheDocument();
  });

  // ADR-0048: AI-built apps route on their PACKAGE id (globally unique), not the
  // LLM's display name (`library`, which can collide across apps).
  it('the draft Preview button passes the app package id as the route segment', () => {
    const onPreviewDraftApp = vi.fn();
    const msg: ChatbotEnhancedMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'apply_blueprint',
          state: 'output-available',
          draftReview: { items: [{ type: 'app', name: 'library' }], packageId: 'app.fh79', materialized: true },
        },
      ],
    };
    render(<ChatbotEnhanced messages={[msg]} onPreviewDraftApp={onPreviewDraftApp} onPublishDrafts={vi.fn()} />);
    fireEvent.click(screen.getByTestId('draft-preview-app'));
    expect(onPreviewDraftApp).toHaveBeenCalledWith('library', expect.objectContaining({ appSegment: 'app.fh79' }));
  });

  it('onDraftArtifacts carries the app package id for the auto-opened preview pane', () => {
    const onDraftArtifacts = vi.fn();
    const msg: ChatbotEnhancedMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'apply_blueprint',
          state: 'output-available',
          draftReview: {
            items: [{ type: 'app', name: 'library' }, { type: 'object', name: 'fh79_book' }],
            packageId: 'app.fh79',
          },
        },
      ],
    };
    render(<ChatbotEnhanced messages={[msg]} onDraftArtifacts={onDraftArtifacts} onPublishDrafts={vi.fn()} />);
    expect(onDraftArtifacts).toHaveBeenCalledWith(expect.any(Array), 'app.fh79');
  });
});

/**
 * ADR-0038 L3 — the build-health line under a Published card: the host's
 * onPublishDrafts may return `{ ok, health }` (seedApplied + runtime probes)
 * and the chat must show what the publish ACTUALLY did, not just "Published".
 */
describe('ChatbotEnhanced — publish build-health line (ADR-0038)', () => {
  const userMsg: ChatbotEnhancedMessage = { id: 'u1', role: 'user', content: 'build it' };
  const draftMsg = (packageId: string): ChatbotEnhancedMessage => ({
    id: 'a1',
    role: 'assistant',
    content: 'Built your app.',
    toolInvocations: [
      {
        toolCallId: 'tc-health',
        toolName: 'apply_blueprint',
        state: 'output-available',
        draftReview: { items: [{ type: 'object', name: 'task' }], packageId, autoPublishable: true },
      },
    ],
  });

  it('renders rows-seeded + verified counts and runtime issues from a structured outcome', async () => {
    const onPublishDrafts = vi.fn().mockResolvedValue({
      ok: true,
      health: {
        seededRows: 12,
        checked: { seeds: 2, views: 3, widgets: 4 },
        issues: [
          { severity: 'error', code: 'empty_query', message: 'widget "w1" returns NO data' },
          { severity: 'warning', code: 'probes_unavailable', message: '1 widget not probed' },
        ],
      },
    });
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    await waitFor(() => expect(screen.getByTestId('publish-health')).toBeInTheDocument());
    expect(screen.getByText(/12 sample rows live/i)).toBeInTheDocument();
    // Errors present → the "verified" claim is withheld; the findings show instead.
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
    expect(screen.getByText(/returns NO data/i)).toBeInTheDocument();
    expect(screen.getByText(/not probed/i)).toBeInTheDocument();
  });

  it('claims "verified" only when the probes ran clean', async () => {
    const onPublishDrafts = vi.fn().mockResolvedValue({
      ok: true,
      health: { seededRows: 6, checked: { seeds: 1, views: 2, widgets: 3 }, issues: [] },
    });
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    await waitFor(() => expect(screen.getByTestId('publish-health')).toBeInTheDocument());
    expect(screen.getByText(/6 sample rows live · 2 views · 3 widgets · 1 seed verified/i)).toBeInTheDocument();
  });

  it('renders the seed-load failure loudly', async () => {
    const onPublishDrafts = vi.fn().mockResolvedValue({
      ok: true,
      health: { seedError: 'no readable seed bodies' },
    });
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    await waitFor(() => expect(screen.getByTestId('publish-health')).toBeInTheDocument());
    expect(screen.getByText(/no readable seed bodies/i)).toBeInTheDocument();
  });

  it('stays silent (no health element) for legacy boolean outcomes', async () => {
    const onPublishDrafts = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    // Publish resolves → Published badge, but no health line.
    await waitFor(() => expect(screen.getByText('Published')).toBeInTheDocument());
    expect(screen.queryByTestId('publish-health')).not.toBeInTheDocument();
  });

  it('treats {ok:false} as failure — no Published badge', async () => {
    const onPublishDrafts = vi.fn().mockResolvedValue({ ok: false });
    const { rerender } = render(
      <ChatbotEnhanced autoPublishDrafts isLoading messages={[userMsg]} onPublishDrafts={onPublishDrafts} />,
    );
    rerender(
      <ChatbotEnhanced autoPublishDrafts isLoading={false} messages={[userMsg, draftMsg('app.todo')]} onPublishDrafts={onPublishDrafts} />,
    );
    await waitFor(() => expect(onPublishDrafts).toHaveBeenCalled());
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });
});

describe('publishHealthFromResponse', () => {
  it('maps seedApplied + probes through the {success,data} envelope', async () => {
    const { publishHealthFromResponse } = await import('../ChatbotEnhanced');
    const health = publishHealthFromResponse({
      success: true,
      data: {
        seedApplied: { success: true, inserted: 10, updated: 2 },
        probes: {
          checked: { seeds: 2, views: 1, widgets: 3 },
          issues: [{ severity: 'error', code: 'empty_query', message: 'm' }],
        },
      },
    });
    expect(health).toEqual({
      seededRows: 12,
      checked: { seeds: 2, views: 1, widgets: 3 },
      issues: [{ severity: 'error', code: 'empty_query', message: 'm' }],
    });
  });

  it('maps a failed seedApplied to seedError and tolerates a flat body', async () => {
    const { publishHealthFromResponse } = await import('../ChatbotEnhanced');
    const health = publishHealthFromResponse({
      seedApplied: { success: false, errors: ['row 3 rejected'] },
    });
    expect(health).toEqual({ seedError: 'row 3 rejected' });
  });

  it('returns undefined when the server reported neither (older runtimes)', async () => {
    const { publishHealthFromResponse } = await import('../ChatbotEnhanced');
    expect(publishHealthFromResponse({ success: true, data: { publishedCount: 3 } })).toBeUndefined();
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

  const buildMsg = (done: number, items: Array<{ type: string; name: string }>, phase = 'structure'): ChatbotEnhancedMessage[] => [
    {
      id: 'b1',
      role: 'assistant',
      content: '',
      buildProgress: { phase: phase as 'structure' | 'data' | 'done', appLabel: '进销存', items, done, total: 4 },
    },
  ];

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

  it('build panel reads as "receiving" (m:ss) while progress bytes keep arriving', () => {
    const { rerender } = render(<ChatbotEnhanced messages={buildMsg(1, [{ type: 'object', name: 'product' }])} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('0:02')).toBeInTheDocument();

    // A new build-progress part arrives (done 1→2) → activity re-stamped,
    // stays "receiving"; it is real stream activity, not a free clock.
    rerender(
      <ChatbotEnhanced
        messages={buildMsg(2, [
          { type: 'object', name: 'product' },
          { type: 'object', name: 'order' },
        ])}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('0:04')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for server/i)).not.toBeInTheDocument();
  });

  it('build panel flips to amber "still working" when progress genuinely stalls, then recovers on the next byte', () => {
    const { container, rerender } = render(<ChatbotEnhanced messages={buildMsg(1, [{ type: 'object', name: 'product' }])} />);
    // No new progress for >6s → honest stall, not a reassuring tick.
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(container.querySelector('[data-liveness-tier]')).toHaveAttribute('data-liveness-tier', 'stalled');
    expect(screen.getByText(/Still working/i)).toBeInTheDocument();

    // The server sends the next artifact → back to "receiving".
    rerender(
      <ChatbotEnhanced
        messages={buildMsg(2, [
          { type: 'object', name: 'product' },
          { type: 'view', name: 'product_list' },
        ])}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText(/Still working/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-liveness-tier]')).toHaveAttribute('data-liveness-tier', 'receiving');
    // Back to "receiving" — the m:ss is the whole-turn duration (7s stall + 1s).
    expect(screen.getByText('0:08')).toBeInTheDocument();
  });

  it('server keep-alive heartbeats (bumped seq, identical content) keep the build panel "receiving" through a quiet stretch', () => {
    // A seeding level can run >6s with no new artifact — content stays identical.
    // The server re-emits a heartbeat that only advances `seq`; that must keep
    // the panel green (receiving), proving liveness rides REAL server bytes and
    // not a free clock (without the heartbeat, this same gap goes amber — see the
    // test above).
    const seedingMsg = (seq: number): ChatbotEnhancedMessage[] => [
      {
        id: 'b1',
        role: 'assistant',
        content: '',
        buildProgress: {
          phase: 'data',
          appLabel: '进销存',
          items: [{ type: 'object', name: 'product' }],
          done: 1,
          total: 4,
          seq,
        },
      },
    ];
    const { rerender } = render(<ChatbotEnhanced messages={seedingMsg(1)} />);
    // Heartbeats arrive every ~3s; advance 9s but re-stamp via seq at 3s and 6s.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<ChatbotEnhanced messages={seedingMsg(2)} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<ChatbotEnhanced messages={seedingMsg(3)} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Never went amber — the heartbeats kept it honestly "receiving".
    expect(screen.queryByText(/Waiting for server/i)).not.toBeInTheDocument();
    expect(screen.getByText('0:08')).toBeInTheDocument();
  });
});

// Improvement 2: the propose_blueprint call is a single long, atomic LLM request
// (no token stream), so a bare timer felt stuck. While it runs, the summary strip
// shows a friendly "Designing your app…" lead-in plus a hint that rotates every
// few seconds — presentational reassurance that the wait is moving.
describe('ChatbotEnhanced — propose_blueprint in-progress design hints', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const runningProposal: ChatbotEnhancedMessage[] = [
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
  ];

  it('shows the friendly designing indicator (lead-in + rotating hint + timer) for a running proposal', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={runningProposal}
        labels={{
          designingPlanLabel: 'DESIGNING',
          designingPlanHints: ['HINT_A', 'HINT_B'],
        }}
      />,
    );
    const hint = container.querySelector('[data-testid="build-proposal-progress"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('DESIGNING');
    // First hint up immediately, plus the live elapsed timer beside it.
    expect(hint?.textContent).toContain('HINT_A');
    expect(hint?.querySelector('[data-tool-running-timer]')).not.toBeNull();
  });

  it('rotates to the next hint after the interval elapses', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={runningProposal}
        labels={{ designingPlanLabel: 'DESIGNING', designingPlanHints: ['HINT_A', 'HINT_B'] }}
      />,
    );
    const hint = () => container.querySelector('[data-testid="build-proposal-progress"]');
    expect(hint()?.textContent).toContain('HINT_A');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(hint()?.textContent).toContain('HINT_B');
    expect(hint()?.textContent).not.toContain('HINT_A');
  });

  it('a non-proposal running tool keeps the plain timer, not the design hint', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={[
          { id: 'u1', role: 'user', content: 'do something' },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            streaming: true,
            toolInvocations: [
              { toolCallId: 't1', toolName: 'query_records', state: 'input-available' },
            ],
          },
        ]}
      />,
    );
    expect(container.querySelector('[data-testid="build-proposal-progress"]')).toBeNull();
    expect(container.querySelector('[data-tool-running-timer]')).not.toBeNull();
  });
});

// Improvement 2: a plan's `assumptions` mix neutral design notes with business
// rules the build is explicitly DEFERRING ("…will be added later / 需要后续单独补").
// `classifyAssumptions` splits them so the card can surface the deferred set
// apart, and the user can't mistake a still-to-come rule for delivered behaviour.
describe('classifyAssumptions (deferred vs. design-note split)', () => {
  it('routes explicit "deferred" markers (zh + en) to `deferred`, keeps the rest as design notes', () => {
    const { designNotes, deferred } = classifyAssumptions([
      '设备通过所属客户建立归属关系', // neutral design note
      '技师只能看到分配给自己的工单，将在后续 Flow / 权限配置中实现', // deferred (将在 / 后续)
      'Each device belongs to one customer', // neutral design note
      'Role-based access for technicians will be added later', // deferred (will be added / later)
      '审批流确认后一起补', // deferred (一起补)
      '需要后续单独补权限/流程配置', // deferred (需要后续)
    ]);
    expect(designNotes).toEqual([
      '设备通过所属客户建立归属关系',
      'Each device belongs to one customer',
    ]);
    expect(deferred).toEqual([
      '技师只能看到分配给自己的工单，将在后续 Flow / 权限配置中实现',
      'Role-based access for technicians will be added later',
      '审批流确认后一起补',
      '需要后续单独补权限/流程配置',
    ]);
  });

  it('matches deferral markers case-insensitively and is not fooled by a bare "flow"/"permission" mention', () => {
    const { designNotes, deferred } = classifyAssumptions([
      'Approvals are NOT YET wired up', // deferred — uppercase marker
      'A flow runs on every new work order', // built rule that merely mentions "flow" → design note
      'Permissions follow the org role', // built rule that mentions permission → design note
    ]);
    expect(deferred).toEqual(['Approvals are NOT YET wired up']);
    expect(designNotes).toEqual([
      'A flow runs on every new work order',
      'Permissions follow the org role',
    ]);
  });

  it('trims and drops blank/whitespace assumptions and tolerates non-strings', () => {
    const { designNotes, deferred } = classifyAssumptions([
      '  One shelf for now  ',
      '',
      '   ',
      // @ts-expect-error — guard against malformed backend data
      null,
      '暂不实现导出', // deferred (暂不)
    ]);
    expect(designNotes).toEqual(['One shelf for now']);
    expect(deferred).toEqual(['暂不实现导出']);
  });

  it('handles the all-design-notes and all-deferred extremes', () => {
    expect(classifyAssumptions(['plain a', 'plain b'])).toEqual({
      designNotes: ['plain a', 'plain b'],
      deferred: [],
    });
    expect(classifyAssumptions(['deferred later', '稍后补充'])).toEqual({
      designNotes: [],
      deferred: ['deferred later', '稍后补充'],
    });
  });
});

// Improvement 2 (render): the plan card surfaces the deferred assumptions in a
// distinct "Not yet built" section, separate from the ordinary assumptions list.
describe('ChatbotEnhanced — proposed plan deferred-assumptions section', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  const planWithAssumptions = (assumptions: string[]): ChatbotEnhancedMessage[] => [
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'propose_blueprint',
          state: 'output-available',
          proposedPlan: {
            summary: 'A field-service app',
            objects: [{ name: 'work_order', label: 'Work Order', fieldCount: 4 }],
            counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
            questions: [],
            assumptions,
          },
        },
      ],
    },
  ];

  it('renders deferred assumptions in their own "Not yet built" section, design notes in the normal list', () => {
    render(
      <ChatbotEnhanced
        messages={planWithAssumptions([
          'Devices belong to a customer',
          '技师只能看到自己的工单，将在后续权限配置中实现',
        ])}
        planAssumptionsLabel="ASSUMPTIONS"
        planDeferredLabel="NOT_YET_BUILT"
      />,
    );
    const deferred = screen.getByTestId('proposed-plan-deferred');
    expect(deferred).toHaveTextContent('NOT_YET_BUILT');
    expect(deferred).toHaveTextContent('将在后续权限配置中实现');
    // The neutral note stays in the ordinary assumptions group, NOT the deferred box.
    const notes = screen.getByTestId('proposed-plan-assumptions');
    expect(notes).toHaveTextContent('Devices belong to a customer');
    expect(notes).not.toHaveTextContent('将在后续权限配置中实现');
  });

  it('omits the deferred section entirely when no assumption is deferred', () => {
    render(
      <ChatbotEnhanced
        messages={planWithAssumptions(['Devices belong to a customer'])}
        planDeferredLabel="NOT_YET_BUILT"
      />,
    );
    expect(screen.getByTestId('proposed-plan-assumptions')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-deferred')).not.toBeInTheDocument();
  });

  it('omits the ordinary assumptions section when every assumption is deferred', () => {
    render(
      <ChatbotEnhanced
        messages={planWithAssumptions(['审批流确认后一起补', 'Exports to be added later'])}
        planDeferredLabel="NOT_YET_BUILT"
      />,
    );
    expect(screen.getByTestId('proposed-plan-deferred')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-assumptions')).not.toBeInTheDocument();
  });
});

// Improvement 4: the design-wait hint should read as steady forward progress on a
// long (multi-minute) propose_blueprint call. `selectDesignHintIndex` advances one
// stage per interval, then CLAMPS on the last hint instead of wrapping — so it never
// looks like it restarted, and there is no fake percentage.
describe('selectDesignHintIndex (elapsed → design stage)', () => {
  const step = 3500;
  it('advances one stage per interval', () => {
    expect(selectDesignHintIndex(0, 5, step)).toBe(0);
    expect(selectDesignHintIndex(step - 1, 5, step)).toBe(0);
    expect(selectDesignHintIndex(step, 5, step)).toBe(1);
    expect(selectDesignHintIndex(step * 2, 5, step)).toBe(2);
    expect(selectDesignHintIndex(step * 3, 5, step)).toBe(3);
  });

  it('clamps on the final stage rather than wrapping back to the start', () => {
    // Way past the last stage (a multi-minute wait) — pins the last hint, never loops.
    expect(selectDesignHintIndex(step * 4, 5, step)).toBe(4);
    expect(selectDesignHintIndex(step * 50, 5, step)).toBe(4);
    expect(selectDesignHintIndex(step * 999, 10, step)).toBe(9);
  });

  it('returns -1 for an empty list and pins index 0 for a single hint', () => {
    expect(selectDesignHintIndex(0, 0, step)).toBe(-1);
    expect(selectDesignHintIndex(step * 5, 0, step)).toBe(-1);
    expect(selectDesignHintIndex(0, 1, step)).toBe(0);
    expect(selectDesignHintIndex(step * 5, 1, step)).toBe(0);
  });

  it('treats negative / non-finite elapsed as stage 0 (no crash)', () => {
    expect(selectDesignHintIndex(-100, 5, step)).toBe(0);
    expect(selectDesignHintIndex(Number.NaN, 5, step)).toBe(0);
    // Infinity is not finite → guarded to stage 0 rather than NaN/overflow.
    expect(selectDesignHintIndex(Number.POSITIVE_INFINITY, 5, step)).toBe(0);
  });
});

// Improvement 4 (render): the running-proposal indicator shows step dots that fill
// up to the current stage and advances forward through a longer hint pool.
describe('ChatbotEnhanced — design-wait staging (dots + forward progress)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const runningProposal: ChatbotEnhancedMessage[] = [
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
  ];

  it('renders one step dot per hint and advances the hint forward as the wait grows', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={runningProposal}
        labels={{
          designingPlanLabel: 'DESIGNING',
          designingPlanHints: ['HINT_A', 'HINT_B', 'HINT_C'],
        }}
      />,
    );
    const dots = () => container.querySelector('[data-testid="build-proposal-progress-dots"]');
    const hint = () => container.querySelector('[data-testid="build-proposal-progress"]');
    expect(dots()?.children.length).toBe(3);
    expect(hint()?.textContent).toContain('HINT_A');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(hint()?.textContent).toContain('HINT_B');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(hint()?.textContent).toContain('HINT_C');
  });

  it('clamps on the last hint on a long wait instead of looping back', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={runningProposal}
        labels={{ designingPlanLabel: 'DESIGNING', designingPlanHints: ['HINT_A', 'HINT_B'] }}
      />,
    );
    const hint = () => container.querySelector('[data-testid="build-proposal-progress"]');
    act(() => {
      vi.advanceTimersByTime(3500 * 8); // well past the last stage
    });
    expect(hint()?.textContent).toContain('HINT_B');
    expect(hint()?.textContent).not.toContain('HINT_A');
  });

  it('shows no step dots when rotation is disabled (single hint)', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={runningProposal}
        labels={{ designingPlanLabel: 'DESIGNING', designingPlanHints: ['ONLY'] }}
      />,
    );
    expect(container.querySelector('[data-testid="build-proposal-progress"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="build-proposal-progress-dots"]')).toBeNull();
  });
});

describe('ChatbotEnhanced — propose_blueprint live design progress (data-blueprint-progress)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // A running propose_blueprint whose stream has begun emitting the reconciled
  // `data-blueprint-progress` part — lifted onto the message as blueprintProgress
  // by uiMessageToChatMessage (see mapMessages.test.ts for the event→data half).
  const designing = (
    blueprintProgress: NonNullable<ChatbotEnhancedMessage['blueprintProgress']>,
  ): ChatbotEnhancedMessage[] => [
    { id: 'u1', role: 'user', content: 'build me a recruiting app' },
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      streaming: true,
      toolInvocations: [
        { toolCallId: 't1', toolName: 'propose_blueprint', state: 'input-available' },
      ],
      blueprintProgress,
    },
  ];

  it('renders the live design panel with object chips (label + field count) and the summary', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={designing({
          phase: 'designing',
          summary: '招聘管理系统',
          appLabel: '招聘管理',
          objects: [
            { name: 'candidate', label: '候选人', fields: 5 },
            { name: 'job', label: '职位', fields: 4 },
          ],
          counts: { objects: 2, views: 2, dashboards: 1 },
          seq: 3,
        })}
        labels={{ designingPlanLabel: 'Designing your app…' }}
      />,
    );
    const panel = container.querySelector('[data-testid="blueprint-progress"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Designing your app…');
    // Summary one-liner revealed progressively.
    expect(panel?.textContent).toContain('招聘管理系统');
    const chips = container.querySelector('[data-testid="blueprint-progress-objects"]');
    expect(chips).not.toBeNull();
    expect(chips?.textContent).toContain('候选人');
    expect(chips?.textContent).toContain('职位');
    // Field-count suffix on the chips.
    expect(chips?.textContent).toContain('5');
    expect(chips?.textContent).toContain('4');
    // Compact counts line.
    expect(panel?.textContent).toContain('2 objects');
  });

  it('object chips reflect the latest streamed frame as objects accrue one by one', () => {
    const { container, rerender } = render(
      <ChatbotEnhanced
        isLoading
        messages={designing({
          phase: 'designing',
          objects: [{ name: 'candidate', label: '候选人', fields: 5 }],
          seq: 1,
        })}
      />,
    );
    let chips = container.querySelector('[data-testid="blueprint-progress-objects"]');
    expect(chips?.querySelectorAll('span[title]').length).toBe(1);
    // The next reconciled frame reveals a second object — in place.
    rerender(
      <ChatbotEnhanced
        isLoading
        messages={designing({
          phase: 'designing',
          objects: [
            { name: 'candidate', label: '候选人', fields: 5 },
            { name: 'job', label: '职位', fields: 4 },
          ],
          seq: 2,
        })}
      />,
    );
    chips = container.querySelector('[data-testid="blueprint-progress-objects"]');
    expect(chips?.querySelectorAll('span[title]').length).toBe(2);
    expect(chips?.textContent).toContain('职位');
  });

  it('supersedes the rotating-hint placeholder once real progress events arrive', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={designing({
          phase: 'designing',
          objects: [{ name: 'candidate', label: '候选人', fields: 5 }],
          seq: 1,
        })}
        labels={{ designingPlanLabel: 'Designing your app…', designingPlanHints: ['HINT_A'] }}
      />,
    );
    // The event-driven panel is up…
    expect(container.querySelector('[data-testid="blueprint-progress"]')).not.toBeNull();
    // …and the purely-presentational rotating hint is NOT also shown in the
    // activity strip (no duplicate "designing" affordance).
    expect(container.querySelector('[data-testid="build-proposal-progress"]')).toBeNull();
  });

  it('falls back to the rotating-hint placeholder when NO progress events arrive (older runtimes)', () => {
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
        labels={{ designingPlanLabel: 'Designing your app…', designingPlanHints: ['HINT_A'] }}
      />,
    );
    // No blueprintProgress → no panel, and the placeholder behaves exactly as before.
    expect(container.querySelector('[data-testid="blueprint-progress"]')).toBeNull();
    expect(container.querySelector('[data-testid="build-proposal-progress"]')).not.toBeNull();
  });

  it('hands off to the authoritative "Proposed plan" card once the result lands (panel goes away)', () => {
    render(
      <ChatbotEnhanced
        messages={[
          { id: 'u1', role: 'user', content: 'build me a recruiting app' },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            // A late 'done' progress frame can momentarily co-exist with the
            // tool result; the authoritative plan card must win, the panel must go.
            blueprintProgress: {
              phase: 'done',
              summary: '招聘管理系统',
              objects: [{ name: 'candidate', label: '候选人', fields: 5 }],
            },
            toolInvocations: [
              {
                toolCallId: 't1',
                toolName: 'propose_blueprint',
                state: 'output-available',
                proposedPlan: {
                  summary: '招聘管理系统',
                  objects: [{ name: 'candidate', label: '候选人', fieldCount: 5 }],
                  counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
                  questions: [],
                  assumptions: [],
                },
              },
            ],
          },
        ]}
      />,
    );
    expect(document.querySelector('[data-testid="blueprint-progress"]')).toBeNull();
    expect(screen.getByTestId('proposed-plan')).toBeInTheDocument();
  });

  it('shows the extend-mode badge with the target app when extending', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={designing({
          phase: 'designing',
          targetApp: 'recruiting',
          objects: [{ name: 'interview', label: '面试', fields: 3 }],
        })}
        // `planExtendLabel` is a top-level prop of `ChatbotEnhancedProps`, not a
        // member of `ChatbotLabels` — it was passed inside `labels` here, so the
        // component never saw the override and rendered its default,
        // "Adding to existing app". The old expectation was `toContain('Adding
        // to')`, which that default satisfies, so the case was green while the
        // thing it names was ignored. The override string below is deliberately
        // NOT a substring of the default, so the assertion can only pass if the
        // prop is really read (objectui#4040).
        planExtendLabel="Extending"
      />,
    );
    const badge = container.querySelector('[data-testid="blueprint-progress-extend"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('Extending');
    expect(badge?.textContent).toContain('recruiting');
  });
});
