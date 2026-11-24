// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36809 — the screen-flow runner follows the server's declared
 * fallback chain for the strings it resolves itself.
 *
 * The console loader lays the declared chain and the fallback locale's `flows`
 * group beside the active language's tree (`withDeclaredFlowsFallback`). The
 * runner names the flow and overlays each field's copy per key across the
 * walk: the active language where it translates, then the fallback locale,
 * then the authored text. With no declared chain it reads the active language
 * alone, as before.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createI18n, I18nProvider, transformSpecTranslations, withDeclaredFlowsFallback } from '@object-ui/i18n';
import type { TranslationData } from '@objectstack/spec/system';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const STATE: ScreenFlowState = {
  flowName: 'lead_conversion',
  flowLabel: 'Lead Conversion (authored)',
  runId: 'run-1',
  screen: {
    nodeId: 'screen_1',
    title: 'Conversion Details',
    fields: [
      { name: 'opportunityName', label: 'Opportunity Name (authored)', type: 'text', placeholder: 'authored placeholder' },
    ],
  },
};

/** The active language (ja-JP) translates the field's placeholder only. */
const JA: TranslationData = {
  flows: { lead_conversion: { screens: { screen_1: { fields: { opportunityName: { placeholder: '例：年間更新' } } } } } },
};
/** The declared fallback (en) translates the flow label and the field label. */
const EN_FLOWS = {
  lead_conversion: {
    label: 'Lead conversion',
    screens: { screen_1: { fields: { opportunityName: { label: 'Opportunity name', placeholder: 'e.g. renewal' } } } },
  },
};

function renderRunner(declared: boolean) {
  const instance = createI18n({ defaultLanguage: 'ja-JP', detectBrowserLanguage: false });
  const resources = withDeclaredFlowsFallback(
    transformSpecTranslations(JA as Record<string, unknown>),
    declared ? { fallbackChain: ['en'], defaultLocale: 'zh-CN', bundles: { en: { flows: EN_FLOWS as never } } } : undefined,
  );
  instance.addResourceBundle('ja-JP', 'translation', resources, true, true);
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <FlowRunner
        state={STATE}
        authFetch={vi.fn(async () => new Response('{}'))}
        baseUrl=""
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    </I18nProvider>,
  );
  return within(screen.getByRole('dialog'));
}

describe('FlowRunner follows a declared fallback chain (objectstack#36809)', () => {
  it('reads the fallback locale where the active language lacks a string, per key', () => {
    const dialog = renderRunner(true);
    expect(dialog.getByText('Lead conversion')).toBeInTheDocument();
    expect(dialog.getByText('Opportunity name')).toBeInTheDocument();
    // The active language still wins the key it translates.
    expect(dialog.getByPlaceholderText('例：年間更新')).toBeInTheDocument();
    expect(dialog.queryByText('Opportunity Name (authored)')).not.toBeInTheDocument();
  });

  it('no declared chain: the active language, then the authored text', () => {
    const dialog = renderRunner(false);
    expect(dialog.getByText('Lead Conversion (authored)')).toBeInTheDocument();
    expect(dialog.getByText('Opportunity Name (authored)')).toBeInTheDocument();
    expect(dialog.getByPlaceholderText('例：年間更新')).toBeInTheDocument();
    expect(dialog.queryByText('Lead conversion')).not.toBeInTheDocument();
  });
});
