/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12234 — a run launched by an action that declares a
 * `successMessage` completes with THAT message, not the flow-completed sentence.
 *
 * Reported on hosted HotCRM (zh-CN): the case actions 升级工单 / 关闭工单 /
 * 认领工单 pause on a screen, and on Submit the run completed with
 * 「流程「升级工单」已完成」 — the runner's terminal toast, which knew only the
 * flow's words. The action's own message had been held back at the pause
 * (`silent`, pinned by objectui#7707) and was never shown afterwards.
 *
 * What each pin is a fact about:
 *
 * 1. **The action's copy closes the run.** Handed over on
 *    `ScreenFlowState.actionSuccessMessage`, it is the terminal toast — and it
 *    wins over the flow's own `successMessage`, because it is what the same
 *    click shows when the run does not pause.
 * 2. **Only the TERMINAL toast moves.** A multi-step run still toasts the
 *    next-step notice between screens; a run that ends `refused` or fails after
 *    the pause still shows no success toast at all.
 * 3. **The controls keep today's toast.** No action copy (absent, blank, or an
 *    `I18nLabel` map no localizer resolved) ⇒ the flow's own message, else the
 *    catalog sentence — asserted in zh with the reported wording, so the
 *    control is the defect's own reading.
 *
 * `toast.success` is asserted by its full call list, never "was called with":
 * a runner that toasted BOTH sentences would pass a `toHaveBeenCalledWith`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@object-ui/react';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

const { FlowRunner } = await import('../FlowRunner');
type ScreenFlowState = import('../FlowRunner').ScreenFlowState;

const ACTION_MESSAGE = '工单已升级';
const FLOW_LABEL = '升级工单';

/** A message-only screen: no fields, so Submit resumes at once. */
const confirmScreen = (nodeId: string, title: string) => ({ nodeId, title, fields: [] as never[] });

const stateWith = (actionSuccessMessage?: unknown): ScreenFlowState => ({
  flowName: 'case_escalate',
  flowLabel: FLOW_LABEL,
  runId: 'run_1',
  screen: confirmScreen('screen_reason', '升级原因'),
  ...(actionSuccessMessage !== undefined ? { actionSuccessMessage: actionSuccessMessage as string } : {}),
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const completed = (extra: Record<string, unknown> = {}) =>
  jsonResponse({ success: true, data: { success: true, status: 'completed', flowLabel: FLOW_LABEL, ...extra } });

/** Mount under the real zh pack, so the catalog sentence is the reported one. */
function mount(state: ScreenFlowState, answers: Response[]) {
  const authFetch = vi.fn(async () => answers.shift() ?? completed());
  const onComplete = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
      <FlowRunner state={state} authFetch={authFetch} baseUrl="" onClose={vi.fn()} onComplete={onComplete} />
    </I18nProvider>,
  );
  return { authFetch, onComplete };
}

async function submit() {
  await userEvent.setup().click(await screen.findByRole('button', { name: '提交' }));
}

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("objectui#12234 — the invoking action's successMessage closes the run", () => {
  it("toasts the action's message at completion, and only that", async () => {
    const { onComplete } = mount(stateWith(ACTION_MESSAGE), [completed()]);
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([[ACTION_MESSAGE]]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("wins over the flow's own successMessage", async () => {
    const { onComplete } = mount(stateWith(ACTION_MESSAGE), [completed({ successMessage: 'Escalation recorded' })]);
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([[ACTION_MESSAGE]]);
  });

  it('a multi-step run keeps the next-step notice between screens and closes with the action message', async () => {
    const { onComplete } = mount(stateWith(ACTION_MESSAGE), [
      jsonResponse({
        success: true,
        data: { success: true, status: 'paused', runId: 'run_1', flowLabel: FLOW_LABEL, screen: confirmScreen('screen_confirm', '确认') },
      }),
      completed(),
    ]);
    await submit();
    await screen.findByRole('heading', { name: '确认' });
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['已保存 — 下一步'], [ACTION_MESSAGE]]);
  });

  it('a run that ends refused after the pause still shows no success toast', async () => {
    const { onComplete } = mount(stateWith(ACTION_MESSAGE), [
      jsonResponse({ success: true, data: { success: true, status: 'refused', refusalMessage: 'Refused: already escalated' } }),
    ]);
    await submit();

    expect(await screen.findByText('Refused: already escalated')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a run that fails after the pause shows the failure, never the action message', async () => {
    const { onComplete } = mount(stateWith(ACTION_MESSAGE), [
      jsonResponse({ success: true, data: { success: false, status: 'failed', error: 'Node exploded' } }),
    ]);
    await submit();

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('objectui#12234 — controls: with no usable action copy the toast is unchanged', () => {
  it('no action message ⇒ the reported flow-completed sentence', async () => {
    const { onComplete } = mount(stateWith(), [completed()]);
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['流程「升级工单」已完成']]);
  });

  it("no action message ⇒ the flow's own successMessage when it declares one", async () => {
    const { onComplete } = mount(stateWith(), [completed({ successMessage: 'Escalation recorded' })]);
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['Escalation recorded']]);
  });

  it('a blank action message counts as none', async () => {
    const { onComplete } = mount(stateWith('   '), [completed()]);
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['流程「升级工单」已完成']]);
  });

  it('an unresolved I18nLabel map counts as none (never handed to the toast as an object)', async () => {
    const { onComplete } = mount(stateWith({ en: 'Case escalated', 'zh-CN': '工单已升级' }), [completed()]);
    await submit();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls).toEqual([['流程「升级工单」已完成']]);
  });
});
