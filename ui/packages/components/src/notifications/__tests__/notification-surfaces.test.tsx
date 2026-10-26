/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Notification presentation coverage (#3014).
 *
 * `NotificationProvider` used to hand EVERY notification to the host's
 * `onToast` delegate, so all five spec display types presented identically —
 * an author picking `banner` got a toast. These tests pin the opposite: each
 * spec `NotificationTypeSchema` member reaches its own surface, and the
 * surfaces are distinguishable in the DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationTypeSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import {
  NOTIFICATION_PRESENTATIONS,
  NotificationProvider,
  useNotifications,
  type NotificationItem,
  type NotificationPresentation,
  type NotificationSystemConfig,
} from '@object-ui/react';
import { NotificationBanners } from '../NotificationBanners';
import { NotificationSnackbar } from '../NotificationSnackbar';
import { NotificationAlerts } from '../NotificationAlerts';
import { NotificationInline } from '../NotificationInline';
import { notificationActionVariant, notificationIcon, notificationSeverityStyle } from '../severity';

function specDisplayTypes(): string[] {
  return enumOptions(NotificationTypeSchema);
}

type Notify = (input: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => string;

/** Populated once the harness has mounted; the tests raise through it. */
const notifier: { current: Notify | null } = { current: null };

function Raiser() {
  const { notify } = useNotifications();
  React.useEffect(() => { notifier.current = notify; }, [notify]);
  return null;
}

const raise: Notify = (input) => notifier.current!(input);

function Harness({ onToast }: { onToast?: (n: NotificationItem) => void }) {
  return (
    <NotificationProvider onToast={onToast}>
      <Raiser />
      <NotificationBanners />
      <NotificationInline scope="form-a" />
      <NotificationInline />
      <NotificationSnackbar />
      <NotificationAlerts />
    </NotificationProvider>
  );
}

/** The surface element a notification title actually rendered into, if any. */
function surfaceOf(title: string): string | null {
  const host = screen.queryByText(title)?.closest('[data-notification-surface]');
  return host?.getAttribute('data-notification-surface') ?? null;
}

describe('every spec display type has its own surface', () => {
  it('the presentation table covers NotificationTypeSchema exactly', () => {
    const spec = specDisplayTypes();
    expect(spec, 'could not read NotificationTypeSchema from the spec').not.toEqual([]);
    expect([...spec].sort()).toEqual(Object.keys(NOTIFICATION_PRESENTATIONS).sort());
  });

  it('no two display types share a surface', () => {
    const surfaces = Object.values(NOTIFICATION_PRESENTATIONS).map((p) => p.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });
});

describe('notification surfaces', () => {
  beforeEach(() => {
    render(<Harness onToast={vi.fn()} />);
  });

  it('renders a banner as an in-flow strip, not an overlay', () => {
    act(() => { raise({ title: 'Draft mode', message: 'Unpublished', severity: 'warning', displayType: 'banner' }); });

    expect(surfaceOf('Draft mode')).toBe('banner');
    expect(screen.getByText('Unpublished')).toBeInTheDocument();
    // A banner takes space in the flow — never `fixed`/`absolute` positioned.
    const strip = screen.getByText('Draft mode').closest('[data-notification-surface="banner"]')!;
    expect(strip.className).not.toMatch(/\b(fixed|absolute)\b/);
  });

  it('renders a snackbar bottom-anchored, superseding rather than stacking', () => {
    act(() => { raise({ title: 'Item moved', severity: 'info', displayType: 'snackbar' }); });
    expect(surfaceOf('Item moved')).toBe('snackbar');

    act(() => { raise({ title: 'Item deleted', severity: 'info', displayType: 'snackbar' }); });
    expect(surfaceOf('Item deleted')).toBe('snackbar');
    expect(screen.queryByText('Item moved')).not.toBeInTheDocument();

    const bar = screen.getByText('Item deleted').closest('[data-notification-surface="snackbar"]')!;
    expect(bar.className).toMatch(/fixed/);
    expect(bar.className).toMatch(/bottom-4/);
  });

  it('renders an alert as a blocking dialog with an acknowledgement', async () => {
    const user = userEvent.setup();
    act(() => { raise({ title: 'Session expired', message: 'Sign in again', severity: 'error', displayType: 'alert' }); });

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAttribute('data-notification-surface', 'alert');
    expect(screen.getByText('Session expired')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('queues alerts FIFO — the oldest is the one being acknowledged', async () => {
    const user = userEvent.setup();
    act(() => {
      raise({ title: 'First alert', severity: 'error', displayType: 'alert' });
      raise({ title: 'Second alert', severity: 'error', displayType: 'alert' });
    });

    await screen.findByRole('alertdialog');
    expect(screen.getByText('First alert')).toBeInTheDocument();
    expect(screen.queryByText('Second alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(await screen.findByText('Second alert')).toBeInTheDocument();
  });

  it('renders inline notifications at the raising surface only', () => {
    act(() => {
      raise({ title: 'Fix 2 fields', severity: 'error', displayType: 'inline', scope: 'form-a' });
      raise({ title: 'Page notice', severity: 'info', displayType: 'inline' });
    });

    const scoped = screen.getByText('Fix 2 fields').closest('[data-notification-surface="inline"]')!;
    expect(scoped).toHaveAttribute('data-scope', 'form-a');
    const unscoped = screen.getByText('Page notice').closest('[data-notification-surface="inline"]')!;
    expect(unscoped).not.toHaveAttribute('data-scope');
    // In place, never floating.
    expect(scoped.className).not.toMatch(/\b(fixed|absolute)\b/);
  });

  it('leaves toasts to the host delegate — no surface renders them', () => {
    act(() => { raise({ title: 'Saved', severity: 'success', displayType: 'toast' }); });

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('dismisses a banner from its own control', async () => {
    const user = userEvent.setup();
    act(() => { raise({ title: 'Dismiss me', severity: 'info', displayType: 'banner' }); });

    await user.click(screen.getByRole('button', { name: 'Dismiss Dismiss me' }));
    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
  });

  it('omits the dismiss control when dismissible is false', () => {
    act(() => { raise({ title: 'Sticky', severity: 'warning', displayType: 'banner', dismissible: false }); });

    expect(screen.queryByRole('button', { name: 'Dismiss Sticky' })).not.toBeInTheDocument();
  });

  it('renders a surface whose notification declares an icon override', () => {
    act(() => {
      raise({ title: 'Deploy finished', severity: 'success', displayType: 'banner', icon: 'rocket' });
    });

    // The resolution contract is pinned on `notificationIcon`; here the point is
    // only that a declared icon reaches the surface without breaking it.
    expect(surfaceOf('Deploy finished')).toBe('banner');
  });

  it('runs a snackbar action and clears the snackbar', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    act(() => {
      raise({
        title: 'Row deleted', severity: 'info', displayType: 'snackbar',
        actions: [{ label: 'Undo', onClick }],
      });
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Row deleted')).not.toBeInTheDocument();
  });
});

/**
 * The spec `icon` — a second value that was stored and never read. Every
 * surface resolves it through `notificationIcon`, so the override behaves the
 * same on a banner, a snackbar, an alert and an inline message.
 */
describe('notificationIcon', () => {
  it('uses the severity icon when no override is declared', () => {
    expect(notificationIcon({ severity: 'error' }))
      .toBe(notificationSeverityStyle('error').Icon);
  });

  it('honors a declared Lucide icon over the severity default', () => {
    const resolved = notificationIcon({ severity: 'error', icon: 'rocket' });
    expect(resolved).not.toBe(notificationSeverityStyle('error').Icon);
    expect(resolved).toBeTruthy();
  });

  it('accepts the PascalCase spelling too', () => {
    expect(notificationIcon({ severity: 'info', icon: 'CircleCheck' }))
      .not.toBe(notificationSeverityStyle('info').Icon);
  });

  it('falls back to the severity icon for a name Lucide does not have', () => {
    // NOT `getLazyIcon`'s `Database` glyph: on a notification the severity icon
    // is always the better fallback, so a typo costs the override and no more.
    expect(notificationIcon({ severity: 'warning', icon: 'not-a-real-icon' }))
      .toBe(notificationSeverityStyle('warning').Icon);
  });
});

/**
 * The config used to be inert — `maxVisible` was carried and unread while
 * `NotificationBanners` capped at a hard-coded 3 of its own, and no
 * notification could declare a `position` at all.
 */
describe('config-driven surface behaviour', () => {
  function renderWith(config: NotificationSystemConfig) {
    return render(
      <NotificationProvider config={config} onToast={vi.fn()}>
        <Raiser />
        <NotificationBanners />
        <NotificationSnackbar />
      </NotificationProvider>,
    );
  }

  it('caps the banner stack at maxVisible, keeping the newest', () => {
    renderWith({ maxVisible: 2 });
    act(() => {
      raise({ title: 'B oldest', severity: 'info', displayType: 'banner' });
      raise({ title: 'B middle', severity: 'info', displayType: 'banner' });
      raise({ title: 'B newest', severity: 'info', displayType: 'banner' });
    });

    expect(screen.queryByText('B oldest')).not.toBeInTheDocument();
    expect(screen.getByText('B middle')).toBeInTheDocument();
    expect(screen.getByText('B newest')).toBeInTheDocument();
  });

  /** Banner titles in DOM order. */
  function bannerOrder(): string[] {
    return [...document.querySelectorAll('[data-notification-surface="banner"] [role="status"]')]
      .map((el) => el.querySelector('span')?.textContent ?? '');
  }

  it('grows the banner stack downward by default — newest below', () => {
    renderWith({});
    act(() => {
      raise({ title: 'B first', severity: 'info', displayType: 'banner' });
      raise({ title: 'B second', severity: 'info', displayType: 'banner' });
    });

    expect(bannerOrder()).toEqual(['B first', 'B second']);
  });

  it('grows the banner stack upward when stackDirection says so', () => {
    renderWith({ stackDirection: 'up' });
    act(() => {
      raise({ title: 'B first', severity: 'info', displayType: 'banner' });
      raise({ title: 'B second', severity: 'info', displayType: 'banner' });
    });

    expect(bannerOrder()).toEqual(['B second', 'B first']);
  });

  it('keeps the snackbar on its own anchor when nothing declares a position', () => {
    renderWith({});
    act(() => { raise({ title: 'Anchored', severity: 'info', displayType: 'snackbar' }); });

    const bar = screen.getByText('Anchored').closest('[data-notification-surface="snackbar"]')!;
    expect(bar).not.toHaveAttribute('data-position');
    expect(bar.className).toMatch(/bottom-4/);
  });

  it('moves the snackbar to the configured default position', () => {
    renderWith({ defaultPosition: 'top_right' });
    act(() => { raise({ title: 'Top right', severity: 'info', displayType: 'snackbar' }); });

    const bar = screen.getByText('Top right').closest('[data-notification-surface="snackbar"]')!;
    expect(bar).toHaveAttribute('data-position', 'top_right');
    expect(bar.className).toMatch(/top-4/);
    expect(bar.className).toMatch(/right-4/);
  });

  it("lets a notification's own position beat the configured default", () => {
    renderWith({ defaultPosition: 'top_right' });
    act(() => {
      raise({ title: 'Bottom left', severity: 'info', displayType: 'snackbar', position: 'bottom_left' });
    });

    const bar = screen.getByText('Bottom left').closest('[data-notification-surface="snackbar"]')!;
    expect(bar).toHaveAttribute('data-position', 'bottom_left');
  });
});

describe('action variants', () => {
  it('maps the spec vocabulary onto Button variants', () => {
    expect(notificationActionVariant('primary')).toBe('default');
    expect(notificationActionVariant('secondary')).toBe('secondary');
    expect(notificationActionVariant('link')).toBe('link');
  });

  it('defaults to the spec default (primary)', () => {
    expect(notificationActionVariant()).toBe('default');
  });
});

describe('presentation coverage', () => {
  it('presents a notification of EVERY spec display type distinctly', () => {
    const onToast = vi.fn();
    render(<Harness onToast={onToast} />);

    const seen = new Map<string, string>();
    for (const displayType of specDisplayTypes()) {
      const title = `Notice ${displayType}`;
      act(() => { raise({ title, severity: 'info', displayType: displayType as NotificationPresentation }); });
      // `toast` is presented by the host delegate, everything else by a surface.
      seen.set(displayType, surfaceOf(title) ?? 'delegate');
    }

    expect(onToast).toHaveBeenCalledTimes(1);
    // One surface per display type — the collapse this issue is about would
    // show the same value five times (or `delegate` for all of them).
    expect(new Set(seen.values()).size).toBe(seen.size);
  });
});
