/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13133 — the inbox header read "4 total · 1 notifications + 3
 * pending approvals". `notifications.badgeNotifications` interpolated a named
 * `{{unread}}`, so i18next never plural-selected and every pack had one form.
 * The call site now passes `count` and the packs carry the family, exactly
 * as `notifications.approvalsPending` beside it already did; `badgeApprovals`
 * had the same defect one span over and was converted with it.
 *
 * These render the popover against a REAL i18next instance and the shipped
 * `en` pack — the sibling `InboxPopover.badgeBreakdown.test.tsx` stubs `t()`
 * with a plain interpolator that cannot plural-select, so it cannot see this.
 */
import '@testing-library/jest-dom/vitest';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

/** N distinct unread topics (each its own `(topic, title)` pair). */
const distinctUnread = (n: number): InboxNotification[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    type: `topic.${i}`,
    title: `Topic ${i}`,
    is_read: false,
    created_at: '2026-08-10T10:00:00Z',
  }));

function renderPopover(unread: number, pendingApprovalsCount: number) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={i18n} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
  const notifications = distinctUnread(unread);
  return render(
    <InboxPopover
      notifications={notifications}
      unreadCount={notifications.length}
      pendingApprovalsCount={pendingApprovalsCount}
      activity={{ value: [], status: 'ready', readable: true }}
      onMarkAllRead={vi.fn()}
      onMarkRead={vi.fn()}
    />,
    { wrapper },
  );
}

describe('InboxPopover — badge breakdown agrees in number (objectui#13133)', () => {
  it('reads "1 notification" for one unread topic, and "1 pending approval" for one approval', () => {
    renderPopover(1, 1);
    expect(screen.getByTestId('inbox-badge-breakdown-notifications')).toHaveTextContent(/^1 notification$/);
    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(/^1 pending approval$/);
  });

  it('reads "3 notifications" and "3 pending approvals" for three', () => {
    renderPopover(3, 3);
    expect(screen.getByTestId('inbox-badge-breakdown-notifications')).toHaveTextContent(/^3 notifications$/);
    expect(screen.getByTestId('inbox-badge-breakdown-approvals')).toHaveTextContent(/^3 pending approvals$/);
  });

  it('CONTROL: the Approvals tab body keeps its own plural family (notifications.approvalsPending)', () => {
    renderPopover(0, 1);
    expect(screen.getByText('1 pending approval', { selector: 'div' })).toBeInTheDocument();
  });
});
