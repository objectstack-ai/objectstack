/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The resume RESULT reaches the user — objectui#5417.
 *
 * ## What was measured, and what of it survived triage
 *
 * The card reports that on `17.1.0` a `400 FLOW_FAILED` and a successful run
 * "render identically: the dialog closes and the page is unchanged". Re-measured
 * against `main` before writing a line (probe run, 2026-08-20), one half of that
 * was already gone: `interpretFlowResponse` reads the ADR-0112 envelope, and the
 * `toast.error` in `resumeWith` has carried its prose since #4899 — which shipped
 * in `17.6.0`, five minors AFTER the version the card was measured on. So the
 * premise "all of it is discarded at the client" is no longer true, and there is
 * no interpreter bug and no fourth un-consolidated call site to fix.
 *
 * Three things the card asks for were still missing, and this file pins them.
 * Every one is a fact about the RUNNER's disposition, which is why none of them
 * belongs in `flowResponse.ts` — that module's verdict was already correct.
 *
 * ## 1. A terminal failure took the user's input with it
 *
 * `retryable === false` used to mean `onClose()`. The reasoning behind it holds
 * and is not reversed here: the engine consumes the suspension before running
 * downstream nodes, so a resubmit of that run can only reach "No suspended run".
 * But *closing* is not the only way to withhold a dead retry, and it is the one
 * that costs the most: the user has just typed a form they can no longer see,
 * and the engine's sentence names a value that left the screen with it. The
 * dialog now stays open with Submit withdrawn — no dead retry is offered, and
 * the input and the reason stay on screen together.
 *
 * ## 2. The message had exactly one carrier, and it was the transient one
 *
 * A toast is viewport-fixed (so it survives a tall `object-form` step scrolled
 * past its own header) but it also expires. Both carriers are asserted here,
 * because dropping either one re-opens a reported failure mode.
 *
 * ## 3. Success invalidated the object the user was LOOKING at, never the one
 *    the flow WROTE
 *
 * Both hosts answer `onComplete` with
 * `notifyDataChanged({ objectName: <this page's object> })`. The reported run
 * created a `crm_quote` from an Opportunity page, so the related list that would
 * now hold it was never told and the quote did not appear until a manual reload.
 * The runner cannot know which objects a flow touched, so it emits `'*'` —
 * `dataChangeMatches` short-circuits true for it, which is precisely "treat
 * everything mounted as stale". Asserted over the REAL bus
 * (`subscribeDataChanges`) rather than a module mock, so the assertion is about
 * what readers receive and not about which function was called.
 *
 * ## Reverse verification, direction predicted before running
 *
 * Reverting `FlowRunner.tsx` to its committed parent must turn these RED, and
 * the RED must NAME the swallowed sentence — an assertion that fails with a
 * generic "element not found" would not distinguish "the message is missing"
 * from "the dialog moved". Recorded in the PR body with the real output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider, subscribeDataChanges, type DataChange } from '@object-ui/react';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

const { FlowRunner } = await import('../FlowRunner');
type ScreenFlowState = import('../FlowRunner').ScreenFlowState;

const STATE: ScreenFlowState = {
  flowName: 'quote_generation',
  runId: 'run_0b47',
  screen: {
    nodeId: 'screen_1',
    title: 'Quote inputs',
    fields: [{ name: 'discount', label: 'Discount', type: 'text', required: true }],
  },
};

/**
 * The card's wire payload, transcribed rather than paraphrased: this is the
 * exact envelope the dogfood run captured, down to the per-node summary that
 * `errorEnvelopeDetails` has to walk past without finding an `errorMessage`.
 */
const FLOW_FAILED_MESSAGE =
  "Node 'create_quote' failed: create_record(crm_quote) failed: Total Price must have at most 2 decimal places (got 11)";
const FLOW_FAILED_400 = {
  success: false,
  error: {
    code: 'FLOW_FAILED',
    message: FLOW_FAILED_MESSAGE,
    httpStatus: 400,
    details: {
      summary: {
        selected: 1,
        acted: 0,
        skipped: 0,
        nodes: [
          { nodeId: 'start', nodeType: 'start', status: 'success', runs: 1 },
          { nodeId: 'screen_1', nodeType: 'screen', status: 'success', runs: 1 },
          { nodeId: 'get_opportunity', nodeType: 'get_record', status: 'success', runs: 1 },
          { nodeId: 'create_quote', nodeType: 'create_record', status: 'failure', runs: 1, failures: 1 },
        ],
      },
    },
  },
};

/**
 * Radix's `DialogContent` renders its OWN dismiss `X`, and its accessible name
 * is also "Close" (an `sr-only` span). So a bare `getByRole('button', { name:
 * 'Close' })` finds two and throws. The footer's button is the one whose label
 * is VISIBLE — that is the affordance a sighted user reaches for, and the one
 * these tests are about.
 */
function footerCloseButton(): HTMLElement | undefined {
  return screen
    .getAllByRole('button', { name: 'Close' })
    .find((b) => b.querySelector('.sr-only') === null);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(authFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  render(<FlowRunner state={STATE} authFetch={authFetch} baseUrl="" onClose={onClose} onComplete={onComplete} />);
  return { onClose, onComplete };
}

async function fillAndSubmit(value = '0.115', submitLabel = 'Submit') {
  const user = userEvent.setup();
  await user.type(screen.getAllByRole('textbox')[0], value);
  await user.click(screen.getByRole('button', { name: submitLabel }));
  return user;
}

/** Same render, wrapped in the real i18next instance for a given locale. */
function renderWithLocale(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
  defaultLanguage: string,
) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage, detectBrowserLanguage: false }} persistLanguage={false}>
      <FlowRunner state={STATE} authFetch={authFetch} baseUrl="" onClose={onClose} onComplete={onComplete} />
    </I18nProvider>,
  );
  return { onClose, onComplete };
}

