/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7707 — a run that ended with `outcome: 'refused'` is a NOTICE, not a
 * completion. Lane (3) of the maintainer ruling on objectstack#14945.
 *
 * ## The shape is ruled, not chosen here
 *
 * > runner (objectui `FlowRunner`): on `refused`, render the message with
 * > **Close only**, no Submit, no "completed" toast; the invoking action's
 * > `successMessage` stays suppressed exactly as today (`silent`).
 *
 * The contract half landed upstream and is on the INSTALLED surface, which is
 * what this file is written against rather than against a card's description:
 * `@objectstack/spec`'s `AutomationResult` declares `status: 'refused'` as a
 * terminal status distinct from `'failed'` ("a successful evaluation that said
 * no" — `success` stays `true`, `successMessage` is NOT set), carrying the
 * engine-rendered `refusalMessage`.
 *
 * ## What each pin is a fact about
 *
 * 1. **Per-record text reaches the dialog.** The `end` node's `message` is a
 *    `{token}` template and the ENGINE interpolates it — the same interpolation
 *    a screen `description` gets — so what this pin measures is that the runner
 *    renders the sentence the server composed *for that record*, and not a
 *    static string. Two records, two sentences, each asserted present and the
 *    other asserted ABSENT: a runner that hard-coded one of them would pass a
 *    single-record fixture.
 * 2. **No Submit.** The refusal is terminal and is never resumed, so an
 *    affordance that can only reach "No suspended run" is withdrawn — the same
 *    disposition a terminal failure already takes, reached by a different
 *    route.
 * 3. **No completion toast.** `toast.success` is asserted to have been called
 *    ZERO times, not merely "not with that sentence": the defect being fixed is
 *    a user who is told "this is refused" and then told the flow completed.
 *    `toast.error` is asserted zero too — a refusal is not a failure, and
 *    rendering it as one would be the opposite error.
 * 4. **`completed` is UNCHANGED.** The control, and the measurement the card
 *    asked to be re-taken on today's tree rather than inherited from the census
 *    that ran on the 17.2.0 pin: a message-only `screen` (`{title,
 *    description}`, no `fields`) renders Cancel + Submit, and submitting through
 *    to a terminal `completed` end toasts `Flow "…" completed` and calls
 *    `onComplete`. It is the lit control for pin 3 — the toast spies fire in
 *    this harness, so their silence above is a reading and not a dead sink.
 * 5. **`silent` still suppresses the invoking action's toast.** The part that
 *    already WORKS and must not be "fixed". Measured through the real
 *    `ActionRunner` post-execution sink, with a lit control: the identical
 *    action whose handler omits `silent` DOES toast its `successMessage`. The
 *    other half of that clause — that the console's flow handlers return
 *    `{ success: true, silent: true }` when a run pauses — is pinned by the
 *    test named 'flowHandler still OPENS the wizard on a screen pause (success
 *    path intact)' in `useConsoleActionRuntime.test.tsx`, and is deliberately
 *    not copied here.
 *
 * ## Reverse verification, direction predicted before running
 *
 * Removing the `refused` arm from `interpretFlowResponse` must turn pins 1–3
 * RED — a refused run falls back through to terminal success — while pins 4 and
 * 5 stay GREEN, because neither goes near that arm. The RED must NAME the
 * swallowed sentence rather than fail with "element not found", which would
 * read the same whether the message was dropped or the markup moved. Recorded
 * in the PR body with the real output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

const { FlowRunner } = await import('../FlowRunner');
type ScreenFlowState = import('../FlowRunner').ScreenFlowState;

import { ActionRunner, type ActionDef, type ActionResult } from '@object-ui/core';

/** The two records the fixture converts — the per-record text comes from these. */
const RECORDS = [
  { id: 'lead_1', name: 'Acme Corp' },
  { id: 'lead_2', name: 'Globex Inc' },
] as const;

/**
 * What the engine renders from the `end` node's
 * `message: 'Refused: {record.name} is a confirmed duplicate'`. Written as a
 * function of the record so the two fixtures cannot accidentally share a
 * sentence — that sharing is exactly what a single-record pin would miss.
 */
const refusalFor = (name: string) => `Refused: ${name} is a confirmed duplicate`;

/**
 * A message-only `screen` node: `{title, description}`, no `fields`. The card's
 * measured channel — today the only one that interpolates per-record text, and
 * the one that renders Submit at a user who is being refused.
 */
const noticeScreen = (name: string) => ({
  nodeId: 'screen_confirm',
  title: 'Convert lead',
  description: `Review before converting ${name}`,
  fields: [] as never[],
});

const stateFor = (name: string): ScreenFlowState => ({
  flowName: 'convert_lead',
  runId: `run_${name.replace(/\W+/g, '_').toLowerCase()}`,
  screen: noticeScreen(name),
});

/**
 * The resume response for a run that reached an `end` node declaring
 * `outcome: 'refused'`. Transcribed from `AutomationResult`'s own declaration:
 * `success` stays `true`, `successMessage` is absent, and the rendered text
 * rides `refusalMessage`.
 */
