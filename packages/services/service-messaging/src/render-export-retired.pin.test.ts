// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25190 — `renderNotification`, the renderer that took a template body inline,
 * is retired from this package's published entry (ruling 6335348115 on #25082,
 * F2 B3; ADR-0087 `runtime-export-retired`). The hole-placement rule is judged
 * by the `sys_notification_template` save hooks, and a body handed straight to
 * it was never saved, so it was the one door the rule could not see.
 * `interpolate` stays on the entry: it renders a plain-text face, which the
 * rule judges at no door.
 *
 * Pinned both ways: the entry no longer names it (the template store and the
 * channels stay), and a stored template row still renders through a channel
 * built from the entry — the html body with every hole encoded, the subject
 * (the plain-text face) verbatim.
 */

import { describe, it, expect } from 'vitest';
import * as entry from './index.js';

describe('service-messaging entry: the body-taking renderer is retired (#25190)', () => {
  it('the published entry does not export renderNotification', () => {
    expect('renderNotification' in entry).toBe(false);
  });

  it('THE CONTROL: the entry still exports the template store, the plain-text face and the channels that render', () => {
    expect(typeof entry.NotificationTemplateStore).toBe('function');
    expect(typeof entry.interpolate).toBe('function');
    expect(entry.TEMPLATE_OBJECT).toBe('sys_notification_template');
    expect(typeof entry.createEmailChannel).toBe('function');
    expect(typeof entry.createSmsChannel).toBe('function');
  });

  it('a stored html template row still renders through the email channel', async () => {
    const row = {
      organization_id: 'org_1',
      topic: 'deal.won',
      channel: 'email',
      locale: 'en',
      is_active: true,
      format: 'html',
      subject: 'Won {{ payload.title }}',
      body: '<h1>{{ payload.title }}</h1>',
    };
    const data = {
      async findOne(object: string, query: any) {
        const w = query?.where ?? {};
        if (object === 'sys_user') return w.id === 'user_1' ? { email: 'ada@example.com' } : null;
        if (object === entry.TEMPLATE_OBJECT) {
          return row.organization_id === w.organization_id && row.topic === w.topic
            && row.channel === w.channel && row.locale === w.locale ? row : null;
        }
        return null;
      },
    } as any;
    const sent: any[] = [];
    const ch = entry.createEmailChannel({
      getEmail: () => ({ async send(input: any) { sent.push(input); return { id: 'email_row_1' }; } }) as any,
      getData: () => data,
      store: new entry.NotificationTemplateStore({ getData: () => data }),
    });
    const logger = { info: () => {}, warn: () => {}, error: () => {} };

    const r = await ch.send({ logger } as any, {
      channel: 'email',
      recipient: 'user_1',
      notification: {
        notificationId: 'evt_1',
        organizationId: 'org_1',
        topic: 'deal.won',
        title: 'A<b>',
        body: '',
        severity: 'info',
        recipients: ['user_1'],
        payload: { title: 'A<b>' },
      },
    } as any);

    expect(r.ok).toBe(true);
    expect(sent).toEqual([{ to: 'ada@example.com', subject: 'Won A<b>', html: '<h1>A&lt;b&gt;</h1>', organizationId: 'org_1' }]);
  });
});
