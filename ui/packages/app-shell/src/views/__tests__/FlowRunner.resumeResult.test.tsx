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

    // The catalog's sentence, never the engine's (objectstack#37526).
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Some values on this step weren't accepted."));
    expect(screen.getByRole('alert')).not.toHaveTextContent('discount must be a number');
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

/**
 * objectstack#36831 — a step the run already LEFT is never submitted again.
 *
 * HotCRM's two-step `quote_generation` (a details screen, then a result screen
 * declaring only the `quoteLink` record link) created the quote on Next, and
 * the dialog stayed on step one; the next Next sent step one's three values to
 * the result screen, and the engine refused them with its own English
 * sentence, field names and all.
 *
 * Reproduced against the runner as it stood: the console does not double
 * submit (Next is disabled while the resume is in flight, and the shared
 * authenticated fetch never retries), and a `paused` answer DOES move the
 * dialog to the next screen. The hole is the answer that never arrives intact
 * — a gateway timeout, or a connection dropped, while the server finishes the
 * resume. The runner read every such answer as "the suspension was not
 * consumed" and kept step one with Next live, so the user's next press resent
 * step one to whatever screen the run had moved on to.
 *
 * So a resume whose outcome the runner cannot know, or that the engine refused
 * as retryable, re-reads where the run actually is through the paused-screen
 * read (`GET .../runs/RUN/screen`) before offering a retry. Another screen
 * there: the dialog shows it, with a readable notice and no engine sentence.
 * No screen at all: the run is not waiting on this dialog any more, so Next is
 * withdrawn. The same screen: a real retry, kept exactly as before.
 */
