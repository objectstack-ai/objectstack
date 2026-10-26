/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8343 — an `apply_blueprint` that returned `awaiting_confirmation`
 * built NOTHING, so the plan card before it must keep its live "Build it".
 *
 * `builtPlanIds` used to key on the tool NAME alone
 * (`if (tool.toolName === 'apply_blueprint') lastBuildOrder = order`), which
 * cannot tell "the build ran" from "the build refused to run and is itself
 * waiting for the user". On the second (iteration) turn the build agent calls
 * `apply_blueprint`, hits its own confirm gate and returns
 * `{"status":"awaiting_confirmation", …}`. The earlier `propose_blueprint`
 * card was then marked 已搭建, collapsing its "Build it" button away — while
 * the `apply_blueprint` card itself has no button either. Measured in the
 * browser: the whole turn had no confirm affordance at all, and the only way
 * out was guessing the magic phrase "确认" into the composer.
 *
 * Both envelopes below are the real wire shapes, fed through the real mapper
 * (`uiMessagesToChatMessages`) so the detector chain runs exactly as it does
 * in the console.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';

/** `propose_blueprint` result — the plan the user is asked to confirm. */
const BLUEPRINT_PROPOSED = {
  status: 'blueprint_proposed',
  summary: 'Add a vaccination-record table to the existing clinic app',
  blueprint: {
    objects: [
      {
        name: 'vaccination_record',
        label: 'Vaccination record',
        fields: [{ name: 'pet' }, { name: 'vaccine' }, { name: 'given_on' }],
      },
    ],
  },
  counts: { objects: 1, views: 1, dashboards: 0, seedData: 1 },
  questions: [],
  assumptions: [],
};

/**
 * `apply_blueprint` result when the user did NOT say the magic "直接搭建" —
 * the tool shows a confirm card and stops. Nothing was created.
 */
const AWAITING_CONFIRMATION = {
  status: 'awaiting_confirmation',
  message:
    'A confirm card for this blueprint was just shown to the user — STOP and let them review it.',
};

/** `apply_blueprint` result when the build actually ran (ADR-0033 draft envelope). */
const BUILD_DRAFTED = {
  status: 'drafted',
  summary: 'Created 1 object, 1 view',
  drafted: [
    { type: 'object', name: 'vaccination_record' },
    { type: 'app', name: 'clinic' },
  ],
};

/** The two-turn transcript: propose, then an apply_blueprint with `applyResult`. */
function transcript(applyResult: unknown) {
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
    {
      id: 'a2',
      role: 'assistant',
      parts: [
        {
          type: 'tool-apply_blueprint',
          toolCallId: 'apply-1',
          state: 'output-available',
          output: { type: 'text', value: JSON.stringify(applyResult) },
        },
        { type: 'text', text: 'Please confirm the plan card so the build can run.' },
      ],
    },
  ]);
}

describe('ChatbotEnhanced — apply_blueprint that only asked for confirmation (#8343)', () => {
  it('sanity: the transcript really produces a plan card the mapper recognised', () => {
    const messages = transcript(AWAITING_CONFIRMATION);
    expect(messages[0].toolInvocations?.[0].proposedPlan).toBeTruthy();
    expect(messages[1].toolInvocations?.[0].toolName).toBe('apply_blueprint');
    // The apply call carries no plan/changes card of its own — which is why
    // the propose card is the ONLY confirm affordance in this turn.
    expect(messages[1].toolInvocations?.[0].proposedPlan).toBeUndefined();
    expect(messages[1].toolInvocations?.[0].proposedChanges).toBeUndefined();
  });

  it('keeps the plan card pending, with a live Build it button', () => {
    render(<ChatbotEnhanced messages={transcript(AWAITING_CONFIRMATION)} onSendMessage={vi.fn()} />);

    // The bug: this used to be the inert 已搭建 badge and the buttons were gone,
    // leaving the whole turn with nothing to click.
    expect(screen.queryByTestId('proposed-plan-built')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-adjust')).toBeInTheDocument();
  });

  it('still collapses the plan card to Built once the build actually ran', () => {
    render(<ChatbotEnhanced messages={transcript(BUILD_DRAFTED)} onSendMessage={vi.fn()} />);

    // The #432 behaviour this fix must not regress: a plan whose build HAS run
    // may not keep offering a button that re-triggers the whole build.
    expect(screen.getByTestId('proposed-plan-built')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
  });

  it('collapses to Built while the real build is still running (no result yet)', () => {
    const messages = uiMessagesToChatMessages([
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
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          { type: 'tool-apply_blueprint', toolCallId: 'apply-1', state: 'input-available' },
        ],
      },
    ]);
    render(<ChatbotEnhanced messages={messages} onSendMessage={vi.fn()} />);

    // An in-flight build is a build: the plan card must not offer a second
    // "Build it" that would re-trigger it.
    expect(screen.getByTestId('proposed-plan-built')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
  });
});

/**
 * The sibling memo, `confirmedChangeIds`, was reported on the issue as already
 * having the right shape. Measured: it does NOT. It inferred "this later call
 * committed" from the ABSENCE of a rich `proposedChanges` card, and that
 * detector needs a `changes_proposed` status AND ≥1 parseable change row — so a
 * later same-tool call that WAS a preview but rendered no card settled the
 * pending card just the same. Same defect, one memo down.
 */
const CHANGES_PROPOSED = {
  status: 'changes_proposed',
  applied: false,
  summary: 'Confirm this change before it is applied.',
  changes: [{ verb: 'add_field', object: 'task', field: 'priority', type: 'select' }],
};

function changeTranscript(secondResult: unknown) {
  return uiMessagesToChatMessages([
    {
      id: 'c1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-update_metadata',
          toolCallId: 'change-1',
          state: 'output-available',
          output: { type: 'text', value: JSON.stringify(CHANGES_PROPOSED) },
        },
      ],
    },
    {
      id: 'c2',
      role: 'assistant',
      parts: [
        {
          type: 'tool-update_metadata',
          toolCallId: 'change-2',
          state: 'output-available',
          output: { type: 'text', value: JSON.stringify(secondResult) },
        },
      ],
    },
  ]);
}

describe('ChatbotEnhanced — a later preview is not a commit (#8343)', () => {
  it('keeps the 确认修改 card pending when the later same-tool call was itself a preview', () => {
    // `changes: []` — the shape `apply_edit` returns when the gate previewed an
    // op list the row formatter could not turn into a card.
    render(
      <ChatbotEnhanced
        messages={changeTranscript({ status: 'changes_proposed', applied: false, changes: [] })}
        onSendMessage={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('proposed-changes-confirmed')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-confirm')).toBeInTheDocument();
  });

  it('still collapses the 确认修改 card once the same tool really committed', () => {
    render(
      <ChatbotEnhanced
        messages={changeTranscript({ status: 'drafted', summary: 'Added task.priority' })}
        onSendMessage={vi.fn()}
      />,
    );

    expect(screen.getByTestId('proposed-changes-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-confirm')).not.toBeInTheDocument();
  });
});
