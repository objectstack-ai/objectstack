// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The screen-flow runner reads the three `flows` translation keys
 * objectstack#22507 published (objectui#12075):
 *
 *   - `flows.FLOW.screens.NODE.fields.FIELD.options.VALUE` — a screen field's
 *     option label, overlaid by the spec's `resolveFlowScreenFieldOptions`;
 *   - `flows.FLOW.successMessage` — the flow's own completion toast;
 *   - `flows.FLOW.errorMessage` — the flow's own failure toast.
 *
 * The bundle reaches the runner the way every other translated console
 * surface gets it — the server's `TranslationData` payload through
 * `transformSpecTranslations`, added with the provider's `addResourceBundle`
 * call — so a green run is a statement about that channel, as in the
 * objectui#5920 suite beside this one.
 *
 * And one measurement the card asked for: a select whose options carry a
 * NUMBER or BOOLEAN value used to hand the resume the option's value read as
 * text, because the select addresses each item by `String(value)`. The pins
 * at the bottom read the resume body itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createI18n, I18nProvider, isSpecTranslationData, transformSpecTranslations } from '@object-ui/i18n';
import type { TranslationData } from '@objectstack/spec/system';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** A paused case-escalation run whose screen asks for a priority and a reason. */
const ESCALATION: ScreenFlowState = {
  flowName: 'case_escalate',
  runId: 'run-7',
  screen: {
    nodeId: 'pick',
    title: 'Escalate the case',
    fields: [
      {
        name: 'tier',
        label: 'Tier',
        type: 'select',
        options: [
          { value: 1, label: 'First line' },
          { value: 2, label: 'Second line' },
          { value: 3, label: 'Engineering' },
        ],
      },
      {
        name: 'notify',
        label: 'Notify the customer',
        type: 'select',
        options: [
          { value: true, label: 'Yes' },
          { value: false, label: 'No' },
        ],
      },
    ],
  },
};

const ZH_CN: TranslationData = {
  objects: { crm_case: { label: '工单', fields: { name: { label: '名称' } } } },
  flows: {
    case_escalate: {
      label: '升级工单',
      successMessage: '工单已升级',
      errorMessage: '升级失败，请联系管理员',
      screens: {
        pick: {
          // The engine serves the heading already translated (objectstack#22507
          // ruling A); the runner must not overlay this on the served one.
          title: '升级工单（模板）',
          fields: {
            tier: { label: '级别', options: { '1': '一线', '2': '二线' } },
            notify: { options: { true: '是' } },
          },
        },
      },
    },
  },
};

function i18nWith(language: string, payload: TranslationData) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  const raw = payload as Record<string, unknown>;
  expect(isSpecTranslationData(raw)).toBe(true);
  instance.addResourceBundle(language, 'translation', transformSpecTranslations(raw), true, true);
  return instance;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderRunner(
  state: ScreenFlowState,
  instance: ReturnType<typeof createI18n>,
  authFetch: (url: string, init?: RequestInit) => Promise<Response> = vi.fn(async () => jsonResponse({})),
) {
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <FlowRunner state={state} authFetch={authFetch} baseUrl="" onClose={vi.fn()} onComplete={vi.fn()} />
    </I18nProvider>,
  );
  return within(screen.getByRole('dialog'));
}

/** Open the select labelled `label` and list the option names it offers. */
async function openSelect(dialog: ReturnType<typeof within>, label: string): Promise<HTMLElement> {
  const trigger = dialog.getByRole('combobox', { name: label });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return await screen.findByRole('listbox');
}

