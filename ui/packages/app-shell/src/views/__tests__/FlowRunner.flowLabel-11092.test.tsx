// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The screen-flow runner names the flow by its label, in the user's language
 * (objectui#11092, the objectui half of objectstack#20318).
 *
 * Before this, the runner drew no name for the flow in its header, and its
 * completion toast named the flow by its API name. Every answer that evaluated
 * the flow now carries the flow's authored label (`AutomationResult.flowLabel`),
 * and the app bundle can translate it under `flows.<flow>.label`.
 *
 * The bundle reaches the runner exactly as in `FlowRunner.flowsTranslation-5920`:
 * the server's `TranslationData` payload through `transformSpecTranslations`,
 * added to the i18next instance the provider binds.
 *
 * Pins, one per acceptance line of the card, each on both display slots (the
 * header line and the completion toast):
 *   - a zh-CN bundle carrying `flows.<flow>.label` → the translation;
 *   - `en`, where the bundle carries no `flows` → the served label;
 *   - a flow the bundle does not translate → its authored (served) label;
 * plus the two ends of the chain: an answer with no label falls back to the
 * API name, and a resume answer that pauses again carries the label forward.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createI18n, I18nProvider, isSpecTranslationData, transformSpecTranslations } from '@object-ui/i18n';
import type { TranslationData } from '@objectstack/spec/system';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const SERVED_LABEL = 'Lead Conversion';

/** A paused `lead_conversion` run, as a launch host hands it to the runner. */
const PAUSED: ScreenFlowState = {
  flowName: 'lead_conversion',
  flowLabel: SERVED_LABEL,
  runId: 'run-1',
  screen: {
    nodeId: 'screen_1',
    title: 'Conversion Details',
    fields: [{ name: 'note', label: 'Note', type: 'text' }],
  },
};

/**
 * The zh-CN payload: the flow's label AND the screen's copy are translated.
 * The `title` rides along to show it is NOT overlaid: the engine serves the
 * heading already translated (objectstack#22507 ruling A, objectui#12075).
 */
const ZH_CN: TranslationData = {
  objects: { crm_lead: { label: '线索' } },
  flows: {
    lead_conversion: {
      label: '线索转化',
      screens: { screen_1: { title: '转化详情', fields: { note: { label: '备注' } } } },
    },
  },
};

/** A zh-CN payload that translates this flow's screen but not its label. */
const ZH_CN_SCREEN_ONLY: TranslationData = {
  objects: { crm_lead: { label: '线索' } },
  flows: { lead_conversion: { screens: { screen_1: { fields: { note: { label: '备注' } } } } } },
};

function i18nWith(language: string, payloadLanguage: string, payload: TranslationData) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  const raw = payload as Record<string, unknown>;
  expect(isSpecTranslationData(raw)).toBe(true);
  instance.addResourceBundle(payloadLanguage, 'translation', transformSpecTranslations(raw), true, true);
  return instance;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** A terminal-success resume answer, carrying `flowLabel` when given one. */
function completedAnswer(flowLabel?: string) {
  return jsonResponse({ success: true, data: { success: true, ...(flowLabel ? { flowLabel } : {}) } });
}

function renderRunner(
  state: ScreenFlowState,
  instance: ReturnType<typeof createI18n>,
  authFetch: (url: string, init?: RequestInit) => Promise<Response> = vi.fn(async () => completedAnswer(SERVED_LABEL)),
) {
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <FlowRunner state={state} authFetch={authFetch} baseUrl="" onClose={vi.fn()} onComplete={vi.fn()} />
    </I18nProvider>,
  );
  return within(screen.getByRole('dialog'));
}

/** Submit the screen and return the completion toast's message. */
async function completionToast(instance: ReturnType<typeof createI18n>): Promise<string> {
  const user = userEvent.setup();
  // Chrome from the console's own catalogue, asked of the instance rather than spelled.
  await user.click(screen.getByRole('button', { name: instance.t('common.submit') }));
  await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
  return String(toasts.success.mock.calls[0][0]);
}

beforeEach(() => {
  toasts.error.mockClear();
  toasts.success.mockClear();
});

