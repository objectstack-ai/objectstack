/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#27419 — no build-panel group heading is a raw artifact type. The
 * staged set is no union here (`ChatBuildProgress.items` types `type` as a free
 * string; cloud's `apply_blueprint` produces it), so `STAGED_TYPES` is what a
 * real build staged; a type added later lands on "Other", the second case.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

const STAGED_TYPES = ['object', 'view', 'dashboard', 'app', 'seed', 'dataset', 'permission'] as const;
type Heading = (typeof STAGED_TYPES)[number] | 'other';
const HEADINGS: Record<'zh' | 'en', Record<Heading, string>> = {
  zh: { object: '对象', view: '视图', dashboard: '仪表板', app: '应用', seed: '示例数据', dataset: '数据集', permission: '权限', other: '其他' },
  en: { object: 'Objects', view: 'Views', dashboard: 'Dashboards', app: 'App', seed: 'Sample data', dataset: 'Datasets', permission: 'Permissions', other: 'Other' },
};

// Labels differ from every type id and heading, so a text match finds headings.
const ITEMS = [...STAGED_TYPES, 'flow'].map((type) => ({ type, name: `${type}_item`, label: `item ${type}` }));

function renderIn(language: 'zh' | 'en') {
  const buildProgress = { phase: 'structure' as const, appLabel: 'CRM', items: ITEMS, done: 3, total: 8 };
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ChatbotEnhanced
        isLoading
        onSendMessage={vi.fn()}
        messages={[{ id: 'a1', role: 'assistant', content: '', streaming: true, buildProgress }]}
      />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe.each(['zh', 'en'] as const)('build panel group headings (%s)', (language) => {
  it('names every staged type, and none renders as its raw type', () => {
    renderIn(language);
    for (const type of STAGED_TYPES) {
      expect(screen.getByText(HEADINGS[language][type])).toBeInTheDocument();
      expect(screen.queryByText(type)).not.toBeInTheDocument();
    }
  });

  it('an unnamed type falls to the neutral Other heading, never its raw type', () => {
    renderIn(language);
    expect(screen.getByText(HEADINGS[language].other)).toBeInTheDocument();
    expect(screen.queryByText('flow')).not.toBeInTheDocument();
    expect(screen.queryByText(/chatbot\.build/)).not.toBeInTheDocument();
  });
});
