// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The screen-flow runner applies the app's `flows` translation overlay
 * (objectui#5920, the runner half of objectstack#11287).
 *
 * Before this, `TranslationData.flows` had no reader anywhere in the shipped
 * platform: an app could author `flows.<flow>.screens.<node_id>.title`, have it
 * load into the i18n tree, and the wizard still drew the author's English in
 * every locale.
 *
 * The bundle reaches the runner the way it reaches every other translated
 * surface in the console — the server's `TranslationData` payload, passed
 * through `transformSpecTranslations` exactly as `apps/console`'s
 * `loadLanguage` does, and added to the i18next instance with the same
 * `addResourceBundle` call the provider makes. Nothing here hands the runner a
 * bundle any other way, so a green run is a statement about that channel.
 *
 * Pins, one per acceptance line of the card:
 *   - a zh-CN bundle with `flows` entries → translated field label, placeholder;
 *   - the `en` / no-bundle path → the authored copy, unchanged;
 *   - an authored key the bundle does not carry → the authored copy, key by key;
 *   - the screen heading and `description` → drawn as SERVED, never overlaid.
 *
 * The heading pins changed meaning with objectstack#22507's ruling A
 * (objectui#12075): the engine picks the translated heading and body text in
 * the run's locale before it fills their holes, so the served `ScreenSpec`
 * already carries them translated and a client overlay "never touches a
 * server-rendered slot". The runner used to overlay the bundle's `title`; it
 * now draws the served one, which these pins read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createI18n, I18nProvider, isSpecTranslationData, transformSpecTranslations } from '@object-ui/i18n';
import type { TranslationData } from '@objectstack/spec/system';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** HotCRM's `lead_conversion` screen, as the paused run puts it on the wire. */
const CONVERSION: ScreenFlowState = {
  flowName: 'lead_conversion',
  runId: 'run-1',
  screen: {
    nodeId: 'screen_1',
    title: 'Conversion Details',
    description: 'Review the lead before converting it.',
    fields: [
      { name: 'createOpportunity', label: 'Create Opportunity?', type: 'boolean' },
      { name: 'opportunityName', label: 'Opportunity Name', type: 'text', required: true, placeholder: 'e.g. Annual renewal' },
      { name: 'opportunityAmount', label: 'Opportunity Amount', type: 'number', placeholder: '0.00' },
    ],
  },
};

/**
 * The zh-CN payload the server serves. `objects` is there because a real app
 * bundle carries it, and because `isSpecTranslationData` keys off it — the
 * console only transforms a payload it recognises as spec-shaped.
 */
const ZH_CN: TranslationData = {
  objects: { crm_lead: { label: '线索', fields: { name: { label: '名称' } } } },
  flows: {
    lead_conversion: {
      label: '线索转化',
      screens: {
        screen_1: {
          title: '转化详情',
          fields: {
            createOpportunity: { label: '创建商机？' },
            opportunityName: { label: '商机名称', placeholder: '例如：年度续约' },
          },
        },
      },
    },
  },
};

/** An i18next instance in `language`, carrying `payload` for `payloadLanguage` the way the console loads it. */
function i18nWith(language: string, payloadLanguage: string, payload: TranslationData) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  const raw = payload as Record<string, unknown>;
  expect(isSpecTranslationData(raw)).toBe(true);
  instance.addResourceBundle(payloadLanguage, 'translation', transformSpecTranslations(raw), true, true);
  return instance;
}

/** Mount the runner under the provider the console mounts, bound to `instance`. */
function renderRunner(state: ScreenFlowState, instance: ReturnType<typeof createI18n>) {
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <FlowRunner
        state={state}
        authFetch={vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'))}
        baseUrl=""
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    </I18nProvider>,
  );
  return within(screen.getByRole('dialog'));
}

/** Every authored string on the screen, drawn exactly as authored. */
function expectAuthoredCopy(dialog: ReturnType<typeof within>) {
  expect(dialog.getByRole('heading', { name: 'Conversion Details' })).toBeInTheDocument();
  expect(dialog.getByText('Create Opportunity?')).toBeInTheDocument();
  expect(dialog.getByText('Opportunity Name')).toBeInTheDocument();
  expect(dialog.getByPlaceholderText('e.g. Annual renewal')).toBeInTheDocument();
  expect(dialog.getByText('Opportunity Amount')).toBeInTheDocument();
  expect(dialog.getByPlaceholderText('0.00')).toBeInTheDocument();
  expect(dialog.queryByText('转化详情')).not.toBeInTheDocument();
  expect(dialog.queryByText('商机名称')).not.toBeInTheDocument();
}

beforeEach(() => {
  toasts.error.mockClear();
  toasts.success.mockClear();
});