describe('FlowRunner — the flow is named by its label (objectui#11092)', () => {
  it('zh-CN: the header and the completion toast name the flow by `flows.<flow>.label`', async () => {
    const instance = i18nWith('zh-CN', 'zh-CN', ZH_CN);
    const dialog = renderRunner(PAUSED, instance);

    expect(dialog.getByText('线索转化')).toBeInTheDocument();
    // The screen heading is still the dialog's title, drawn as served — the
    // engine translates it (objectstack#22507 ruling A) — while the field
    // copy is the bundle's.
    expect(dialog.getByRole('heading', { name: 'Conversion Details' })).toBeInTheDocument();
    expect(dialog.getByText('备注')).toBeInTheDocument();
    expect(dialog.queryByText(SERVED_LABEL)).not.toBeInTheDocument();
    expect(dialog.queryByText('lead_conversion')).not.toBeInTheDocument();

    const message = await completionToast(instance);
    expect(message).toBe(instance.t('flowRunner.completed', { flow: '线索转化' }));
    expect(message).not.toContain('lead_conversion');
    expect(message).not.toContain(SERVED_LABEL);
  });

  it('en: where the bundle carries no `flows`, the header and the toast fall back to the served label', async () => {
    const instance = i18nWith('en', 'zh-CN', ZH_CN);
    const dialog = renderRunner(PAUSED, instance);

    expect(dialog.getByText(SERVED_LABEL)).toBeInTheDocument();
    expect(dialog.queryByText('线索转化')).not.toBeInTheDocument();
    expect(dialog.queryByText('lead_conversion')).not.toBeInTheDocument();

    const message = await completionToast(instance);
    expect(message).toBe(instance.t('flowRunner.completed', { flow: SERVED_LABEL }));
    expect(message).not.toContain('lead_conversion');
  });

  it('a flow the bundle does not translate shows its authored label, while the bundle is live for the screen', async () => {
    const instance = i18nWith('zh-CN', 'zh-CN', ZH_CN_SCREEN_ONLY);
    const dialog = renderRunner(PAUSED, instance);

    // The field label proves the bundle IS read for this flow …
    expect(dialog.getByText('备注')).toBeInTheDocument();
    // … and the label, which it does not carry, is the author's.
    expect(dialog.getByText(SERVED_LABEL)).toBeInTheDocument();
    expect(dialog.queryByText('lead_conversion')).not.toBeInTheDocument();

    const message = await completionToast(instance);
    expect(message).toBe(instance.t('flowRunner.completed', { flow: SERVED_LABEL }));
  });

  it('an answer that served no label (a backend older than the label) falls back to the API name', async () => {
    const instance = i18nWith('zh-CN', 'zh-CN', ZH_CN_SCREEN_ONLY);
    const unlabelled: ScreenFlowState = { flowName: PAUSED.flowName, runId: PAUSED.runId, screen: PAUSED.screen };
    const dialog = renderRunner(unlabelled, instance, vi.fn(async () => completedAnswer()));

    expect(dialog.getByText('lead_conversion')).toBeInTheDocument();

    const message = await completionToast(instance);
    expect(message).toBe(instance.t('flowRunner.completed', { flow: 'lead_conversion' }));
  });

  it('a resume answer that pauses again carries its served label into the header', async () => {
    const instance = i18nWith('en', 'zh-CN', ZH_CN);
    const unlabelled: ScreenFlowState = { flowName: PAUSED.flowName, runId: PAUSED.runId, screen: PAUSED.screen };
    const nextStep = {
      success: true,
      data: {
        success: true,
        status: 'paused',
        runId: 'run-1',
        flowLabel: SERVED_LABEL,
        screen: { nodeId: 'screen_2', title: 'Confirm', fields: [] },
      },
    };
    const dialog = renderRunner(unlabelled, instance, vi.fn(async () => jsonResponse(nextStep)));
    expect(dialog.getByText('lead_conversion')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: instance.t('common.submit') }));

    const next = within(await screen.findByRole('dialog'));
    expect(await next.findByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
    expect(next.getByText(SERVED_LABEL)).toBeInTheDocument();
    expect(next.queryByText('lead_conversion')).not.toBeInTheDocument();
  });
});
