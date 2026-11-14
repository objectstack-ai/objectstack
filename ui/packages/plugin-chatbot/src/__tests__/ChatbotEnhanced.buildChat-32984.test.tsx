/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#32984 — the AI build chat, as a customer met it on cloud
 * staging. Four of the card's five items live in this component (the fifth,
 * the draft preview's list, is pinned in app-shell beside `ObjectView`):
 *
 *  1. the plan card said 已搭建 the moment a plan was confirmed, and kept
 *     saying it through six `apply_blueprint` refusals with nothing built;
 *  2. a message typed while a turn ran went nowhere;
 *  4. the build card printed the agent's own repair instruction verbatim;
 *  5. the change card named objects and fields by their machine names.
 *
 * Every transcript goes through the real mapper from raw tool parts, and every
 * interaction through the rendered component (Enter in the textarea, a click
 * on the button), so the detector chain and the input pipeline run as they do
 * in the console.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';

const BLUEPRINT_PROPOSED = {
  status: 'blueprint_proposed',
  summary: 'A quoting app for a construction firm',
  blueprint: {
    objects: [{ name: 'b6bl_customer', label: 'Customer', fields: [{ name: 'name' }] }],
  },
  counts: { objects: 1, views: 1, dashboards: 0, seedData: 1 },
  questions: [],
  assumptions: [],
};

/**
 * What the build gate answered on staging when the turn carried no confirmed
 * blueprint identity. The producer is cloud's `apply_blueprint`; this repo
 * holds no copy of its envelope, so the shape is the refusal's essentials: a
 * status that is not a build, and the code the card quoted.
 */
const NOT_CONFIRMED = {
  status: 'refused',
  code: 'blueprint_not_confirmed',
  message: 'The blueprint has not been confirmed by the user.',
};

const BUILD_DRAFTED = {
  status: 'drafted',
  summary: 'Created 1 object, 1 view',
  drafted: [
    { type: 'object', name: 'b6bl_customer' },
    { type: 'app', name: 'b6bl' },
  ],
};

type ApplyPart =
  | { output: unknown }
  | { running: true }
  | { errorText: string };

/** Propose, then one `apply_blueprint` per entry of `applies`, in order. */
function transcript(applies: ApplyPart[]) {
  return uiMessagesToChatMessages([
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-propose_blueprint',
          toolCallId: 'plan-1',
          state: 'output-available',
          output: { type: 'text', value: JSON.stringify(BLUEPRINT_PROPOSED) },
        },
      ],
    },
    ...applies.map((apply, i) => ({
      id: `a${i + 2}`,
      role: 'assistant' as const,
      parts: [
        'running' in apply
          ? { type: 'tool-apply_blueprint', toolCallId: `apply-${i}`, state: 'input-available' }
          : 'errorText' in apply
            ? {
                type: 'tool-apply_blueprint',
                toolCallId: `apply-${i}`,
                state: 'output-error',
                errorText: apply.errorText,
              }
            : {
                type: 'tool-apply_blueprint',
                toolCallId: `apply-${i}`,
                state: 'output-available',
                output: { type: 'text', value: JSON.stringify(apply.output) },
              },
      ],
    })),
  ] as never);
}

describe('objectstack#32984 item 1 — the plan card says what the build did', () => {
  it('six refused applies: 搭建未完成, never 已搭建, and Build it is offered again', () => {
    const refused = Array.from({ length: 6 }, () => ({ output: NOT_CONFIRMED }));
    render(<ChatbotEnhanced messages={transcript(refused)} onSendMessage={vi.fn()} />);

    expect(screen.queryByTestId('proposed-plan-built')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-build-failed')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
  });

  it('an apply that errored reads failed too', () => {
    render(
      <ChatbotEnhanced messages={transcript([{ errorText: 'tool crashed' }])} onSendMessage={vi.fn()} />,
    );
    expect(screen.queryByTestId('proposed-plan-built')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-build-failed')).toBeInTheDocument();
  });

  it('a running apply reads 正在搭建… while the turn is live, with no second Build it', () => {
    render(
      <ChatbotEnhanced messages={transcript([{ running: true }])} onSendMessage={vi.fn()} isLoading />,
    );
    expect(screen.getByTestId('proposed-plan-building')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-built')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
  });

  it('a running apply the turn never answered reads failed once the turn has ended', () => {
    render(<ChatbotEnhanced messages={transcript([{ running: true }])} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('proposed-plan-build-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-built')).not.toBeInTheDocument();
  });

  it('refused, then built: 已搭建 (the build outranks the earlier refusals)', () => {
    render(
      <ChatbotEnhanced
        messages={transcript([{ output: NOT_CONFIRMED }, { output: BUILD_DRAFTED }])}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByTestId('proposed-plan-built')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-build-failed')).not.toBeInTheDocument();
  });

  it('a click after a refusal reads 已确认 until the next attempt speaks', () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={transcript([{ output: NOT_CONFIRMED }])} onSendMessage={onSendMessage} />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('proposed-plan-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-build-failed')).not.toBeInTheDocument();

    // The next attempt starts: it speaks over the click.
    rerender(
      <ChatbotEnhanced
        messages={transcript([{ output: NOT_CONFIRMED }, { running: true }])}
        onSendMessage={onSendMessage}
        isLoading
      />,
    );
    expect(screen.getByTestId('proposed-plan-building')).toBeInTheDocument();
  });
});

describe('objectstack#32984 item 2 — a message typed during a turn is never dropped', () => {
  it('Enter during a turn queues it in sight, and it is sent when the turn ends', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} isLoading placeholder="Ask…" />,
    );
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    // The composer is live during the turn: the user can type.
    expect(textarea).not.toBeDisabled();
    fireEvent.change(textarea, { target: { value: '在哪里打开这个应用？' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const queued = await screen.findByTestId('composer-queued-item');
    expect(queued).toHaveTextContent('在哪里打开这个应用？');
    expect(queued).toHaveTextContent('Sends when the current reply finishes');
    expect(onSendMessage).not.toHaveBeenCalled();

    // The turn ends: the queued message goes out, once, and leaves the queue.
    rerender(<ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} placeholder="Ask…" />);
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage).toHaveBeenCalledWith('在哪里打开这个应用？', undefined);
    expect(screen.queryByTestId('composer-queued-item')).not.toBeInTheDocument();
  });

  it('Cancel takes it out of the queue and puts the text back in the box', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} isLoading placeholder="Ask…" />,
    );
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'never mind' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('composer-queued-cancel'));

    expect(screen.queryByTestId('composer-queued-item')).not.toBeInTheDocument();
    expect(textarea.value).toBe('never mind');
    rerender(<ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} placeholder="Ask…" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('control: with no turn running, Enter sends at once', async () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced messages={[]} onSendMessage={onSendMessage} placeholder="Ask…" />);
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage.mock.calls[0][0]).toBe('hello');
    expect(screen.queryByTestId('composer-queued-item')).not.toBeInTheDocument();
  });
});