async function pick(dialog: ReturnType<typeof within>, label: string, option: string): Promise<void> {
  fireEvent.click(within(await openSelect(dialog, label)).getByRole('option', { name: option }));
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

beforeEach(() => {
  toasts.error.mockClear();
  toasts.success.mockClear();
});

describe('FlowRunner — option labels from `flows.FLOW.screens.NODE.fields.FIELD.options` (objectui#12075)', () => {
  it('draws the bundle label for each option it addresses, and the authored label for the rest', async () => {
    const dialog = renderRunner(ESCALATION, i18nWith('zh-CN', ZH_CN));
    const names = within(await openSelect(dialog, '级别'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    // `3` has no key: that option alone stays in the author's language.
    expect(names).toEqual(['一线', '二线', 'Engineering']);
  });

  it('addresses a boolean option by its value read as text', async () => {
    const dialog = renderRunner(ESCALATION, i18nWith('zh-CN', ZH_CN));
    const names = within(await openSelect(dialog, 'Notify the customer'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['是', 'No']);
  });
});

describe('FlowRunner — the served screen heading is drawn as served (objectstack#22507 ruling A)', () => {
  it('does not overlay the bundle title on the heading the engine already translated', () => {
    const dialog = renderRunner(ESCALATION, i18nWith('zh-CN', ZH_CN));
    expect(dialog.getByRole('heading', { name: 'Escalate the case' })).toBeInTheDocument();
    expect(dialog.queryByText('升级工单（模板）')).not.toBeInTheDocument();
  });
});

describe('FlowRunner — the flow\'s own toasts from `flows.FLOW.successMessage` / `errorMessage` (objectui#12075)', () => {
  it('toasts the translated successMessage when the run completes', async () => {
    const authFetch = vi.fn(async () =>
      jsonResponse({ success: true, data: { success: true, status: 'completed', successMessage: 'Case escalated' } }),
    );
    const dialog = renderRunner(ESCALATION, i18nWith('zh-CN', ZH_CN), authFetch);
    fireEvent.click(dialog.getAllByRole('button').find((b) => b.textContent && /提交|Submit/.test(b.textContent))!);

    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(toasts.success).toHaveBeenCalledWith('工单已升级');
  });

  it('adds no completion copy the flow does not author: the catalog sentence names the flow', async () => {
    const authFetch = vi.fn(async () =>
      jsonResponse({ success: true, data: { success: true, status: 'completed' } }),
    );
    const instance = i18nWith('zh-CN', ZH_CN);
    const dialog = renderRunner(ESCALATION, instance, authFetch);
    fireEvent.click(dialog.getAllByRole('button').find((b) => b.textContent && /提交|Submit/.test(b.textContent))!);

    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    const message = String(toasts.success.mock.calls[0][0]);
    expect(message).not.toBe('工单已升级');
    expect(message).toContain('升级工单');
  });

  it('toasts and shows the translated errorMessage when the run fails', async () => {
    const authFetch = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { success: false, status: 'failed', error: 'boom', errorMessage: 'Escalation failed, contact an admin' },
      }),
    );
    const dialog = renderRunner(ESCALATION, i18nWith('zh-CN', ZH_CN), authFetch);
    fireEvent.click(dialog.getAllByRole('button').find((b) => b.textContent && /提交|Submit/.test(b.textContent))!);

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(toasts.error).toHaveBeenCalledWith('升级失败，请联系管理员');
    expect(within(screen.getByRole('alert')).getByText('升级失败，请联系管理员')).toBeInTheDocument();
  });

  it('keeps the served toasts verbatim in a language the bundle does not carry', async () => {
    const authFetch = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { success: false, status: 'failed', error: 'boom', errorMessage: 'Escalation failed, contact an admin' },
      }),
    );
    const en = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    en.addResourceBundle('zh-CN', 'translation', transformSpecTranslations(ZH_CN as Record<string, unknown>), true, true);
    renderRunner(ESCALATION, en, authFetch);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(toasts.error).toHaveBeenCalledWith('Escalation failed, contact an admin');
  });
});

describe('FlowRunner — a select binds the option\'s own value, not its text (objectui#12075)', () => {
  it('resumes with the number and the boolean the picked options declare', async () => {
    const authFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ success: true, data: { success: true, status: 'completed' } }),
    );
    const en = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    const dialog = renderRunner(ESCALATION, en, authFetch);

    await pick(dialog, 'Tier', 'Second line');
    await pick(dialog, 'Notify the customer', 'No');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(authFetch.mock.calls[0][1]?.body));
    expect(body.inputs).toEqual({ tier: 2, notify: false });
  });

  it('shows a number-valued default as its option', () => {
    const withDefault: ScreenFlowState = {
      ...ESCALATION,
      screen: {
        ...ESCALATION.screen,
        fields: [{ ...ESCALATION.screen.fields![0], defaultValue: 3 }],
      },
    };
    const dialog = renderRunner(withDefault, createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false }));
    expect(dialog.getByRole('combobox', { name: 'Tier' })).toHaveTextContent('Engineering');
  });
});
