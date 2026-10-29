/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7388 — the apply_blueprint BUILD PANEL, in the user's language.
 *
 * Everything the panel is HANDED is localized: the host passes
 * `openBuiltAppLabel` / `designBuiltAppLabel` / `previewDraftLabel` and the
 * three connection cues through its own `t()`. Everything the panel OWNED was
 * an English literal in the component — the two header frames, the
 * sample-data suffix, the five per-type row headings, and the overflow
 * counter. So a fully Chinese conversation watched a build under an English
 * header, over five English row headings, one per row, on every build.
 *
 * The predicate this file pins is the CLASS, not a key count: no English
 * literal on the panel bypasses the pack. Each subject case therefore also
 * asserts the English it replaced is absent, which is what a missing key would
 * bring back (the fallback renders the English default, never a raw key).
 *
 * ## The control, and why it is a real one
 *
 * `renderEn` runs the SAME three known phases (`structure` / `data` / `done`)
 * through an `en` provider and pins them to the exact strings the component
 * used to hard-code. It moves independently of the subject: it stays green if
 * the `zh` values are wrong or missing, and it reddens only if the ENGLISH
 * rendering changed — which is the regression this refactor could actually
 * cause. The provider-less English world is pinned separately and was already
 * there: `ChatbotEnhanced.test.tsx`'s "renders a live build tree" /
 * "collapses to a Built summary".
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );
}

const ITEMS = [
  { type: 'object', name: 'customer' },
  { type: 'view', name: 'customer.list' },
  { type: 'dashboard', name: 'sales' },
  { type: 'seed', name: 'customer_sample' },
];

function buildMsg(
  phase: 'structure' | 'data' | 'done',
  over: Partial<NonNullable<ChatbotEnhancedMessage['buildProgress']>> = {},
): ChatbotEnhancedMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    streaming: phase !== 'done',
    buildProgress: { phase, appLabel: 'CRM', items: ITEMS, done: 4, total: 6, ...over },
  };
}

function panel(phase: 'structure' | 'data' | 'done', over = {}) {
  return <ChatbotEnhanced isLoading={phase !== 'done'} messages={[buildMsg(phase, over)]} onSendMessage={vi.fn()} />;
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// CONTROL — the English rendering of the three KNOWN phases, unchanged.
// ---------------------------------------------------------------------------
describe('control: a known phase renders exactly as it did before (en)', () => {
  it('structure — header, row headings, no sample-data suffix', () => {
    renderIn('en', panel('structure'));
    expect(screen.getByTestId('build-progress')).toBeInTheDocument();
    expect(screen.getByText('Building CRM…')).toBeInTheDocument();
    expect(screen.getByText('Objects')).toBeInTheDocument();
    expect(screen.getByText('Views')).toBeInTheDocument();
    expect(screen.getByText('Dashboards')).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    expect(screen.queryByText('adding sample data')).not.toBeInTheDocument();
  });

  it('data — the sample-data suffix appears, header still "Building"', () => {
    renderIn('en', panel('data'));
    expect(screen.getByText('Building CRM…')).toBeInTheDocument();
    expect(screen.getByText('adding sample data')).toBeInTheDocument();
  });

  it('done — collapses to the "Built" summary', () => {
    renderIn('en', panel('done'));
    expect(screen.getByText('Built CRM')).toBeInTheDocument();
  });

  it('an unnamed build still says "your app"', () => {
    renderIn('en', panel('structure', { appLabel: undefined }));
    expect(screen.getByText('Building your app…')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SUBJECT — the same panel under a zh console.
// ---------------------------------------------------------------------------
describe('the build panel under a zh console (objectui#7388)', () => {
  // The header composes the verb and the app name with the ` · ` separator
  // `builtAndLive` already used: a name pasted straight onto the verb ran on
  // into one word (「已构建Library Lending Management」).
  it('localizes the in-flight header instead of hard-coding "Building X…"', () => {
    renderIn('zh', panel('structure'));
    expect(screen.getByText('正在构建 · CRM…')).toBeInTheDocument();
    expect(screen.queryByText(/Building/)).not.toBeInTheDocument();
  });

  it('localizes the finished header instead of hard-coding "Built X"', () => {
    renderIn('zh', panel('done'));
    expect(screen.getByText('已构建 · CRM')).toBeInTheDocument();
    expect(screen.queryByText(/^Built /)).not.toBeInTheDocument();
  });

  it('localizes the sample-data suffix', () => {
    renderIn('zh', panel('data'));
    expect(screen.getByText('正在添加示例数据')).toBeInTheDocument();
    expect(screen.queryByText('adding sample data')).not.toBeInTheDocument();
  });

  it('localizes every per-type row heading — the five that render on every build', () => {
    renderIn('zh', panel('structure'));
    for (const zh of ['对象', '视图', '仪表板', '示例数据']) {
      expect(screen.getByText(zh)).toBeInTheDocument();
    }
    for (const en of ['Objects', 'Views', 'Dashboards', 'Sample data']) {
      expect(screen.queryByText(en)).not.toBeInTheDocument();
    }
  });

  it('localizes the "App" row heading too', () => {
    renderIn('zh', panel('done', { items: [...ITEMS, { type: 'app', name: 'crm' }] }));
    expect(screen.getByText('应用')).toBeInTheDocument();
    expect(screen.queryByText('App')).not.toBeInTheDocument();
  });

  // The stand-in goes through the same frame, so it reads the way
  // `builtAndLive` already reads for an unnamed build (「已搭建并上线 · 你的应用」).
  it('localizes the unnamed-build stand-in, so the header is Chinese end to end', () => {
    renderIn('zh', panel('structure', { appLabel: undefined }));
    expect(screen.getByText('正在构建 · 你的应用…')).toBeInTheDocument();
    expect(screen.queryByText(/your app/)).not.toBeInTheDocument();
  });

  it('localizes the ">6 artifacts" overflow counter', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ type: 'object', name: `obj_${i}` }));
    renderIn('zh', panel('structure', { items: many }));
    expect(screen.getByText(/\+2 个/)).toBeInTheDocument();
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  // The safe shape the card's boundary asks for, on the OTHER unknown-value
  // fallback this panel has: an artifact type no pack names renders the
  // neutral "Other" heading (objectstack#27419), never its raw type, and it
  // must never render a raw i18n key.
  it('an unknown artifact type renders the Other heading, not its type or a key', () => {
    renderIn('zh', panel('structure', { items: [{ type: 'flow', name: 'onboarding' }] }));
    expect(screen.getByText('其他')).toBeInTheDocument();
    expect(screen.queryByText('flow')).not.toBeInTheDocument();
    expect(screen.queryByText(/chatbot\.build/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The other two CJK packs keep their headers as they are: neither runs the
// verb into the name. ja puts the name first and a particle after it, ko
// already leaves a space before the verb.
// ---------------------------------------------------------------------------
describe('the build panel header under ja and ko consoles', () => {
  it('ja — the name leads and the particle separates it from the verb', () => {
    renderIn('ja', panel('structure'));
    expect(screen.getByText('CRMを構築しています…')).toBeInTheDocument();
    cleanup();
    renderIn('ja', panel('done'));
    expect(screen.getByText('CRMを構築しました')).toBeInTheDocument();
  });

  it('ko — a space already separates the name from the verb', () => {
    renderIn('ko', panel('structure'));
    expect(screen.getByText('CRM 빌드 중…')).toBeInTheDocument();
    cleanup();
    renderIn('ko', panel('done'));
    expect(screen.getByText('CRM 빌드 완료')).toBeInTheDocument();
  });
});
