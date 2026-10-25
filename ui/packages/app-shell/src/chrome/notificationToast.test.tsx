/**
 * The console's `toast` surface — the one display type `NotificationProvider`
 * delegates instead of rendering itself (#3014). These pin the mapping onto
 * sonner; which notifications ever get here is covered by
 * `console/__tests__/ConsoleShell.notifications.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement } from 'react';
import { resolveNotificationConfig, type NotificationItem } from '@object-ui/react';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
  }),
}));

import { toast } from 'sonner';
import { presentNotificationToast } from './notificationToast';
// Imported at module scope, not inside a test: `@object-ui/components` is a
// heavy barrel and resolving it mid-assertion would race the RTL timeouts
// (AGENTS.md § 测试纪律).
import '@object-ui/components';

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    title: 'Saved',
    severity: 'success',
    createdAt: new Date(0),
    ...overrides,
  };
}

describe('presentNotificationToast', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('maps each severity to its sonner variant', () => {
    presentNotificationToast(item({ severity: 'info' }));
    presentNotificationToast(item({ severity: 'success' }));
    presentNotificationToast(item({ severity: 'warning' }));
    presentNotificationToast(item({ severity: 'error' }));

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('passes the message through as the toast description', () => {
    presentNotificationToast(item({ message: 'Record updated' }));
    expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
      description: 'Record updated',
    }));
  });

  it('turns duration 0 into a persistent toast', () => {
    // `0 = persistent` is the notification contract; sonner spells it Infinity.
    // Passing the 0 through would make the toast vanish on the next tick.
    presentNotificationToast(item({ duration: 0 }));
    expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
      duration: Infinity,
    }));
  });

  it('leaves an unset duration to the ConsoleToaster default', () => {
    presentNotificationToast(item());
    expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
      duration: undefined,
    }));
  });

  it('forwards an explicit duration unchanged', () => {
    presentNotificationToast(item({ duration: 12_000 }));
    expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
      duration: 12_000,
    }));
  });

  it('maps the first action to the toast action button', () => {
    const onClick = vi.fn();
    presentNotificationToast(item({
      actions: [
        { label: 'Undo', onClick },
        { label: 'Ignored — a toast has one action slot', onClick: vi.fn() },
      ],
    }));

    const options = vi.mocked(toast.success).mock.calls[0][1] as {
      action?: { label: string; onClick: () => void };
    };
    expect(options.action?.label).toBe('Undo');
    options.action?.onClick();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('omits the action slot entirely when none is declared', () => {
    presentNotificationToast(item());
    const options = vi.mocked(toast.success).mock.calls[0][1] as Record<string, unknown>;
    expect(options).not.toHaveProperty('action');
  });

  it('forwards dismissible', () => {
    presentNotificationToast(item({ dismissible: false }));
    expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
      dismissible: false,
    }));
  });

  it('passes the spec icon override to sonner', () => {
    presentNotificationToast(item({ icon: 'rocket' }));
    const { icon } = vi.mocked(toast.success).mock.calls[0][1] as { icon?: unknown };
    expect(isValidElement(icon)).toBe(true);
    expect((icon as { props: { name?: string } }).props.name).toBe('rocket');
  });

  it('accepts a PascalCase icon name', () => {
    presentNotificationToast(item({ icon: 'CircleCheck' }));
    const { icon } = vi.mocked(toast.success).mock.calls[0][1] as { icon?: unknown };
    expect(isValidElement(icon)).toBe(true);
  });

  it('omits the icon key for a name Lucide does not have', () => {
    // Passing it through would render LazyIcon's `Database` fallback — a
    // meaningless glyph where ConsoleToaster's severity icon belongs.
    presentNotificationToast(item({ icon: 'not-a-real-icon' }));
    const options = vi.mocked(toast.success).mock.calls[0][1] as Record<string, unknown>;
    expect(options).not.toHaveProperty('icon');
  });

  it('omits the icon key when none is declared', () => {
    presentNotificationToast(item());
    const options = vi.mocked(toast.success).mock.calls[0][1] as Record<string, unknown>;
    expect(options).not.toHaveProperty('icon');
  });

  // Position is the half of the contract that had to be settled: declared wins,
  // undeclared defers to the sonner container (host chrome, which also places
  // the console's many direct `toast.*` calls).
  describe('position', () => {
    it('omits the key when neither the notification nor the config declares one', () => {
      presentNotificationToast(item(), resolveNotificationConfig());
      const options = vi.mocked(toast.success).mock.calls[0][1] as Record<string, unknown>;
      expect(options).not.toHaveProperty('position');
    });

    it('passes the configured default, translated to sonner ids', () => {
      presentNotificationToast(item(), resolveNotificationConfig({ defaultPosition: 'top_right' }));
      expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
        position: 'top-right',
      }));
    });

    it("lets the notification's own position win", () => {
      presentNotificationToast(
        item({ position: 'bottom_left' }),
        resolveNotificationConfig({ defaultPosition: 'top_right' }),
      );
      expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
        position: 'bottom-left',
      }));
    });

    it('works with no config at all', () => {
      presentNotificationToast(item({ position: 'top_center' }));
      expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({
        position: 'top-center',
      }));
    });
  });
});
