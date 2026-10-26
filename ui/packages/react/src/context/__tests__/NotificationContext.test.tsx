/**
 * Tests for NotificationProvider and useNotifications
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  NOTIFICATION_PRESENTATIONS,
  NotificationProvider,
  resolveNotificationConfig,
  resolveNotificationPosition,
  resolveNotificationPresentation,
  useNotifications,
  useNotificationsByPresentation,
  useHasNotificationProvider,
  visibleNotificationStack,
  type NotificationItem,
  type NotificationPositionValue,
  type NotificationPresentation,
} from '../NotificationContext';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <NotificationProvider>{children}</NotificationProvider>
);

describe('NotificationProvider', () => {
  it('provides notifications context', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('adds a notification via notify', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ title: 'Hello', severity: 'info' });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].title).toBe('Hello');
    expect(result.current.unreadCount).toBe(1);
  });

  it('adds info notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.info('Info title', 'Info message');
    });

    expect(result.current.notifications[0].severity).toBe('info');
  });

  it('adds success notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.success('Success!');
    });

    expect(result.current.notifications[0].severity).toBe('success');
  });

  it('adds warning notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.warning('Warning!');
    });

    expect(result.current.notifications[0].severity).toBe('warning');
  });

  it('adds error notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.error('Error!');
    });

    expect(result.current.notifications[0].severity).toBe('error');
  });

  it('marks notification as read', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    let id: string = '';
    act(() => {
      id = result.current.info('Test');
    });

    act(() => {
      result.current.markAsRead(id);
    });

    expect(result.current.notifications[0].read).toBe(true);
    expect(result.current.unreadCount).toBe(0);
  });

  it('marks all as read', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.info('Test 1');
      result.current.info('Test 2');
    });

    act(() => {
      result.current.markAllAsRead();
    });

    expect(result.current.unreadCount).toBe(0);
  });

  it('dismisses a notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    let id: string = '';
    act(() => {
      id = result.current.info('Test');
    });

    act(() => {
      result.current.dismiss(id);
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('clears all notifications', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.info('Test 1');
      result.current.info('Test 2');
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('calls onToast handler', () => {
    const onToast = vi.fn();
    const customWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <NotificationProvider onToast={onToast}>{children}</NotificationProvider>
    );

    const { result } = renderHook(() => useNotifications(), {
      wrapper: customWrapper,
    });

    act(() => {
      result.current.info('Toast test');
    });

    expect(onToast).toHaveBeenCalledTimes(1);
    // The resolved config rides along so the delegate can honor the parts of
    // the contract only it can apply (`defaultPosition`).
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Toast test', severity: 'info' }),
      expect.objectContaining({ defaultDuration: 5000, maxVisible: 5 }),
    );
  });
});

/**
 * Presentation routing (#3014).
 *
 * `onToast` used to receive EVERY notification, so a `banner` and an `inline`
 * both surfaced as a toast — the value reached the delegate but nothing branched
 * on it. Each presentation now goes to its own surface.
 */
