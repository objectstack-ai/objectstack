// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37526 — a required text field holding only spaces is refused at
 * the field, and an engine screen refusal reaches the user in their language,
 * at the field it names, by its label.
 *
 * Measured on 18.6.0 (zh-CN console, HotCRM Close Case): three spaces in the
 * required Resolution passed the dialog's check, the engine trimmed and
 * refused, and the dialog showed the engine's sentence verbatim — English, and
 * listing the screen's API field names:
 * `Invalid screen input: Screen field "resolution" is required — declared fields: 'resolution', 'resolved_by_article'`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@object-ui/react';
import { FlowRunner, isUnanswered, type ScreenFlowState } from '../FlowRunner';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** HotCRM's Close Case screen. */
const CLOSE_CASE: ScreenFlowState = {
  flowName: 'close_case',
  runId: 'run-1',
  screen: {
    nodeId: 'resolve',
    title: 'Close Case',
    fields: [
      { name: 'resolution', label: 'Resolution', type: 'text', required: true },
      { name: 'resolved_by_article', label: 'Resolved by article', type: 'text' },
      { name: 'hours', label: 'Hours', type: 'number', min: 0 },
    ],
  },
};

const ENGINE_SENTENCE =
  'Invalid screen input: Screen field "resolution" is required — declared fields: '
  + "'resolution', 'resolved_by_article', 'hours'";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The resume door refusing with `details` as given, and the run still waiting on this screen. */
function refusingDoor(details: unknown) {
  return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/screen')) return jsonResponse({ success: true, data: { runId: 'run-1', screen: CLOSE_CASE.screen } });
    if (init?.method === 'POST') {
      return jsonResponse(
        { success: false, error: { code: 'INVALID_SCREEN_INPUT', message: ENGINE_SENTENCE, httpStatus: 400, ...(details ? { details } : {}) } },
        400,
      );
    }
    throw new Error(`unexpected request ${url}`);
  });
}

function setup(authFetch: (url: string, init?: RequestInit) => Promise<Response>, language: string) {
  const onComplete = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <FlowRunner state={CLOSE_CASE} authFetch={authFetch} baseUrl="" onClose={vi.fn()} onComplete={onComplete} />
    </I18nProvider>,
  );
  return { onComplete };
}

function describedByIds(el: HTMLElement): string[] {
  return (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
}

beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
});

