/**
 * The console's notification surfaces (#3014 follow-up).
 *
 * `ConsoleShell` mounts `NotificationProvider` plus the surfaces with a single
 * global home (snackbar, alert); `ConsoleLayout` mounts the banners in the
 * content area. These tests pin the wiring: each spec `displayType` raised from
 * inside the console reaches its OWN presentation, and `toast` — and only
 * `toast` — reaches sonner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNotifications, type NotificationItem } from '@object-ui/react';
import { ConsoleShell } from '../ConsoleShell';
import { ConsoleNotificationBanners } from '../../layout/ConsoleNotificationBanners';

// The `toast` surface. Mocked so the assertion is "sonner was asked to show
// exactly this", not "sonner rendered something in jsdom".
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
    dismiss: vi.fn(), custom: vi.fn(), loading: vi.fn(), promise: vi.fn(),
  }),
  Toaster: () => null,
}));

// ADR-0069 gate — unrelated to notifications and needs an AuthProvider above it.
vi.mock('../RemediationOverlay', () => ({ RemediationOverlay: () => null }));

import { toast } from 'sonner';

type Notify = (input: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => string;

/** Populated once the shell has mounted; the tests raise through it. */
const notifier: { current: Notify | null } = { current: null };

function Raiser() {
  const { notify } = useNotifications();
  useEffect(() => { notifier.current = notify; }, [notify]);
  return <div>ROUTE CONTENT</div>;
}

const raise: Notify = (input) => notifier.current!(input);

/** ConsoleShell with the content-area banners `ConsoleLayout` contributes. */
function renderConsole() {
  return render(
    <ConsoleShell>
      <ConsoleNotificationBanners />
      <Raiser />
    </ConsoleShell>,
  );
}

/** The surface element a notification title actually rendered into, if any. */
function surfaceOf(title: string): string | null {
  const host = screen.queryByText(title)?.closest('[data-notification-surface]');
  return host?.getAttribute('data-notification-surface') ?? null;
}

describe('ConsoleShell notification surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifier.current = null;
    renderConsole();
  });

  it('mounts the provider so any console surface can notify', () => {
    expect(screen.getByText('ROUTE CONTENT')).toBeInTheDocument();
    expect(notifier.current).toBeTypeOf('function');
  });

  it('sends a toast to sonner and to no surface', () => {
    act(() => { raise({ title: 'Saved', message: 'Record updated', severity: 'success' }); });

    expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
      description: 'Record updated',
    }));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('renders a banner in the content area, not through sonner', () => {
    act(() => { raise({ title: 'Viewing a draft', severity: 'warning', displayType: 'banner' }); });

    expect(surfaceOf('Viewing a draft')).toBe('banner');
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('renders a snackbar bottom-anchored, not through sonner', () => {
    act(() => { raise({ title: 'Row deleted', severity: 'info', displayType: 'snackbar' }); });

    expect(surfaceOf('Row deleted')).toBe('snackbar');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('renders an alert as a blocking dialog', async () => {
    const user = userEvent.setup();
    act(() => { raise({ title: 'Session expired', severity: 'error', displayType: 'alert' }); });

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAttribute('data-notification-surface', 'alert');
    expect(toast.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the four presentations distinct when raised together', () => {
    act(() => {
      raise({ title: 'N toast', severity: 'info', displayType: 'toast' });
      raise({ title: 'N snackbar', severity: 'info', displayType: 'snackbar' });
      raise({ title: 'N banner', severity: 'info', displayType: 'banner' });
      raise({ title: 'N alert', severity: 'info', displayType: 'alert' });
    });

    const seen = ['N snackbar', 'N banner', 'N alert'].map(surfaceOf);
    expect(seen).toEqual(['snackbar', 'banner', 'alert']);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith('N toast', expect.anything());
  });
});

describe('ConsoleNotificationBanners outside a NotificationProvider', () => {
  it('renders nothing instead of throwing', () => {
    // `ConsoleLayout` is a composable piece — a host may assemble it without
    // `ConsoleShell`. `useNotifications()` throws there, which would white-screen
    // the app; the guard has to keep that from happening.
    expect(() => render(<ConsoleNotificationBanners />)).not.toThrow();
  });
});
