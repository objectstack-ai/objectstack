import { describe, it, expect } from 'vitest';
import type { INotificationService, NotificationMessage, NotificationResult } from './notification-service';

describe('Notification Service Contract', () => {
  it('should allow a minimal INotificationService implementation with required methods', () => {
    const service: INotificationService = {
      send: async (_message) => ({ success: true }),
    };

    expect(typeof service.send).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: INotificationService = {
      send: async () => ({ success: true }),
      sendBatch: async (messages) => messages.map(() => ({ success: true })),
      getChannels: () => ['email', 'sms', 'push'],
    };

    expect(service.sendBatch).toBeDefined();
    expect(service.getChannels).toBeDefined();
  });

  it('should send a notification successfully', async () => {
    const sent: NotificationMessage[] = [];

    const service: INotificationService = {
      send: async (message): Promise<NotificationResult> => {
        sent.push(message);
        return { success: true, messageId: `msg-${sent.length}` };
      },
    };

    const result = await service.send({
      channel: 'email',
      to: 'user@example.com',
      subject: 'Welcome',
      body: 'Hello, welcome to the platform!',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('email');
  });

  it('should handle notification failures', async () => {
    const service: INotificationService = {
      send: async (_message): Promise<NotificationResult> => ({
        success: false,
        error: 'Invalid recipient',
      }),
    };

    const result = await service.send({
      channel: 'sms',
      to: '',
      body: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid recipient');
  });

  it('should send to multiple recipients', async () => {
    const delivered: string[] = [];

    const service: INotificationService = {
      send: async (message) => {
        const recipients = Array.isArray(message.to) ? message.to : [message.to];
        delivered.push(...recipients);
        return { success: true };
      },
    };

    await service.send({
      channel: 'push',
      to: ['user-1', 'user-2', 'user-3'],
      body: 'New update available',
    });

    expect(delivered).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('should support batch sending', async () => {
    const service: INotificationService = {
      send: async () => ({ success: true }),
      sendBatch: async (messages) =>
        messages.map((_, i) => ({
          success: i !== 1, // Second message fails
          messageId: `msg-${i}`,
          error: i === 1 ? 'Rate limited' : undefined,
        })),
    };

    const results = await service.sendBatch!([
      { channel: 'email', to: 'a@test.com', body: 'Hello A' },
      { channel: 'email', to: 'b@test.com', body: 'Hello B' },
      { channel: 'email', to: 'c@test.com', body: 'Hello C' },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBe('Rate limited');
    expect(results[2].success).toBe(true);
  });

  it('should list available channels', () => {
    const service: INotificationService = {
      send: async () => ({ success: true }),
      getChannels: () => ['email', 'sms', 'in-app'],
    };

    const channels = service.getChannels!();
    expect(channels).toContain('email');
    expect(channels).toContain('sms');
    expect(channels).toContain('in-app');
  });

  it('should support template-based notifications', async () => {
    const sent: NotificationMessage[] = [];

    const service: INotificationService = {
      send: async (message) => {
        sent.push(message);
        return { success: true };
      },
    };

    await service.send({
      channel: 'email',
      to: 'user@example.com',
      body: '',
      templateId: 'welcome-email',
      templateData: { userName: 'Alice', activationUrl: 'https://example.com/activate' },
    });

    expect(sent[0].templateId).toBe('welcome-email');
    expect(sent[0].templateData?.userName).toBe('Alice');
  });

  /**
   * [#4127] The inbox half. These three backed three SDK-expressed dispatcher
   * routes for as long as the routes existed, while this file described only
   * the send half — so the dev stub, which implements exactly `send` and
   * `sendBatch` BECAUSE it followed this contract, was the implementation the
   * domain had to duck-type past.
   *
   * Optional, and the first test is the reason: a send-only provider (SMTP,
   * Twilio, a Slack webhook) fills the slot legitimately with no inbox at all.
   */
  describe('inbox (#4127)', () => {
    it('keeps a send-only provider valid — the inbox trio is optional', () => {
      const sendOnly: INotificationService = {
        send: async () => ({ success: true }),
      };

      expect(sendOnly.listInbox).toBeUndefined();
      expect(sendOnly.markRead).toBeUndefined();
      expect(sendOnly.markAllRead).toBeUndefined();
    });

    it('types an inbox provider the way service-messaging implements it', async () => {
      const readIds = new Set<string>();
      const rows = [
        { id: 'n1', type: 'mention', title: 'You were mentioned', body: 'in Acme', createdAt: '2026-07-30T00:00:00.000Z' },
        { id: 'n2', type: 'assignment', title: 'Case assigned', body: 'CASE-1', actionUrl: '/cases/1', createdAt: '2026-07-30T01:00:00.000Z' },
      ];

      const service: INotificationService = {
        send: async () => ({ success: true }),
        listInbox: async (_userId, options) => {
          const all = rows.map((r) => ({ ...r, read: readIds.has(r.id) }));
          const filtered = all
            .filter((r) => (options?.read === undefined ? true : r.read === options.read))
            .filter((r) => (options?.type ? r.type === options.type : true))
            .slice(0, options?.limit ?? 50);
          return { notifications: filtered, unreadCount: all.filter((r) => !r.read).length };
        },
        markRead: async (_userId, ids) => {
          let readCount = 0;
          for (const id of ids) {
            if (rows.some((r) => r.id === id) && !readIds.has(id)) { readIds.add(id); readCount += 1; }
          }
          return { success: true, readCount };
        },
        markAllRead: async (userId) => {
          const { notifications } = await service.listInbox!(userId, { read: false });
          return service.markRead!(userId, notifications.map((n) => n.id));
        },
      };

      const first = await service.listInbox!('u-1');
      expect(first.notifications).toHaveLength(2);
      expect(first.unreadCount).toBe(2);

      expect(await service.markRead!('u-1', ['n1'])).toEqual({ success: true, readCount: 1 });
      // Re-marking an already-read notification counts nothing.
      expect(await service.markRead!('u-1', ['n1'])).toEqual({ success: true, readCount: 0 });

      const unread = await service.listInbox!('u-1', { read: false });
      expect(unread.notifications.map((n) => n.id)).toEqual(['n2']);
      expect(unread.unreadCount).toBe(1);

      expect(await service.markAllRead!('u-1')).toEqual({ success: true, readCount: 1 });
      expect((await service.listInbox!('u-1', { read: false })).notifications).toHaveLength(0);
    });
  });
});
