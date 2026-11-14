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
 * Its own file: `I18nProvider` installs a module-level i18next global, which
 * would leak into the provider-less renders of the other #32984 pins.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import type { ChatbotEnhancedMessage } from '../ChatbotEnhanced';

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
