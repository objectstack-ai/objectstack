import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const remove = vi.fn(async () => undefined);
const rename = vi.fn(async () => undefined);

vi.mock('../../../hooks/useConversationList', () => ({
  useConversationList: () => ({
    conversations: [
      {
        id: 'conv-a',
        title: 'Pipeline review',
        preview: 'Show recent opportunities',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'conv-b',
        title: undefined,
        preview: 'How many users are in the system?',
        updatedAt: new Date(Date.now() - 1000).toISOString(),
      },
    ],
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
    remove,
    rename,
  }),
}));

// `importOriginal` spread, not a hand-written object: this file's import graph
// reaches `@object-ui/plugin-chatbot`, whose `AiPendingActionsInbox` resolves
// `createSafeTranslation` from this package AT MODULE SCOPE. A frozen factory
// makes that read `undefined` and the file dies during COLLECTION — before a
// single test runs, so it does not look like a test failure (objectui#6849,
// the shape `scripts/check-vi-mock-inherit.mjs` exists to stop). Only
// `useObjectTranslation` is overridden; everything else is the real module.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => ({
      'common.loading': 'Loading…',
      'console.ai.chats': 'Chats',
      'console.ai.newChat': 'New',
      'console.ai.searchChats': 'Search chats…',
      'console.ai.noChatsYet': 'No chats yet',
      'console.ai.noChatsDescription': 'Start a new conversation to see it here.',
      'console.ai.noMatchingChats': 'No matching chats.',
      'console.ai.newConversation': 'New conversation',
      'console.ai.renameConversation': 'Rename conversation',
      'console.ai.deleteConversation': 'Delete conversation',
      'console.ai.saveRename': 'Save rename',
      'console.ai.cancelRename': 'Cancel rename',
    } as Record<string, string>)[key] ?? key,
  }),
}));

import { ConversationsSidebar } from '../ConversationsSidebar';

function renderSidebar(onNavigate = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/ai/conv-a']}>
      <Routes>
        <Route
          path="/ai/:conversationId"
          element={
            <ConversationsSidebar
              userId="u1"
              apiBase="/api/v1/ai"
              onNavigate={onNavigate}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onNavigate };
}

describe('ConversationsSidebar', () => {
  it('renders row actions as real buttons and closes mobile chrome after navigation', () => {
    const { onNavigate } = renderSidebar();

    fireEvent.click(screen.getByTestId('ai-conversation-select-conv-a'));
    expect(onNavigate).toHaveBeenCalledTimes(1);

    expect(screen.getAllByLabelText('Rename conversation')).toHaveLength(2);
    expect(screen.getAllByLabelText('Delete conversation')).toHaveLength(2);
    expect(screen.getByText('How many users are in the system?')).toBeInTheDocument();
  });

  it('exposes the absolute date as a title tooltip on the relative timestamp', () => {
    renderSidebar();
    const stamp = screen.getAllByText('console.ai.justNow')[0];
    const title = stamp.getAttribute('title') ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(/\d/.test(title)).toBe(true);
  });

  it('filters by query and highlights the matched substring', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('Search chats…'), {
      target: { value: 'pipe' },
    });
    // Non-matching conversation is filtered out.
    expect(
      screen.queryByText('How many users are in the system?'),
    ).not.toBeInTheDocument();
    // The matched substring is wrapped in a <mark> (case-insensitive, original case kept).
    const mark = document.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent(/pipe/i);
  });
});
