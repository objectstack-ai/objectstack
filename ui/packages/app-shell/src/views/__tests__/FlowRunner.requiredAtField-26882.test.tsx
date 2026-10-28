// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26882 — the screen-flow dialog refuses an empty required field AT
 * the field, and a retryable engine refusal keeps the screen, its values and
 * Submit.
 *
 * Measured on `main` before the change, with this file's `FOLLOW_UP` screen:
 * Submit with the required Due Date left empty made no resume request and
 * raised one toast ("Please complete the required fields: Due Date"), and
 * nothing else — no message in the dialog, no `aria-invalid` on any control.
 * So an untouched date is empty to the check (no request left the dialog); what
 * was missing is a refusal the user can see where they are looking. The record
 * form's answer is the one asserted here: the message under the control, the
 * control marked invalid and described by it, focus on the first missing field,
 * Submit still offered, and no toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@object-ui/react';
// Module scope, per AGENTS.md 测试纪律: the date arm reaches its picker through
// a `React.lazy` factory inside `@object-ui/fields`.
import '@object-ui/fields';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** The card's screen: HotCRM's Schedule Follow-up, a required text and a required date. */
const FOLLOW_UP: ScreenFlowState = {
  flowName: 'schedule_followup',
  runId: 'run-1',
  screen: {
    nodeId: 'screen_1',
    title: 'Schedule Follow-up',
    fields: [
      { name: 'nextStep', label: 'Next Step', type: 'text', required: true },
      { name: 'dueDate', label: 'Due Date', type: 'date', required: true },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const okResume = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, data: { success: true } }));

function setup(
  authFetch: ReturnType<typeof okResume>,
  { state = FOLLOW_UP, language }: { state?: ScreenFlowState; language?: string } = {},
) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const runner = <FlowRunner state={state} authFetch={authFetch} baseUrl="" onClose={onClose} onComplete={onComplete} />;
  render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {runner}
      </I18nProvider>
    ) : (
      runner
    ),
  );
  return { onClose, onComplete };
}

/** The ids a control's `aria-describedby` names. */
function describedByIds(el: HTMLElement): string[] {
  return (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
}

beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
});

describe('objectstack#26882 — an empty required field is refused at the field', () => {
  it('an empty required date: message under it, aria-invalid, focus, Submit live, no request, no toast', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    setup(authFetch, { language: 'en' });
    const due = await screen.findByRole('textbox', { name: 'Due Date' });

    await user.type(screen.getByRole('textbox', { name: 'Next Step' }), 'Call back');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // Queried by its text first, so a missing message fails naming the sentence.
    const message = await screen.findByText('Due Date is required');
    expect(due).toHaveAttribute('aria-invalid', 'true');
    expect(describedByIds(due)).toContain(message.id);
    expect(due).toHaveFocus();
    // The field that was answered is not marked.
    expect(screen.getByRole('textbox', { name: 'Next Step' })).not.toHaveAttribute('aria-invalid', 'true');
    // Submit is still offered, and nothing left the dialog.
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(authFetch).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('every missing field carries its own message, and focus goes to the first in screen order', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    setup(authFetch, { language: 'en' });
    await screen.findByRole('textbox', { name: 'Due Date' });

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await screen.findByText('Next Step is required');
    expect(screen.getByText('Due Date is required')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Next Step' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Next Step' })).toHaveAttribute('aria-invalid', 'true');
    // An optional field left empty is not refused.
    expect(screen.getByRole('textbox', { name: 'Notes' })).not.toHaveAttribute('aria-invalid');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('answering a field retires its message, and the next Submit resumes', async () => {
    const user = userEvent.setup();
    const authFetch = okResume();
    const { onComplete } = setup(authFetch, {
      language: 'en',
      state: {
        ...FOLLOW_UP,
        screen: { ...FOLLOW_UP.screen, fields: [FOLLOW_UP.screen.fields![0]] },
      },
    });
    const nextStep = screen.getByRole('textbox', { name: 'Next Step' });

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Next Step is required');

    await user.type(nextStep, 'Call back');
    expect(screen.queryByText('Next Step is required')).not.toBeInTheDocument();
    expect(nextStep).not.toHaveAttribute('aria-invalid');
    expect(describedByIds(nextStep)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(authFetch.mock.calls[0][1]?.body)).inputs).toEqual({ nextStep: 'Call back' });
  });

  it('the message is the display locale\'s, naming the field by its label', async () => {
    const user = userEvent.setup();
    setup(okResume(), {
      language: 'zh',
      state: { ...FOLLOW_UP, screen: { ...FOLLOW_UP.screen, fields: [FOLLOW_UP.screen.fields![0]] } },
    });

    await user.click(screen.getByRole('button', { name: '提交' }));

    const field = screen.getByRole('textbox', { name: 'Next Step' });
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    const message = document.getElementById(describedByIds(field)[0]);
    expect(message?.textContent).toContain('Next Step');
    expect(message?.textContent).not.toBe('Next Step is required');
  });
});

describe('objectstack#26882 — a retryable engine refusal keeps the screen, its values and Submit', () => {
  // `INVALID_SCREEN_INPUT` is refused before the engine consumes the
  // suspension, so the same run takes a corrected resubmit.
  const RETRYABLE_400 = {
    success: false,
    error: { code: 'INVALID_SCREEN_INPUT', message: 'Invalid screen input: dueDate must be a date', httpStatus: 400 },
  };

  it('the typed values stay, the sentence is shown, and Submit resubmits the same run', async () => {
    const user = userEvent.setup();
    const authFetch = vi
      .fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, data: { success: true } }))
      .mockResolvedValueOnce(jsonResponse(RETRYABLE_400, 400));
    const { onClose, onComplete } = setup(authFetch, {
      language: 'en',
      state: { ...FOLLOW_UP, screen: { ...FOLLOW_UP.screen, fields: [FOLLOW_UP.screen.fields![0], FOLLOW_UP.screen.fields![2]] } },
    });

    await user.type(screen.getByRole('textbox', { name: 'Next Step' }), 'Call back');
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Asked for Tuesday');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('dueDate must be a date'));
    expect(screen.getByRole('textbox', { name: 'Next Step' })).toHaveValue('Call back');
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Asked for Tuesday');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(authFetch.mock.calls[1][0]).toBe(authFetch.mock.calls[0][0]);
    expect(JSON.parse(String(authFetch.mock.calls[1][1]?.body)).inputs).toEqual({
      nextStep: 'Call back',
      notes: 'Asked for Tuesday',
    });
  });
});
