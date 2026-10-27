/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#26469 — the AI build page's progress panel and the build card's
 * answer the Live Canvas header reads.
 *
 *  1. Progress items show the frame's `label` when it carries one and fall
 *     back to the machine name without it (the cloud half that adds `label`
 *     may land later; the panel must read right before and after).
 *  2. `onBuildResult` hands the host the card's own answer — the app, the
 *     label its title names and whether its title says live — and fires again
 *     when that answer changes (the build is published).
 *  3. A materialized build whose envelope says `appHidden: false` is listed,
 *     i.e. published, so the card reads live; `appHidden: true` does not.
 *  4. The posture footnote names Publish in the chat, not Studio.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';
import { detectDraftResult, uiMessageToChatMessage } from '../mapMessages';

function inLocale(lang: 'zh' | 'en', ui: React.ReactElement) {
  return (
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>
  );
}

const building = (items: Array<{ type: string; name: string; label?: string }>): ChatbotEnhancedMessage => ({
  id: 'building-1',
  role: 'assistant',
  content: '',
  streaming: true,
  buildProgress: { phase: 'structure', appLabel: '家装项目管理', items, done: items.length, total: 8 },
});

const items = [
  { type: 'object', name: 'u9ba_customer' },
  { type: 'app', name: 'home_renovation_management' },
];

/** A finished whole-app build; the envelope varies per case. */
const built = (envelope: Record<string, unknown>): ChatbotEnhancedMessage => {
  const result = { packageId: 'app.u9ba', drafted: items, ...envelope };
  const draftReview = detectDraftResult(result);
  return {
    id: 'built-1',
    role: 'assistant',
    content: '',
    buildProgress: { phase: 'done', appLabel: '家装项目管理', items, done: 2, total: 2 },
    toolInvocations: [
      {
        toolCallId: 'apply-1',
        toolName: 'apply_blueprint',
        state: 'output-available',
        result,
        ...(draftReview ? { draftReview } : {}),
      },
    ],
  };
};

describe('objectstack#26469 — progress items show labels', () => {
  it('a frame item with a label shows the label; one without falls back to the machine name', () => {
    render(
      <ChatbotEnhanced
        isLoading
        messages={[
          building([
            { type: 'object', name: 'u9ba_customer', label: '客户' },
            { type: 'view', name: 'u9ba_project.project_list' },
          ]),
        ]}
      />,
    );
    const panel = screen.getByTestId('build-progress');
    expect(panel).toHaveTextContent('客户');
    expect(panel).not.toHaveTextContent('u9ba_customer');
    expect(panel).toHaveTextContent('u9ba_project.project_list');
  });

  it('the stream reader keeps an item label and leaves it off when the frame has none', () => {
    const out = uiMessageToChatMessage({
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'data-build-progress',
          id: 'build-progress',
          data: {
            phase: 'structure',
            items: [
              { type: 'object', name: 'u9ba_customer', label: '客户' },
              { type: 'object', name: 'u9ba_project' },
            ],
          },
        },
      ],
    });
    expect(out.buildProgress?.items).toEqual([
      { type: 'object', name: 'u9ba_customer', label: '客户' },
      { type: 'object', name: 'u9ba_project' },
    ]);
  });
});

describe('objectstack#26469 — the card hands its answer to the host', () => {
  it('a published build reports its label and live', () => {
    const onBuildResult = vi.fn();
    render(<ChatbotEnhanced messages={[built({ status: 'published' })]} onBuildResult={onBuildResult} />);
    expect(onBuildResult).toHaveBeenLastCalledWith({
      appName: 'home_renovation_management',
      label: '家装项目管理',
      live: true,
    });
  });

  it('an unpublished build reports not live, and reports again once it is published', () => {
    const onBuildResult = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced messages={[built({ status: 'drafted' })]} onBuildResult={onBuildResult} />,
    );
    expect(onBuildResult).toHaveBeenLastCalledWith({
      appName: 'home_renovation_management',
      label: '家装项目管理',
      live: false,
    });
    rerender(<ChatbotEnhanced messages={[built({ status: 'published' })]} onBuildResult={onBuildResult} />);
    expect(onBuildResult).toHaveBeenLastCalledWith({
      appName: 'home_renovation_management',
      label: '家装项目管理',
      live: true,
    });
  });

  it('the checklist label wins over the stream label, as on the card title', () => {
    const onBuildResult = vi.fn();
    const message = built({
      status: 'published',
      checklist: {
        status: 'passed',
        passed: 1,
        total: 1,
        app: { name: 'home_renovation_management', label: '家装项目' },
        lines: [{ kind: 'object', status: 'passed', line: '对象 1 个' }],
      },
    });
    render(<ChatbotEnhanced messages={[message]} onBuildResult={onBuildResult} />);
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent(/· 家装项目$/);
    expect(onBuildResult).toHaveBeenLastCalledWith({
      appName: 'home_renovation_management',
      label: '家装项目',
      live: true,
    });
  });
});

describe('objectstack#26469 — a listed materialized build is live', () => {
  it('materialized with appHidden: false reads live on the card and in the report', () => {
    const onBuildResult = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[built({ status: 'drafted', materialized: true, appHidden: false })]}
        onBuildResult={onBuildResult}
      />,
    );
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent(/^Built and live · 家装项目管理$/);
    expect(onBuildResult).toHaveBeenLastCalledWith(expect.objectContaining({ live: true }));
  });

  it('materialized with appHidden: true is not live', () => {
    const onBuildResult = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[built({ status: 'drafted', materialized: true, appHidden: true })]}
        onBuildResult={onBuildResult}
      />,
    );
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent(/^Built 家装项目管理$/);
    expect(onBuildResult).toHaveBeenLastCalledWith(expect.objectContaining({ live: false }));
  });

  it('the draft review lifts appHidden only when the envelope says it', () => {
    expect(detectDraftResult({ status: 'drafted', drafted: items, appHidden: false })?.appHidden).toBe(false);
    expect(detectDraftResult({ status: 'drafted', drafted: items })).not.toHaveProperty('appHidden');
  });
});

describe('objectstack#26469 — the posture footnote names Publish in the chat', () => {
  it('zh', () => {
    render(inLocale('zh', <ChatbotEnhanced messages={[built({ status: 'published' })]} onOpenBuiltApp={vi.fn()} />));
    expect(screen.getByTestId('build-result-posture')).toHaveTextContent('之后的修改先存草稿，在对话里点「发布」即可上线。');
  });
});
