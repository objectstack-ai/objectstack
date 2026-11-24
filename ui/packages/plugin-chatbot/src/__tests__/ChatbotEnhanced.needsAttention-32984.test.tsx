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
 * "N views verified") spoke the same hard-coded English; it reads the pack too.
 * Its findings (ruling B: the producer writes the customer sentence) show a
 * finding's `userMessage` on the line; without one, the generic sentence the
 * draft-issues block says. The agent text (`message`, `fix`) and the seed
 * loader's engine text move under the folded "Technical details".
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

  it('control: an error withholds the verified claim, in Chinese as in English', async () => {
    await publishHealthIn('zh-Hans', {
      seededRows: 4,
      checked: { seeds: 1, views: 1, widgets: 0 },
      issues: [{ severity: 'error', code: 'empty_query', message: 'widget "w1" returns NO data' }],
    });
    expect(screen.getByText('4 条示例数据已上线')).toBeInTheDocument();
    expect(screen.queryByText(/已核对/)).not.toBeInTheDocument();
  });
});

/** The text of the line itself: everything in it except the folded details. */
function lineText(): string {
  const root = screen.getByTestId('publish-health').cloneNode(true) as HTMLElement;
  root.querySelectorAll('details').forEach((d) => d.remove());
  return root.textContent ?? '';
}

/** The folded technical details, which must stay closed until opened. */
function detailsText(): string {
  const details = screen.getByTestId('publish-health-details');
  expect(details).not.toHaveAttribute('open');
  return details.textContent ?? '';
}

describe('objectstack#32984 — a finding speaks on the line only through its producer\'s customer sentence', () => {
  const AGENT = 'Seed "b6bl_project_sample" loaded 0 rows into object "b6bl_project"';
  const FIX = 'Check the publish response\'s seedApplied for the load error, and republish the seed.';

  it('a finding with a userMessage shows it, and its agent text leaves the line', async () => {
    await publishHealthIn('zh-Hans', {
      checked: { seeds: 1, views: 0, widgets: 0 },
      issues: [
        { severity: 'error', code: 'seed_no_rows', message: AGENT, fix: FIX, userMessage: '「项目」的示例数据没有加载成功。' },
      ],
    });
    expect(screen.getByTestId('publish-health-finding')).toHaveTextContent('「项目」的示例数据没有加载成功。');
    const line = lineText();
    expect(line).not.toContain(AGENT);
    expect(line).not.toContain(FIX);
    // Every finding here speaks for itself, so no generic sentence joins it.
    expect(screen.queryByTestId('publish-health-summary')).not.toBeInTheDocument();
    expect(detailsText()).toContain(`${AGENT} — ${FIX}`);
    expect(screen.getByText('技术详情')).toBeInTheDocument();
  });

  it('a finding without one shows the generic sentence, and its agent text only under the details', async () => {
    await publishHealthIn('zh-Hans', {
      checked: { seeds: 1, views: 0, widgets: 0 },
      issues: [{ severity: 'error', code: 'seed_no_rows', message: AGENT, fix: FIX }],
    });
    expect(screen.getByTestId('publish-health-summary')).toHaveTextContent(
      '这次搭建有部分内容需要修复后才能使用。回复「修复这些问题」，助手会帮你处理。',
    );
    expect(screen.queryByTestId('publish-health-finding')).not.toBeInTheDocument();
    expect(lineText()).not.toContain(AGENT);
    expect(detailsText()).toContain(`${AGENT} — ${FIX}`);
  });

  it('warnings alone take the warnings sentence', async () => {
    await publishHealthIn('en', {
      checked: { seeds: 0, views: 1, widgets: 1 },
      issues: [{ severity: 'warning', code: 'probes_unavailable', message: '1 widget not probed' }],
    });
    expect(screen.getByTestId('publish-health-summary')).toHaveTextContent(/The build is ready, with a few things worth checking/);
    expect(lineText()).not.toContain('not probed');
  });

  it('mixed: a voiced finding and an unvoiced one show the sentence and the generic line, both texts under the details', async () => {
    await publishHealthIn('en', {
      checked: { seeds: 1, views: 1, widgets: 0 },
      issues: [
        { severity: 'error', code: 'seed_no_rows', message: AGENT, userMessage: 'The sample projects did not load.' },
        { severity: 'warning', code: 'probes_unavailable', message: '1 widget not probed' },
      ],
    });
    expect(screen.getByTestId('publish-health-finding')).toHaveTextContent('The sample projects did not load.');
    // An error is in the set, so the generic sentence is the errors one.
    expect(screen.getByTestId('publish-health-summary')).toHaveTextContent(/need fixing/);
    const details = detailsText();
    expect(details).toContain(AGENT);
    expect(details).toContain('1 widget not probed');
  });

  it('a failed seed reads the pack in a non-en locale, and the loader text is a detail', async () => {
    await publishHealthIn('ja', { seedFailed: true, seedError: "seed apply stopped at the seed for object 'b6bl_project': boom" });
    expect(screen.getByTestId('publish-health-seed')).toHaveTextContent('サンプルデータを読み込めませんでした。');
    expect(lineText()).not.toMatch(/seed apply|Sample data/);
    expect(detailsText()).toContain("seed apply stopped at the seed for object 'b6bl_project': boom");
  });

  it('a failed seed with no producer text: the pack sentence, no English, no details', async () => {
    await publishHealthIn('zh-Hans', { seedFailed: true });
    expect(screen.getByTestId('publish-health-seed')).toHaveTextContent('示例数据未能加载。');
    expect(screen.queryByText(/Sample data/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('publish-health-details')).not.toBeInTheDocument();
  });
});