let changes: DataChange[] = [];
let unsubscribe: (() => void) | undefined;

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
  changes = [];
  unsubscribe = subscribeDataChanges((c) => { changes.push(c); });
});
afterEach(() => { unsubscribe?.(); });

describe('#5417 — a refused resume is readable, and keeps the input', () => {
  it('shows the engine sentence inline AND as a toast', async () => {
    const authFetch = vi.fn(async () => jsonResponse(FLOW_FAILED_400, 400));
    setup(authFetch);
    await fillAndSubmit();

    // Queried by TEXT first, on purpose. `getByRole('alert')` would fail with
    // "unable to find role alert", which reads the same whether the sentence was
    // dropped or the markup moved; querying the sentence makes the reverse
    // verification NAME what went missing. The role is then asserted on the node
    // that was found, so the announcement is still pinned.
    await waitFor(() => expect(screen.getByText(FLOW_FAILED_MESSAGE)).toBeInTheDocument());
    expect(screen.getByText(FLOW_FAILED_MESSAGE).closest('[role="alert"]')).not.toBeNull();
    // Toast: the carrier that survives a scrolled-away dialog header.
    expect(toastError).toHaveBeenCalledWith(FLOW_FAILED_MESSAGE);
  });

  it('keeps the dialog open with the typed input intact', async () => {
    const authFetch = vi.fn(async () => jsonResponse(FLOW_FAILED_400, 400));
    const { onClose, onComplete } = setup(authFetch);
    await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Quote inputs')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('0.115');
    expect(onClose).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('withdraws Submit, because the suspension is already consumed', async () => {
    const authFetch = vi.fn(async () => jsonResponse(FLOW_FAILED_400, 400));
    setup(authFetch);
    await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // No dead retry is on offer…
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    // …and the one request that was made is still the only one.
    expect(authFetch).toHaveBeenCalledTimes(1);
    // The way out is explicit rather than implied.
    expect(footerCloseButton()).toBeInTheDocument();
  });

  it('keeps the terminal banner up while the user edits — there is nothing to re-submit', async () => {
    const authFetch = vi.fn(async () => jsonResponse(FLOW_FAILED_400, 400));
    setup(authFetch);
    const user = await fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    await user.type(screen.getAllByRole('textbox')[0], '2');
    // Clearing it here would remove the only explanation for the missing Submit.
    expect(screen.getByRole('alert')).toHaveTextContent(FLOW_FAILED_MESSAGE);
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });
});

describe('#5417 — a RETRYABLE refusal still offers the retry', () => {
  // `INVALID_SCREEN_INPUT` is refused before the signal reaches the variable
  // map, so the suspension survives and a corrected resubmit is meaningful.
  // This is the arm the terminal disposition must not swallow.
  const RETRYABLE_400 = {
    success: false,
    error: { code: 'INVALID_SCREEN_INPUT', message: 'discount must be a number', httpStatus: 400 },
  };

  it('surfaces the message and leaves Submit live', async () => {
    const authFetch = vi.fn(async () => jsonResponse(RETRYABLE_400, 400));
    const { onClose } = setup(authFetch);
    await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('discount must be a number'));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears the banner once the user starts fixing the input', async () => {
    const authFetch = vi.fn(async () => jsonResponse(RETRYABLE_400, 400));
    setup(authFetch);
    const user = await fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    await user.type(screen.getAllByRole('textbox')[0], '9');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('#5417 — a successful run is visible on the page it wrote to', () => {
  it('invalidates every mounted reader, not just the host record', async () => {
    const authFetch = vi.fn(async () => jsonResponse({ success: true, data: { success: true, status: 'completed' } }));
    const { onComplete } = setup(authFetch);
    await fillAndSubmit('0.10');

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    // `'*'` is the scope, and it is load-bearing: a related list showing the
    // `crm_quote` this flow just created subscribes to `crm_quote`, an object
    // this component has no way to name.
    expect(changes).toEqual([{ objectName: '*', recordId: undefined }]);
  });

  it('announces completion with the flow-declared message when there is one', async () => {
    const authFetch = vi.fn(async () =>
      jsonResponse({ success: true, data: { success: true, successMessage: 'Quote QTE-0006 created' } }),
    );
    setup(authFetch);
    await fillAndSubmit('0.10');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Quote QTE-0006 created'));
  });

  // These two mount the REAL provider on purpose. Provider-less, react-i18next
  // hands back the call site's `defaultValue` verbatim and never interpolates —
  // so a provider-less assertion here would pass on a component carrying no
  // `flowRunner.completed` key at all, and would read a literal `{{flow}}` as
  // success. With the provider the key has to resolve out of the pack and the
  // hole has to be filled; the `zh` case then shows the copy is genuinely
  // localized rather than English hiding behind a key — objectui#5417 asks it
  // to match the console's `服务案例创建成功` / `对象「…」已存为草稿` idiom.
  it('falls back to the en pack value, with the flow name filled in', async () => {
    const authFetch = vi.fn(async () => jsonResponse({ success: true, data: { success: true } }));
    renderWithLocale(authFetch, 'en');
    await fillAndSubmit('0.10', 'Submit');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['Flow "quote_generation" completed']]);
  });

  it('renders that fallback in the display locale, not in English', async () => {
    const authFetch = vi.fn(async () => jsonResponse({ success: true, data: { success: true } }));
    renderWithLocale(authFetch, 'zh');
    await fillAndSubmit('0.10', '提交');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['流程「quote_generation」已完成']]);
  });
});