describe('displayType routes to a distinct presentation', () => {
  const warn = vi.spyOn(console, 'warn');
  beforeEach(() => { warn.mockImplementation(() => {}); });
  afterEach(() => { warn.mockReset(); });

  function setup(onToast?: (n: unknown) => void) {
    const customWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <NotificationProvider onToast={onToast}>{children}</NotificationProvider>
    );
    return renderHook(
      () => ({
        ctx: useNotifications(),
        toast: useNotificationsByPresentation('toast'),
        snackbar: useNotificationsByPresentation('snackbar'),
        banner: useNotificationsByPresentation('banner'),
        alert: useNotificationsByPresentation('alert'),
        inline: useNotificationsByPresentation('inline'),
      }),
      { wrapper: customWrapper },
    );
  }

  it('hands the toast delegate ONLY the toast notifications', () => {
    const onToast = vi.fn();
    const { result } = setup(onToast);

    act(() => {
      result.current.ctx.notify({ title: 'A toast', severity: 'info', displayType: 'toast' });
      result.current.ctx.notify({ title: 'A banner', severity: 'warning', displayType: 'banner' });
      result.current.ctx.notify({ title: 'A snackbar', severity: 'info', displayType: 'snackbar' });
      result.current.ctx.notify({ title: 'An alert', severity: 'error', displayType: 'alert' });
      result.current.ctx.notify({ title: 'Inline', severity: 'info', displayType: 'inline' });
    });

    expect(onToast).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A toast' }),
      expect.anything(),
    );
  });

  it('exposes each notification to exactly one presentation surface', () => {
    const { result } = setup(vi.fn());

    act(() => {
      result.current.ctx.notify({ title: 'A toast', severity: 'info', displayType: 'toast' });
      result.current.ctx.notify({ title: 'A banner', severity: 'warning', displayType: 'banner' });
      result.current.ctx.notify({ title: 'A snackbar', severity: 'info', displayType: 'snackbar' });
      result.current.ctx.notify({ title: 'An alert', severity: 'error', displayType: 'alert' });
      result.current.ctx.notify({ title: 'Inline', severity: 'info', displayType: 'inline' });
    });

    expect(result.current.toast.map((n) => n.title)).toEqual(['A toast']);
    expect(result.current.banner.map((n) => n.title)).toEqual(['A banner']);
    expect(result.current.snackbar.map((n) => n.title)).toEqual(['A snackbar']);
    expect(result.current.alert.map((n) => n.title)).toEqual(['An alert']);
    expect(result.current.inline.map((n) => n.title)).toEqual(['Inline']);
  });

  it('defaults to toast and resolves the deprecated modal dialect to alert', () => {
    const onToast = vi.fn();
    const { result } = setup(onToast);

    act(() => {
      result.current.ctx.notify({ title: 'Default', severity: 'info' });
      result.current.ctx.notify({ title: 'Legacy', severity: 'info', displayType: 'modal' });
    });

    expect(result.current.toast.map((n) => n.title)).toEqual(['Default']);
    expect(result.current.alert.map((n) => n.title)).toEqual(['Legacy']);
    // The stored item carries the RESOLVED presentation, never `modal`.
    expect(result.current.alert[0].displayType).toBe('alert');
    expect(onToast).toHaveBeenCalledTimes(1);
  });

  it('keeps the persistent presentations on screen past the transient timer', () => {
    vi.useFakeTimers();
    try {
      const { result } = setup(vi.fn());

      act(() => {
        result.current.ctx.notify({ title: 'A toast', severity: 'info', displayType: 'toast' });
        result.current.ctx.notify({ title: 'A snackbar', severity: 'info', displayType: 'snackbar' });
        result.current.ctx.notify({ title: 'A banner', severity: 'warning', displayType: 'banner' });
        result.current.ctx.notify({ title: 'An alert', severity: 'error', displayType: 'alert' });
        result.current.ctx.notify({ title: 'Inline', severity: 'info', displayType: 'inline' });
      });

      act(() => { vi.advanceTimersByTime(10_000); });

      // A banner that evaporates after the shared 5s toast timer is not a banner.
      expect(result.current.ctx.notifications.map((n) => n.title))
        .toEqual(['Inline', 'An alert', 'A banner']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors an explicit duration on a persistent presentation', () => {
    vi.useFakeTimers();
    try {
      const { result } = setup(vi.fn());

      act(() => {
        result.current.ctx.notify({
          title: 'Timed banner', severity: 'info', displayType: 'banner', duration: 1000,
        });
      });
      act(() => { vi.advanceTimersByTime(1500); });

      expect(result.current.ctx.notifications).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes inline notifications by scope', () => {
    const scoped: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <NotificationProvider>{children}</NotificationProvider>
    );
    const { result } = renderHook(
      () => ({
        ctx: useNotifications(),
        formA: useNotificationsByPresentation('inline', 'form-a'),
        formB: useNotificationsByPresentation('inline', 'form-b'),
        unscoped: useNotificationsByPresentation('inline'),
      }),
      { wrapper: scoped },
    );

    act(() => {
      result.current.ctx.notify({ title: 'A', severity: 'error', displayType: 'inline', scope: 'form-a' });
      result.current.ctx.notify({ title: 'B', severity: 'error', displayType: 'inline', scope: 'form-b' });
      result.current.ctx.notify({ title: 'Page', severity: 'info', displayType: 'inline' });
    });

    expect(result.current.formA.map((n) => n.title)).toEqual(['A']);
    expect(result.current.formB.map((n) => n.title)).toEqual(['B']);
    expect(result.current.unscoped.map((n) => n.title)).toEqual(['Page']);
  });

  it('warns when a surface-rendered presentation has no surface mounted', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notify({ title: 'Orphan', severity: 'warning', displayType: 'banner' });
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("declares displayType 'banner'"));
  });

  it('stays quiet for a store-only provider raising toasts', () => {
    // No `onToast` is the supported notification-centre mode, not a mistake.
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => { result.current.info('Just stored'); });

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn once the surface is mounted', () => {
    const { result } = renderHook(
      () => ({ ctx: useNotifications(), banners: useNotificationsByPresentation('banner') }),
      { wrapper },
    );

    act(() => {
      result.current.ctx.notify({ title: 'Seen', severity: 'info', displayType: 'banner' });
    });

    expect(warn).not.toHaveBeenCalled();
    expect(result.current.banners).toHaveLength(1);
  });
});