describe('objectstack#37526 — whitespace is no answer to a required field', () => {
  it('isUnanswered: spaces, tabs and newlines are no answer; text with spaces around it, 0 and false are', () => {
    expect(isUnanswered(undefined)).toBe(true);
    expect(isUnanswered(null)).toBe(true);
    expect(isUnanswered('')).toBe(true);
    expect(isUnanswered('   ')).toBe(true);
    expect(isUnanswered(' \t\n ')).toBe(true);
    expect(isUnanswered('  ok  ')).toBe(false);
    expect(isUnanswered(0)).toBe(false);
    expect(isUnanswered(false)).toBe(false);
  });

  it('three spaces are refused at the field, with the empty field\'s message, and nothing is sent', async () => {
    const user = userEvent.setup();
    const authFetch = vi.fn(async () => jsonResponse({ success: true, data: { success: true } }));
    setup(authFetch, 'en');
    const resolution = screen.getByRole('textbox', { name: 'Resolution' });

    await user.type(resolution, '   ');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    const message = await screen.findByText('Resolution is required');
    expect(resolution).toHaveAttribute('aria-invalid', 'true');
    expect(describedByIds(resolution)).toContain(message.id);
    expect(resolution).toHaveFocus();
    expect(authFetch).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('in zh-CN the message is the display locale\'s', async () => {
    const user = userEvent.setup();
    const authFetch = vi.fn(async () => jsonResponse({ success: true, data: { success: true } }));
    setup(authFetch, 'zh');
    const resolution = screen.getByRole('textbox', { name: 'Resolution' });

    await user.type(resolution, '   ');
    await user.click(screen.getByRole('button', { name: '提交' }));

    await waitFor(() => expect(resolution).toHaveAttribute('aria-invalid', 'true'));
    const message = document.getElementById(describedByIds(resolution)[0]);
    expect(message?.textContent).toContain('Resolution');
    expect(message?.textContent).not.toBe('Resolution is required');
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe('objectstack#37526 — an engine screen refusal is placed at its fields', () => {
  it('each finding goes under its field by label; the banner is the catalog\'s sentence, not the engine\'s', async () => {
    const user = userEvent.setup();
    const authFetch = refusingDoor({
      fields: [
        { field: 'resolution', code: 'required', message: 'Screen field "resolution" is required' },
        { field: 'hours', code: 'min_value', message: 'Screen field "hours" must be at least 0' },
        { field: 'nickname', code: 'unknown_field', message: 'Unknown screen field "nickname"' },
      ],
    });
    setup(authFetch, 'en');
    // A value the dialog accepts and the engine does not: the dialog's own
    // checks are courtesies, and the engine's refusal is the enforcement.
    await user.type(screen.getByRole('textbox', { name: 'Resolution' }), 'Fixed');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Some values on this step weren't accepted."));
    expect(screen.getByRole('alert')).not.toHaveTextContent('declared fields');
    expect(screen.queryByText(/resolved_by_article/)).toBeNull();
    expect(toasts.error).toHaveBeenCalledWith("Some values on this step weren't accepted. Check them and try again.");

    const resolution = screen.getByRole('textbox', { name: 'Resolution' });
    expect(resolution).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(describedByIds(resolution)[0])?.textContent).toBe('Resolution is required');
    expect(resolution).toHaveFocus();
    const hours = screen.getByRole('spinbutton', { name: 'Hours' });
    expect(hours).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(describedByIds(hours)[0])?.textContent).toBe('Hours must be at least 0');
    // A field the engine did not name is not marked; one not on screen is not placed.
    expect(screen.getByRole('textbox', { name: 'Resolved by article' })).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('in zh-CN the banner and the field message are Chinese', async () => {
    const user = userEvent.setup();
    const authFetch = refusingDoor({
      fields: [{ field: 'resolution', code: 'invalid_type', message: 'Screen field "resolution" must be a string' }],
    });
    setup(authFetch, 'zh');
    await user.type(screen.getByRole('textbox', { name: 'Resolution' }), 'Fixed');
    await user.click(screen.getByRole('button', { name: '提交' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('这一步有些值未被接受'));
    const resolution = screen.getByRole('textbox', { name: 'Resolution' });
    expect(document.getElementById(describedByIds(resolution)[0])?.textContent).toBe('Resolution：此值不被接受');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Invalid screen input');
  });

  it('a server that serves no findings still gets the catalog\'s sentence, and no field is marked', async () => {
    const user = userEvent.setup();
    setup(refusingDoor(undefined), 'en');
    await user.type(screen.getByRole('textbox', { name: 'Resolution' }), 'Fixed');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Some values on this step weren't accepted."));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Invalid screen input');
    expect(screen.getByRole('textbox', { name: 'Resolution' })).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('editing the field retires its message, and the corrected resubmit completes', async () => {
    const user = userEvent.setup();
    let refused = false;
    const authFetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/screen')) return jsonResponse({ success: true, data: { runId: 'run-1', screen: CLOSE_CASE.screen } });
      if (init?.method === 'POST' && !refused) {
        refused = true;
        return jsonResponse({
          success: false,
          error: {
            code: 'INVALID_SCREEN_INPUT',
            message: ENGINE_SENTENCE,
            httpStatus: 400,
            details: { fields: [{ field: 'resolution', code: 'required', message: 'x' }] },
          },
        }, 400);
      }
      return jsonResponse({ success: true, data: { success: true } });
    });
    const { onComplete } = setup(authFetch, 'en');
    const resolution = screen.getByRole('textbox', { name: 'Resolution' });
    await user.type(resolution, 'Fixed');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Resolution is required');

    await user.type(resolution, ' it');
    expect(screen.queryByText('Resolution is required')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