const refusedBody = (name: string) => ({
  success: true,
  data: { success: true, status: 'refused', refusalMessage: refusalFor(name) },
});

/** The unchanged arm: a terminal `completed` end with no declared message. */
const completedBody = { success: true, data: { success: true, status: 'completed' } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Radix's `DialogContent` renders its own dismiss `X` whose accessible name is
 * also "Close" (an `sr-only` span), so a bare role query finds two. The footer's
 * is the one whose label is VISIBLE — the affordance a sighted user reaches for.
 */
function footerCloseButton(): HTMLElement | undefined {
  return screen
    .getAllByRole('button', { name: 'Close' })
    .find((b) => b.querySelector('.sr-only') === null);
}

function mount(name: string, body: unknown) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const authFetch = vi.fn(async () => jsonResponse(body));
  const view = render(
    <FlowRunner state={stateFor(name)} authFetch={authFetch} baseUrl="" onClose={onClose} onComplete={onComplete} />,
  );
  return { onClose, onComplete, authFetch, view };
}

/** Submit the message-only screen — there are no fields to fill. */
async function submitNotice() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  return user;
}

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe('objectui#7707 — a refused end renders as a notice', () => {
  it('shows the sentence the engine rendered FOR THAT RECORD, for each of two records', async () => {
    for (const record of RECORDS) {
      const other = RECORDS.find((r) => r.name !== record.name)!;
      const { view } = mount(record.name, refusedBody(record.name));
      await submitNotice();

      // Queried by TEXT first: a role query would fail with "unable to find
      // role", which reads the same whether the sentence was swallowed or the
      // markup moved. The role is then asserted on the node that was found.
      await waitFor(() => expect(screen.getByText(refusalFor(record.name))).toBeInTheDocument());
      expect(screen.getByText(refusalFor(record.name)).closest('[role="alert"]')).not.toBeNull();
      // The other record's sentence must NOT be on screen — this is what makes
      // the pair a per-record measurement rather than two copies of one.
      expect(screen.queryByText(refusalFor(other.name))).not.toBeInTheDocument();

      view.unmount();
    }
  });

  it('withdraws Submit and offers Close only — the run is terminal and never resumed', async () => {
    const { authFetch } = mount(RECORDS[0].name, refusedBody(RECORDS[0].name));
    await submitNotice();

    await waitFor(() => expect(screen.getByText(refusalFor(RECORDS[0].name))).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(footerCloseButton()).toBeInTheDocument();
    // The one resume that was made is still the only one.
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('fires NO toast at all, and does not report the run complete', async () => {
    const { onComplete, onClose } = mount(RECORDS[0].name, refusedBody(RECORDS[0].name));
    await submitNotice();

    await waitFor(() => expect(screen.getByText(refusalFor(RECORDS[0].name))).toBeInTheDocument());
    // Not "not with that sentence" — zero. A green toast behind a refusal is
    // the defect; a red one would be the opposite error, since nothing failed.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    // The host is not told to refresh, and the notice stays up until the user
    // dismisses it.
    expect(onComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Convert lead')).toBeInTheDocument();
  });
});

describe('objectui#7707 — the lit control: a `completed` end is unchanged', () => {
  it('renders Cancel + Submit on the message-only screen, then toasts completion', async () => {
    const { onComplete } = mount(RECORDS[0].name, completedBody);

    // Before submitting: the affordances the card measured on the old pin.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();

    await submitNotice();

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Flow "convert_lead" completed');
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('objectui#7707 — `silent` is untouched: the invoking action stays quiet', () => {
  /** Mount the real post-execution toast sink with a `flow` handler double. */
  function mountRunner(result: ActionResult) {
    const toasts: Array<{ message: unknown; options?: { type?: string } }> = [];
    const runner = new ActionRunner({});
    runner.setToastHandler(((message: unknown, options?: { type?: string }) => {
      toasts.push({ message, options });
    }) as never);
    runner.registerHandler('flow', (async (): Promise<ActionResult> => result) as never);
    return { runner, toasts };
  }

  /** The action a record page dispatches to launch the flow. */
  const convertLead: ActionDef = {
    name: 'convert_lead',
    type: 'flow',
    target: 'convert_lead',
    successMessage: 'Lead converted.',
  } as ActionDef;

  it('a paused run returns silent, and the declared successMessage does not fire', async () => {
    // The value both console flow handlers return once the FlowRunner is open.
    const { runner, toasts } = mountRunner({ success: true, silent: true });

    const result = await runner.execute(convertLead);

    expect(result).toMatchObject({ success: true, silent: true });
    expect(toasts).toEqual([]);
  });

  it('LIT CONTROL — the same action without `silent` DOES toast its successMessage', async () => {
    const { runner, toasts } = mountRunner({ success: true });

    await runner.execute(convertLead);

    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Lead converted.');
  });
});
