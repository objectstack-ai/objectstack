// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `openInboxNotification` — the one open action both notification doors (the
 * bell's popover row and Home's My-work row) call. Each arm is asserted as the
 * ORDER of what the door was asked to do, because "marked read" and "followed
 * the link" are both true of the defect it replaced, only in a different
 * sequence or with the first step missing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { openInboxNotification, type NotificationDoor } from '../openInboxNotification';

function recordingDoor(withBeforeFollow = true): { door: NotificationDoor; steps: string[] } {
  const steps: string[] = [];
  const door: NotificationDoor = {
    markRead: (id) => {
      steps.push(`markRead ${id}`);
    },
    goTo: (path) => steps.push(`goTo ${path}`),
    openInbox: () => steps.push('openInbox'),
    ...(withBeforeFollow ? { beforeFollow: () => steps.push('beforeFollow') } : {}),
  };
  return { door, steps };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openInboxNotification', () => {
  it('marks read, then follows an app-relative link hosted under the app', () => {
    const { door, steps } = recordingDoor();
    openInboxNotification({ id: 'ibx_1', actionUrl: '/showcase_task/t_1' }, 'crm', door);
    expect(steps).toEqual(['markRead ibx_1', 'beforeFollow', 'goTo /apps/crm/showcase_task/t_1']);
  });

  it('marks read, then opens the inbox when there is no link — without beforeFollow', () => {
    const { door, steps } = recordingDoor();
    openInboxNotification({ id: 'ibx_1', actionUrl: undefined }, 'crm', door);
    expect(steps).toEqual(['markRead ibx_1', 'openInbox']);
  });

  it('marks read, then opens an external link in a new tab instead of routing', () => {
    // This file runs in the node project: no DOM, so `window` is stubbed.
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    const { door, steps } = recordingDoor();
    openInboxNotification({ id: 'ibx_1', actionUrl: 'https://example.com/x' }, 'crm', door);
    expect(steps).toEqual(['markRead ibx_1', 'beforeFollow']);
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
  });

  it('works for a door that has nothing to do before following a link', () => {
    const { door, steps } = recordingDoor(false);
    openInboxNotification({ id: 'ibx_1', actionUrl: '/apps/acme/invoice/42' }, 'crm', door);
    expect(steps).toEqual(['markRead ibx_1', 'goTo /apps/acme/invoice/42']);
  });
});
