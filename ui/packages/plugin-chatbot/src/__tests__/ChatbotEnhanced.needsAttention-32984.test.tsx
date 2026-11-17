/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#32984 — the published draft badge's failed-item suffix
 * ("· N need attention") was hard-coded English, with an `s` picked on `=== 1`,
 * in every locale. It now goes through the pack as a count family, so a zh
 * console reads 「2 项需要处理」 and English agrees with its number.
 *
 * The publish-health line under the Published badge ("N sample rows live",
 * "N views verified") spoke the same hard-coded English; it reads the pack too,
 * while the findings it lists stay the producer's text.
 *
 * Its own file: `I18nProvider` installs a module-level i18next global, which
 * would leak into the provider-less renders of the other #32984 pins.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import type { ChatbotEnhancedMessage, PublishHealth } from '../ChatbotEnhanced';

/** A drafted build whose package is already published, with `failed` items. */
function publishedWithFailures(failedCount: number): ChatbotEnhancedMessage[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolInvocations: [
        {
          toolCallId: 't1',
          toolName: 'apply_blueprint',
          state: 'output-available',
          draftReview: {
            items: [{ type: 'object', name: 'customer' }],
            packageId: 'app.crm',
            failedCount,
          },
        },
      ],
    } as unknown as ChatbotEnhancedMessage,
  ];
}

function renderIn(language: string, failedCount: number) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ChatbotEnhanced
        messages={publishedWithFailures(failedCount)}
        onSendMessage={vi.fn()}
        onPublishDrafts={vi.fn()}
        publishedLabel="PUBLISHED"
        // The server's live count: nothing pending, so the card reads published.
        fetchPendingDraftCount={async () => 0}
      />
    </I18nProvider>,
  );
}

describe('objectstack#32984 — the published badge counts failed items through the pack', () => {
  it('zh-Hans reads the pack, not English', async () => {
    renderIn('zh-Hans', 2);
    expect(await screen.findByText(/PUBLISHED · 2 项需要处理/)).toBeInTheDocument();
    expect(screen.queryByText(/attention/)).not.toBeInTheDocument();
  });

  it('en agrees with its number: one needs, two need', async () => {
    const { unmount } = renderIn('en', 1);
    expect(await screen.findByText(/PUBLISHED · 1 needs attention/)).toBeInTheDocument();
    unmount();
    renderIn('en', 2);
    expect(await screen.findByText(/PUBLISHED · 2 need attention/)).toBeInTheDocument();
  });

  it('control: no failed items, no suffix', async () => {
    renderIn('en', 0);
    expect(await screen.findByText('PUBLISHED')).toBeInTheDocument();
    expect(screen.queryByText(/attention/)).not.toBeInTheDocument();
  });
});

/** Auto-publish a drafted build whose host answers `health`, under `language`. */
async function publishHealthIn(language: string, health: PublishHealth) {
  const user = { id: 'u1', role: 'user', content: 'build it' } as ChatbotEnhancedMessage;
  const drafted = {
    id: 'a1',
    role: 'assistant',
    content: 'Built your app.',
    toolInvocations: [
      {
        toolCallId: 'tc-health',
        toolName: 'apply_blueprint',
        state: 'output-available',
        draftReview: { items: [{ type: 'object', name: 'task' }], packageId: 'app.todo', autoPublishable: true },
      },
    ],
  } as unknown as ChatbotEnhancedMessage;
  const onPublishDrafts = vi.fn().mockResolvedValue({ ok: true, health });
  const wrap = (messages: ChatbotEnhancedMessage[], isLoading: boolean) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ChatbotEnhanced autoPublishDrafts isLoading={isLoading} messages={messages} onPublishDrafts={onPublishDrafts} />
    </I18nProvider>
  );
  const view = render(wrap([user], true));
  view.rerender(wrap([user, drafted], false));
  await waitFor(() => expect(screen.getByTestId('publish-health')).toBeInTheDocument());
  return view;
}

describe('objectstack#32984 — the publish-health line reads the pack', () => {
  it('zh-Hans: the counts and the verified claim are Chinese, not English', async () => {
    await publishHealthIn('zh-Hans', { seededRows: 6, checked: { seeds: 1, views: 2, widgets: 3 }, issues: [] });
    expect(screen.getByTestId('publish-health')).toHaveTextContent(
      '6 条示例数据已上线 · 已核对 2 个视图 · 3 个仪表盘组件 · 1 组示例数据',
    );
    expect(screen.queryByText(/sample|verified|view/)).not.toBeInTheDocument();
  });

  it('ru: each count agrees with its number (one, few, many)', async () => {
    await publishHealthIn('ru', { seededRows: 1, checked: { seeds: 5, views: 3, widgets: 21 }, issues: [] });
    expect(screen.getByTestId('publish-health')).toHaveTextContent(
      'опубликована 1 строка примеров · Проверено: 3 представления · 21 виджет · 5 наборов примеров',
    );
  });

  it('en agrees with its number: one row, two views', async () => {
    await publishHealthIn('en', { seededRows: 1, checked: { seeds: 0, views: 2, widgets: 1 }, issues: [] });
    expect(screen.getByTestId('publish-health')).toHaveTextContent('1 sample row live · 2 views · 1 widget verified');
  });

  it('control: the findings it lists stay the producer text, in any locale', async () => {
    await publishHealthIn('zh-Hans', {
      seededRows: 4,
      checked: { seeds: 1, views: 1, widgets: 0 },
      issues: [{ severity: 'error', code: 'empty_query', message: 'widget "w1" returns NO data' }],
    });
    expect(screen.getByText('4 条示例数据已上线')).toBeInTheDocument();
    expect(screen.getByText('widget "w1" returns NO data')).toBeInTheDocument();
    // An error withholds the verified claim, in Chinese as in English.
    expect(screen.queryByText(/已核对/)).not.toBeInTheDocument();
  });
});