describe('FlowRunner — the `flows` translation overlay (objectui#5920)', () => {
  it('draws the zh-CN field label and placeholder from the bundle, and the heading as served', () => {
    const dialog = renderRunner(CONVERSION, i18nWith('zh-CN', 'zh-CN', ZH_CN));

    // The served heading is drawn as served (objectstack#22507 ruling A): the
    // bundle's `title` is the engine's to pick, never overlaid here.
    expect(dialog.getByRole('heading', { name: 'Conversion Details' })).toBeInTheDocument();
    expect(dialog.queryByText('转化详情')).not.toBeInTheDocument();
    expect(dialog.getByText('创建商机？')).toBeInTheDocument();
    expect(dialog.getByText('商机名称')).toBeInTheDocument();
    expect(dialog.getByPlaceholderText('例如：年度续约')).toBeInTheDocument();
    // The authored English is gone wherever the bundle answered.
    expect(dialog.queryByText('Opportunity Name')).not.toBeInTheDocument();
    expect(dialog.queryByPlaceholderText('e.g. Annual renewal')).not.toBeInTheDocument();
  });

  it('names the translated label in the missing-required toast, not the authored one', async () => {
    const user = userEvent.setup();
    const instance = i18nWith('zh-CN', 'zh-CN', ZH_CN);
    renderRunner(CONVERSION, instance);

    // The button is chrome from the console's own catalogue, in whatever
    // language that catalogue resolves zh-CN to — asked of the instance rather
    // than spelled here.
    await user.click(screen.getByRole('button', { name: instance.t('common.submit') }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    const message = String(toasts.error.mock.calls[0][0]);
    expect(message).toContain('商机名称');
    expect(message).not.toContain('Opportunity Name');
  });

  it('draws the authored copy unchanged in `en`, where the bundle carries no `flows`', () => {
    expectAuthoredCopy(renderRunner(CONVERSION, i18nWith('en', 'zh-CN', ZH_CN)));
  });

  it('draws the authored copy unchanged when no app bundle was ever loaded', () => {
    // A bound instance in zh-CN with nothing but the built-in catalogue. (The
    // provider-less render is `FlowRunner.test.tsx`'s whole suite; it is not
    // repeated here because `createI18n` registers each instance with
    // react-i18next globally, so a bare render in THIS file would bind to
    // whichever instance an earlier test created.)
    const bare = createI18n({ defaultLanguage: 'zh-CN', detectBrowserLanguage: false });
    expectAuthoredCopy(renderRunner(CONVERSION, bare));
  });

  it('falls back to the authored copy key by key where the bundle is silent', () => {
    const dialog = renderRunner(CONVERSION, i18nWith('zh-CN', 'zh-CN', ZH_CN));

    // No entry for the field at all: label and placeholder both authored.
    expect(dialog.getByText('Opportunity Amount')).toBeInTheDocument();
    expect(dialog.getByPlaceholderText('0.00')).toBeInTheDocument();
  });

  it('falls back per KEY within one entry', () => {
    const labelOnly: TranslationData = {
      ...ZH_CN,
      flows: {
        lead_conversion: {
          screens: {
            // `screen_1` carries a field label and nothing else — no heading,
            // no placeholder — so both of those stay authored.
            screen_1: { fields: { opportunityName: { label: '商机名称' } } },
          },
        },
      },
    };
    const dialog = renderRunner(CONVERSION, i18nWith('zh-CN', 'zh-CN', labelOnly));

    expect(dialog.getByRole('heading', { name: 'Conversion Details' })).toBeInTheDocument();
    expect(dialog.getByText('商机名称')).toBeInTheDocument();
    expect(dialog.getByPlaceholderText('e.g. Annual renewal')).toBeInTheDocument();
  });

  it('does NOT overlay the screen heading or `description` the bundle carries', () => {
    // Both are templates the engine renders per run, so it picks their
    // translations in the run's locale and serves them filled
    // (objectstack#22507 ruling A). An overlay here would put the raw
    // translated template back over the served text.
    const withScreenCopy: TranslationData = {
      ...ZH_CN,
      flows: {
        lead_conversion: {
          screens: {
            screen_1: {
              title: '转化详情',
              description: '转化前请核对线索。',
              fields: { opportunityName: { label: '商机名称' } },
            },
          },
        },
      },
    };
    const dialog = renderRunner(CONVERSION, i18nWith('zh-CN', 'zh-CN', withScreenCopy));

    // The field label proves the bundle IS being read on this screen …
    expect(dialog.getByText('商机名称')).toBeInTheDocument();
    // … and the heading the dialog draws is the served one.
    expect(dialog.getByRole('heading', { name: 'Conversion Details' })).toBeInTheDocument();
    expect(dialog.queryByText('转化详情')).not.toBeInTheDocument();
    // … and the description the dialog draws — its accessible description —
    // is still the authored one.
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Review the lead before converting it.');
    expect(dialog.queryByText('转化前请核对线索。')).not.toBeInTheDocument();
  });
});
