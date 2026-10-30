/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#27704 — three unread notifications about one topic plus three
 * pending approvals: the header read "4 total · 1 notification + 3 pending
 * approvals" while the one coalesced row read "×3 · 3 unread", so the reader
 * could not tell whether one thing or three were waiting. The badge arithmetic
 * (#7233: unread topics + pending approvals) is unchanged; the header addend
 * now names its unit, and the row it counts is the topic holding the three.
 *
 * Rendered against a REAL i18next instance and the shipped `en` pack, like
 * the sibling `InboxPopover.badgePlural-13133.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ appName: 'setup' }),
}));

vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'setup' }),
}));

type Slot = { children?: ReactNode };

// Passthrough primitives so the popover body renders without driving Radix
// open/close in jsdom (the pattern InboxPopover.badgeBreakdown.test.tsx uses).
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: ({ children, ...p }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...p}>
      {children}
    </button>
  ),
  Popover: ({ children }: Slot) => <div>{children}</div>,
  PopoverTrigger: ({ children }: Slot) => <div>{children}</div>,
  PopoverContent: ({ children }: Slot) => <div>{children}</div>,
  Tabs: ({ children }: Slot) => <div>{children}</div>,
  TabsList: ({ children }: Slot) => <div>{children}</div>,
  TabsTrigger: ({ children }: Slot) => <button type="button">{children}</button>,
  TabsContent: ({ children }: Slot) => <div>{children}</div>,
}));

import { InboxPopover, type InboxNotification } from '../InboxPopover';

/** Three unread rows of one `(topic, title)` pair: one coalesced group. */
const oneTopicThreeUnread: InboxNotification[] = [1, 2, 3].map((i) => ({
  id: `n${i}`,
  type: 'deal.approved',
  title: 'Deal approved',
  body: `Deal D-${i} was approved`,
  is_read: false,
  created_at: `2026-10-29T10:0${i}:00Z`,
}));

function renderPopover() {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={i18n} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
  return render(
    <InboxPopover
      notifications={oneTopicThreeUnread}
      unreadCount={oneTopicThreeUnread.length}
      pendingApprovalsCount={3}
      activity={{ value: [], status: 'ready', readable: true }}
      onMarkAllRead={vi.fn()}
      onMarkRead={vi.fn()}
    />,
    { wrapper },
  );
}

describe('InboxPopover — the header breakdown and the grouped row tell one story (objectstack#27704)', () => {
  it('names the unit: 1 unread topic, whose one row holds the 3 unread', () => {
    renderPopover();
    // #7233 arithmetic untouched: 1 unread topic + 3 pending approvals.
    expect(screen.getByTestId('inbox-badge-breakdown-total')).toHaveTextContent(/^4 total$/);
    expect(screen.getByTestId('inbox-badge-breakdown-notifications')).toHaveTextContent(/^1 unread topic$/);
    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(/^3 pending approvals$/);

    // Exactly one row: the topic the header counted, carrying its 3 unread.
    const row = screen.getByRole('button', { expanded: false });
    expect(within(row).getByText('Deal approved')).toBeInTheDocument();
    expect(within(row).getByText('×3')).toBeInTheDocument();
    expect(row).toHaveTextContent('3 unread');
  });

  it('the grouped row expands to list each of its records', () => {
    renderPopover();
    expect(screen.queryByText('Deal D-2 was approved')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    // D-1 is also the collapsed row's preview line, so it now reads twice.
    expect(screen.getAllByText('Deal D-1 was approved')).toHaveLength(2);
    expect(screen.getByText('Deal D-2 was approved')).toBeInTheDocument();
    expect(screen.getByText('Deal D-3 was approved')).toBeInTheDocument();
  });
});
