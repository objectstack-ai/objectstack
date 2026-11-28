/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#38048 — the draft review card reads its strings from the shipped
 * packs (`chatbot.draftReview.*`), the problem count through its plural family.
 *
 * In its own file because a mounted `I18nProvider` installs a module-level
 * i18next global: the provider-less renders of `DraftReviewCard-38048.test.tsx`
 * would otherwise read this file's pack.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DraftReviewListParsed } from '@objectstack/spec/ai';
import { DraftReviewCard } from '../chat/DraftReviewCard';

afterEach(() => {
  cleanup();
});

const ISSUE = {
  rule: 'flow-multi-write-unfiltered',
  path: 'flows[0].nodes[1].config.multi',
  where: 'flow "close_invoices" · node "update"',
  message: 'A multi-record write names no filter.',
  hint: 'Add a filter.',
  severity: 'error' as const,
};

/** A draft with `count` refusals. */
const refused = (count: number): DraftReviewListParsed => ({
  drafts: [
    {
      type: 'flow',
      name: 'close_invoices',
      package: 'billing',
      verdict: { publishable: false, refusals: Array.from({ length: count }, () => ISSUE), advisories: [] },
      verdictRead: 'turn-end',
      review: {
        changes: '/studio/billing/data?changes=review',
        item: '/studio/billing/metadata/flow/close_invoices?review=1',
      },
    },
  ],
  omitted: 3,
});

function renderIn(language: string, list: DraftReviewListParsed) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <DraftReviewCard review={list} />
    </I18nProvider>,
  );
}

const badge = () => within(screen.getByTestId('draft-review-card')).getByTestId('draft-review-verdict');

describe('objectstack#38048 — the card in the shipped packs', () => {
  it('en: the title, the Review link name and the problem count', async () => {
    renderIn('en', refused(1));
    expect(await screen.findByText('Drafts saved in this turn')).toBeInTheDocument();
    expect(badge()).toHaveTextContent('1 problem');
    expect(screen.getByRole('link', { name: 'Review the draft close_invoices in Studio' })).toBeInTheDocument();
    expect(screen.getByTestId('draft-review-omitted')).toHaveTextContent('+3 more');
  });

  it('zh-Hans: the pack strings, not the English defaults', async () => {
    renderIn('zh-Hans', refused(2));
    expect(await screen.findByText('本轮保存的草稿')).toBeInTheDocument();
    expect(badge()).toHaveTextContent('2 个问题');
    expect(screen.getByRole('link', { name: '在 Studio 中审阅并发布包 billing 的草稿' })).toBeInTheDocument();
  });

  it('ru: the few and many forms of the problem count', async () => {
    renderIn('ru', refused(3));
    expect(await screen.findByText('Черновики, сохранённые в этом ходе')).toBeInTheDocument();
    expect(badge()).toHaveTextContent('3 проблемы');
    cleanup();
    renderIn('ru', refused(5));
    expect(await screen.findByText('5 проблем')).toBeInTheDocument();
  });
});