describe('objectstack#36831 — a step the run already left is never submitted again', () => {
  type Spec = import('../FlowRunner').ScreenSpec;

  const QUOTE_DETAILS: Spec = {
    nodeId: 'screen_1',
    title: 'Quote Details',
    fields: [
      { name: 'quoteName', label: 'Quote Name', type: 'text', required: true, defaultValue: 'Acme renewal' },
      { name: 'expirationDays', label: 'Valid For (Days)', type: 'number', required: true, defaultValue: 30, min: 1 },
      { name: 'discount', label: 'Discount %', type: 'number', defaultValue: 0, min: 0, max: 20 },
    ],
    progress: { nextScreen: 'certain', step: 1, stepCount: 2 },
  };
  const QUOTE_CREATED: Spec = {
    nodeId: 'result',
    title: 'Quote Created',
    fields: [{ name: 'quoteLink', label: 'Quote', type: 'record_link', reference: 'crm_quote', defaultValue: 'quo_1' }],
    progress: { nextScreen: 'none', step: 2, stepCount: 2 },
  };
  const RUN = 'run_9c1';
  const TWO_STEP: ScreenFlowState = { flowName: 'quote_generation', runId: RUN, screen: QUOTE_DETAILS };

  /** The engine's refusal of step one's bag against the result screen, as the card quotes it. */
  const ENGINE_SENTENCE =
    'Invalid screen input: Unknown screen field "quoteName" — not declared on this screen; '
    + 'Unknown screen field "expirationDays" — not declared on this screen; '
    + 'Unknown screen field "discount" — not declared on this screen — declared fields: \'quoteLink\'';

  const ALREADY_SUBMITTED = 'Your previous submission went through. The flow has moved on to this step.';
  const NO_LONGER_WAITING = 'This step may already have been processed. Close this dialog and check the record before trying again.';

  /**
   * The run behind the two doors the runner calls, as the engine keeps it: a
   * resume whose values this screen declares advances the run (the quote is
   * written, the run pauses on `result`, or ends after it); a bag naming a
   * field the paused screen does not declare is refused `400
   * INVALID_SCREEN_INPUT` and moves nothing. `firstAnswer` replaces only what
   * the BROWSER receives for the first resume — the server has done the work.
   * `GET .../screen` answers the screen the run waits on, or `404` once it
   * waits on none, exactly as the route does.
   */
  function twoStepRun(options: { firstAnswer?: () => Promise<Response>; startAt?: Spec | null; afterResult?: Spec | null } = {}) {
    let at: Spec | null = options.startAt === undefined ? QUOTE_DETAILS : options.startAt;
    let resumed = 0;
    const posted: Array<Record<string, unknown>> = [];
    const authFetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === `/api/v1/automation/quote_generation/runs/${RUN}/screen` && (init?.method ?? 'GET') === 'GET') {
        return at
          ? jsonResponse({ success: true, data: { runId: RUN, screen: at } })
          : jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'No pending screen for run', httpStatus: 404 } }, 404);
      }
      if (url === `/api/v1/automation/quote_generation/runs/${RUN}/resume` && init?.method === 'POST') {
        const inputs = JSON.parse(String(init.body)).inputs as Record<string, unknown>;
        posted.push(inputs);
        const declared = (at?.fields ?? []).filter((f) => f.type !== 'record_link').map((f) => f.name);
        if (!at || Object.keys(inputs).some((k) => !declared.includes(k))) {
          return jsonResponse({ success: false, error: { code: 'INVALID_SCREEN_INPUT', message: ENGINE_SENTENCE, httpStatus: 400 } }, 400);
        }
        at = at.nodeId === 'screen_1' ? (options.afterResult === undefined ? QUOTE_CREATED : options.afterResult) : null;
        resumed += 1;
        if (resumed === 1 && options.firstAnswer) return options.firstAnswer();
        return at
          ? jsonResponse({ success: true, data: { success: true, status: 'paused', runId: RUN, screen: at } })
          : jsonResponse({ success: true, data: { success: true, status: 'completed' } });
      }
      throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`);
    });
    return { authFetch, posted };
  }

  const gatewayTimeout = async () =>
    new Response('504 Gateway Time-out', { status: 504, headers: { 'Content-Type': 'text/html' } });
  const droppedConnection = async (): Promise<Response> => { throw new TypeError('Failed to fetch'); };

  function renderRun(authFetch: (url: string, init?: RequestInit) => Promise<Response>, language?: string) {
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const runner = (
      <FlowRunner
        state={TWO_STEP}
        authFetch={authFetch}
        baseUrl=""
        onClose={onClose}
        onComplete={onComplete}
        dataSource={{
          find: vi.fn(async () => ({ data: [] })),
          findOne: vi.fn(async (_object: string, id: string) => ({ id, name: id })),
          getObjectSchema: vi.fn(async (object: string) => ({ name: object, nameField: 'name', fields: { name: { type: 'text' } } })),
        }}
        objects={[{ name: 'crm_quote' }]}
      />
    );
    render(language
      ? <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>{runner}</I18nProvider>
      : runner);
    return { onClose, onComplete };
  }

  /** Nothing the user can read carries the engine's sentence: not the dialog, not a toast. */
  function expectNoEngineSentence() {
    expect(screen.queryByText(/Invalid screen input/)).toBeNull();
    expect(toastError.mock.calls.flat().join('\n')).not.toMatch(/Invalid screen input|quoteName/);
  }

  it('a gateway timeout on step one, after the run moved on, shows the result screen instead of step one', async () => {
    const { authFetch, posted } = twoStepRun({ firstAnswer: gatewayTimeout });
    renderRun(authFetch);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Quote Created')).toBeInTheDocument();
    expect(screen.getByText(ALREADY_SUBMITTED)).toBeInTheDocument();
    expect(screen.queryByText('Quote Details')).toBeNull();
    // Step one went out once, and nothing on screen offers to send it again.
    expect(posted).toEqual([{ quoteName: 'Acme renewal', expirationDays: 30, discount: 0 }]);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a dropped connection on step one, after the run moved on, shows the result screen too', async () => {
    const { authFetch, posted } = twoStepRun({ firstAnswer: droppedConnection });
    renderRun(authFetch);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Quote Created')).toBeInTheDocument();
    expect(screen.getByText(ALREADY_SUBMITTED)).toBeInTheDocument();
    expect(posted).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('a stale step-one submit is answered with the step the run is on and a readable notice, never the engine sentence', async () => {
    // The run already waits on the result screen while the dialog still shows step one.
    const { authFetch, posted } = twoStepRun({ startAt: QUOTE_CREATED });
    renderRun(authFetch);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Quote Created')).toBeInTheDocument();
    expect(screen.getByText(ALREADY_SUBMITTED)).toBeInTheDocument();
    expectNoEngineSentence();
    expect(posted).toHaveLength(1);
    // Done completes the run from the screen it really waits on.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual({});
  });

  it('reads that notice in the display language', async () => {
    const { authFetch } = twoStepRun({ startAt: QUOTE_CREATED });
    renderRun(authFetch, 'zh');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByText('Quote Created')).toBeInTheDocument();
    expect(screen.getByText('上一步已提交成功，流程已进入当前步骤。')).toBeInTheDocument();
    expectNoEngineSentence();
  });

  it('a run that waits on no screen any more withdraws Next and says why, in words', async () => {
    // The run ended after step one; its answer was lost on the way back.
    const { authFetch, posted } = twoStepRun({ firstAnswer: gatewayTimeout, afterResult: null });
    renderRun(authFetch);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(NO_LONGER_WAITING)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(footerCloseButton()).toBeInTheDocument();
    expect(posted).toHaveLength(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a refusal from the screen the run still waits on keeps a refusal banner and Next — a real retry', async () => {
    const BAD_INPUT = 'Invalid screen input: Valid For (Days) must be at least 1 — declared fields: \'quoteName\', \'expirationDays\', \'discount\'';
    const authFetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/screen')) return jsonResponse({ success: true, data: { runId: RUN, screen: QUOTE_DETAILS } });
      if (init?.method === 'POST') {
        return jsonResponse({ success: false, error: { code: 'INVALID_SCREEN_INPUT', message: BAD_INPUT, httpStatus: 400 } }, 400);
      }
      throw new Error(`unexpected request ${url}`);
    });
    renderRun(authFetch);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // The refusal banner is the catalog's sentence, never the engine's, which
    // names the screen's API field names (objectstack#37526).
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Some values on this step weren't accepted."));
    expect(screen.getByRole('alert')).not.toHaveTextContent('declared fields');
    expect(screen.getByText('Quote Details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.queryByText(ALREADY_SUBMITTED)).toBeNull();
  });
});