describe('objectstack#32984 item 4 — the build card speaks to the customer', () => {
  const AGENT_TEXT =
    'Seed "b6bl_construction_project_sample" sets "quote" on none of its 12 row(s). Do NOT publish this seed with the column empty.';
  const withIssue = () =>
    uiMessagesToChatMessages([
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-apply_blueprint',
            toolCallId: 'apply-1',
            state: 'output-available',
            output: {
              type: 'text',
              value: JSON.stringify({
                ...BUILD_DRAFTED,
                packageId: 'app.b6bl',
                verification: { errors: 1, warnings: 0 },
                issues: [{ severity: 'error', code: 'seed_column_empty', message: AGENT_TEXT }],
              }),
            },
          },
        ],
      },
    ] as never);

  it('shows a customer sentence; the agent text only behind Technical details', () => {
    // The console wires the review door; the build card draws with it.
    render(<ChatbotEnhanced messages={withIssue()} onSendMessage={vi.fn()} onReviewDraft={vi.fn()} />);

    const issues = screen.getByTestId('draft-issues');
    expect(within(issues).getByTestId('draft-issues-summary')).toHaveTextContent(
      'Some parts of this build need fixing before it is ready.',
    );
    expect(within(issues).getByTestId('draft-issues-summary')).not.toHaveTextContent('Do NOT publish');
    // The agent's sentence is not the card's own line: it sits in a closed
    // disclosure, and nowhere else on the card.
    const details = within(issues).getByTestId('draft-issues-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent('Do NOT publish');
    const outside = Array.from(issues.children).filter((c) => c !== details);
    for (const node of outside) expect(node).not.toHaveTextContent('Do NOT publish');
    // The chip says the count through the pack, not a hard-coded English plural.
    expect(screen.getByTestId('draft-verification-chip')).toHaveTextContent('1 to fix');
  });
});

describe('objectstack#32984 item 5 — the change card names things by label', () => {
  const proposal = () =>
    uiMessagesToChatMessages([
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-apply_edit',
            toolCallId: 'call_1',
            state: 'output-available',
            input: {},
            output: {
              status: 'changes_proposed',
              posture: { mode: 'draft' },
              primaryAction: 'save_draft',
              summary: '改动先存为草稿',
              changes: [
                {
                  verb: 'modify_field',
                  object: 'b6bl_quote_item',
                  field: 'line_total',
                  type: 'currency',
                  details: '小计 · 不必填',
                },
              ],
            },
          },
        ],
      },
    ] as never);

  it('object, field and type by their labels; the machine names stay on the tooltip', () => {
    render(
      <ChatbotEnhanced
        messages={proposal()}
        onSendMessage={vi.fn()}
        resolveObjectLabel={(name) => (name === 'b6bl_quote_item' ? '报价明细' : undefined)}
        resolveFieldLabel={(o, f) => (o === 'b6bl_quote_item' && f === 'line_total' ? '小计' : undefined)}
        resolveFieldTypeLabel={(type) => (type === 'currency' ? '货币' : undefined)}
      />,
    );
    const target = screen.getByTestId('proposed-change-target');
    expect(target).toHaveTextContent('报价明细 · 小计');
    expect(target).not.toHaveTextContent('b6bl_quote_item');
    expect(target).toHaveAttribute('title', 'b6bl_quote_item.line_total');
    const params = screen.getByTestId('proposed-change-params');
    expect(params).toHaveTextContent('货币 · 小计 · 不必填');
    expect(params).not.toHaveTextContent('currency');
  });

  it('control: a name the host does not know (about to be created) shows as given', () => {
    render(
      <ChatbotEnhanced
        messages={proposal()}
        onSendMessage={vi.fn()}
        resolveObjectLabel={() => undefined}
        resolveFieldLabel={() => undefined}
        resolveFieldTypeLabel={() => undefined}
      />,
    );
    expect(screen.getByTestId('proposed-change-target')).toHaveTextContent('b6bl_quote_item · line_total');
  });
});
