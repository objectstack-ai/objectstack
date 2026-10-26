// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `visibleWhen` on a screen field — rendering AND `required` enforcement.
 *
 * These must agree. #3528: the framework declared `visibleWhen` on the screen
 * node's designer form but never put it on the wire, so every field rendered
 * unconditionally while `required` was still enforced. HotCRM's lead conversion
 * is the shape that made that fatal — an `opportunityName` that is required
 * only *when shown*. Leave the checkbox unticked and Submit blocked on an input
 * the user was never shown, issuing zero network requests, with the run left
 * paused forever.
 *
 * The server half now forwards the predicate (objectstack#3771). This is the
 * client half: honour it in both places, from one helper, so they cannot drift.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';

/** HotCRM's `lead_conversion` screen, verbatim in shape. */
const CONVERSION: ScreenFlowState = {
  flowName: 'lead_conversion',
  runId: 'run-1',
  screen: {
    nodeId: 'screen_1',
    title: 'Conversion Details',
    fields: [
      { name: 'createOpportunity', label: 'Create Opportunity?', type: 'boolean', required: true },
      {
        name: 'opportunityName',
        label: 'Opportunity Name',
        type: 'text',
        required: true,
        visibleWhen: 'createOpportunity == true',
      },
      {
        name: 'opportunityAmount',
        label: 'Opportunity Amount',
        type: 'currency',
        visibleWhen: 'createOpportunity == true',
      },
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(state: ScreenFlowState, authFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  render(<FlowRunner state={state} authFetch={authFetch} baseUrl="" onClose={onClose} onComplete={onComplete} />);
  return { onClose, onComplete };
}

// The implementation spells out `FlowRunner`'s `authFetch` parameters even
// though it reads neither: a zero-arity `vi.fn` infers `Mock<() => …>`, whose
// `mock.calls` is the EMPTY tuple — so the `calls[0][0]` / `calls[0][1]`
// assertions below were reading elements of an empty tuple as far as the
// compiler was concerned (objectui#4040).
const okResume = () =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    jsonResponse({ success: true, data: { success: true } }),
  );

beforeEach(() => vi.restoreAllMocks());

describe('screen field visibleWhen (#3528)', () => {
  it('hides a field whose predicate is false', () => {
    setup(CONVERSION, okResume());
    expect(screen.getByText('Create Opportunity?')).toBeInTheDocument();
    expect(screen.queryByText('Opportunity Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Opportunity Amount')).not.toBeInTheDocument();
  });

  it('reveals the dependent fields once the predicate holds', async () => {
    const user = userEvent.setup();
    setup(CONVERSION, okResume());
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.getByText('Opportunity Name')).toBeInTheDocument());
    expect(screen.getByText('Opportunity Amount')).toBeInTheDocument();
  });

  /**
   * The regression. A hidden `required` field must not block Submit — the whole
   * reported defect is that it did, silently.
   */
  it('RESUMES with a hidden required field left empty', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    const { onComplete } = setup(CONVERSION, authFetch);

    // Tick the required boolean; `opportunityName` stays hidden and empty.
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.getByText('Opportunity Name')).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox')); // untick → hidden again
    await waitFor(() => expect(screen.queryByText('Opportunity Name')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(authFetch.mock.calls[0][0]).toBe('/api/v1/automation/lead_conversion/runs/run-1/resume');
    expect(onComplete).toHaveBeenCalled();
  });

  it('still blocks Submit on a VISIBLE required field left empty', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    setup(CONVERSION, authFetch);

    // Reveal `opportunityName` (required) and submit without filling it.
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.getByText('Opportunity Name')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // No resume — the field is genuinely on screen and genuinely required.
    await new Promise((r) => setTimeout(r, 50));
    expect(authFetch).not.toHaveBeenCalled();
  });

  /**
   * Fail-open, matching `resolveFieldRuleState`: hiding an input because its
   * predicate has a typo would silently drop data the flow is waiting for.
   */
  it('keeps a field visible when its predicate is broken', () => {
    setup(
      {
        flowName: 'f',
        runId: 'r',
        screen: {
          nodeId: 'n',
          title: 'Broken',
          fields: [{ name: 'note', label: 'Note', type: 'text', visibleWhen: 'this is not CEL (((' }],
        },
      },
      okResume(),
    );
    expect(screen.getByText('Note')).toBeInTheDocument();
  });

  it('leaves a screen with no predicates completely unchanged', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    setup(
      {
        flowName: 'reassign',
        runId: 'run-9',
        screen: {
          nodeId: 'collect',
          title: 'New Assignee',
          fields: [{ name: 'new_assignee', label: 'Assignee', type: 'text', required: true }],
        },
      },
      authFetch,
    );
    await user.type(screen.getAllByRole('textbox')[0], 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(authFetch.mock.calls[0][1]?.body))).toMatchObject({
      inputs: { new_assignee: 'ada@example.com' },
    });
  });
});
