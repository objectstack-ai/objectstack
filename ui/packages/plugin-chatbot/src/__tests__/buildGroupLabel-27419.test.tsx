/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#27419 — no build-panel group heading is a raw artifact type.
 *
 * A whole-app build in a zh console read 「… | dataset 项目 | permission …」:
 * `useBuildGroupLabel` named five types and handed every other type back as
 * its machine id. This pins the heading of every type `apply_blueprint`
 * stages, in zh and en, plus the neutral "Other" an unnamed type falls to.
 *
 * The staged set is not a union in this repository: `ChatBuildProgress.items`
 * types `type` as a free string and the producer is cloud's `apply_blueprint`.
 * `STAGED_TYPES` is therefore the set observed on a real build (the card's
 * reproduction), and a type the producer adds later lands on "Other" until it
 * is named — which this file's unknown-type case holds.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

const STAGED_TYPES = ['object', 'view', 'dashboard', 'app', 'seed', 'dataset', 'permission'] as const;

const HEADINGS: Record<'zh' | 'en', Record<(typeof STAGED_TYPES)[number] | 'other', string>> = {
  zh: {
    object: '对象',
    view: '视图',
    dashboard: '仪表板',
    app: '应用',
    seed: '示例数据',
    dataset: '数据集',
    permission: '权限',
    other: '其他',
  },
  en: {
    object: 'Objects',
    view: 'Views',
    dashboard: 'Dashboards',
    app: 'App',
    seed: 'Sample data',
    dataset: 'Datasets',
    permission: 'Permissions',
    other: 'Other',
  },
};

// One artifact per staged type plus one type no pack names. Labels are
// distinct from every type id and heading, so a text match finds headings only.
const ITEMS = [
  ...STAGED_TYPES.map((type) => ({ type, name: `${type}_item`, label: `item ${type}` })),
  { type: 'flow', name: 'onboarding', label: 'item flow' },
];

function renderIn(language: 'zh' | 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ChatbotEnhanced
        isLoading
        onSendMessage={vi.fn()}
        messages={[
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            streaming: true,
            buildProgress: { phase: 'structure', appLabel: 'CRM', items: ITEMS, done: 3, total: 8 },
          },
        ]}
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