describe('presentation table', () => {
  it('gives every display type its own surface', () => {
    const surfaces = Object.values(NOTIFICATION_PRESENTATIONS).map((p) => p.surface);
    // The bug: five display types, one surface. Distinct surfaces is the fix.
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it('resolves unknown / absent display types to the spec default', () => {
    expect(resolveNotificationPresentation(undefined)).toBe('toast');
    expect(resolveNotificationPresentation('modal')).toBe('alert');
    expect(resolveNotificationPresentation('nonsense' as NotificationPresentation)).toBe('toast');
  });
});

/**
 * The config used to be inert: `maxVisible`, `stacking` and `position` were
 * carried and never read, and its field names forked from the spec
 * `NotificationConfigSchema`. Per-notification `position` did not exist at all,
 * so the #3008 parity guard asserted a position VOCABULARY that nothing used.
 */
describe('notification config', () => {
  it('applies the spec defaults', () => {
    expect(resolveNotificationConfig()).toEqual({
      defaultPosition: undefined,
      defaultDuration: 5000,
      maxVisible: 5,
      stackDirection: 'down',
      pauseOnHover: true,
    });
  });

  it('leaves defaultPosition unset so "the host did not say" is representable', () => {
    // A fabricated default here would silently compete with the host's own
    // toast chrome, which also places non-notification `toast.*` calls.
    expect(resolveNotificationConfig({}).defaultPosition).toBeUndefined();
  });

  it('folds the deprecated position spelling in', () => {
    expect(resolveNotificationConfig({ position: 'bottom_left' }).defaultPosition)
      .toBe('bottom_left');
    expect(resolveNotificationConfig({ defaultPosition: 'top_left', position: 'bottom_left' }).defaultPosition)
      .toBe('top_left');
  });

  it('reads the deprecated `stacking: false` as "show only the newest"', () => {
    expect(resolveNotificationConfig({ stacking: false }).maxVisible).toBe(1);
    expect(resolveNotificationConfig({ stacking: true, maxVisible: 3 }).maxVisible).toBe(3);
  });
});

describe('resolveNotificationPosition', () => {
  const config = resolveNotificationConfig({ defaultPosition: 'top_right' });

  it('prefers the notification over the config default', () => {
    expect(resolveNotificationPosition({ position: 'bottom_left' }, config)).toBe('bottom_left');
  });

  it('falls back to the configured default', () => {
    expect(resolveNotificationPosition({}, config)).toBe('top_right');
  });

  it('returns undefined when nothing is declared — the surface keeps its anchor', () => {
    expect(resolveNotificationPosition({}, resolveNotificationConfig())).toBeUndefined();
    expect(resolveNotificationPosition({})).toBeUndefined();
  });

  it('normalizes the legacy hyphen spelling to the spec one', () => {
    expect(resolveNotificationPosition({ position: 'bottom-center' })).toBe('bottom_center');
  });

  it('drops a value outside the spec vocabulary', () => {
    expect(resolveNotificationPosition({ position: 'middle' as NotificationPositionValue }))
      .toBeUndefined();
  });
});

describe('visibleNotificationStack', () => {
  const items = ['newest', 'middle', 'oldest'].map(
    (title, i) => ({ id: `n${i}`, title, severity: 'info', createdAt: new Date(0) }) as NotificationItem,
  );

  it('keeps the NEWEST maxVisible, never the oldest', () => {
    const kept = visibleNotificationStack(items, { maxVisible: 2, stackDirection: 'up' });
    expect(kept.map((n) => n.title)).toEqual(['newest', 'middle']);
  });

  it('grows downward by default — newest below', () => {
    const stack = visibleNotificationStack(items, { maxVisible: 5, stackDirection: 'down' });
    expect(stack.map((n) => n.title)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('grows upward when asked — newest on top', () => {
    const stack = visibleNotificationStack(items, { maxVisible: 5, stackDirection: 'up' });
    expect(stack.map((n) => n.title)).toEqual(['newest', 'middle', 'oldest']);
  });
});

describe('pauseOnHover', () => {
  it('holds a transient timer and resumes it with the time left', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useNotifications(), { wrapper });
      let id = '';
      act(() => { id = result.current.notify({ title: 'Transient', severity: 'info' }); });

      act(() => { vi.advanceTimersByTime(4000); });
      act(() => { result.current.pauseAutoDismiss(id); });
      // Held: the remaining 1s must not elapse while hovered.
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(result.current.notifications).toHaveLength(1);

      act(() => { result.current.resumeAutoDismiss(id); });
      act(() => { vi.advanceTimersByTime(999); });
      expect(result.current.notifications).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(2); });
      expect(result.current.notifications).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a no-op for a persistent notification', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    let id = '';
    act(() => {
      id = result.current.notify({ title: 'Banner', severity: 'info', displayType: 'banner' });
    });
    expect(() => { result.current.pauseAutoDismiss(id); result.current.resumeAutoDismiss(id); })
      .not.toThrow();
    expect(result.current.notifications).toHaveLength(1);
  });
});

describe('useHasNotificationProvider', () => {
  it('returns false outside provider', () => {
    const { result } = renderHook(() => useHasNotificationProvider());
    expect(result.current).toBe(false);
  });

  it('returns true inside provider', () => {
    const { result } = renderHook(() => useHasNotificationProvider(), { wrapper });
    expect(result.current).toBe(true);
  });
});

describe('useNotifications without provider', () => {
  it('throws error', () => {
    expect(() => {
      renderHook(() => useNotifications());
    }).toThrow('useNotifications must be used within a <NotificationProvider>');
  });
});
