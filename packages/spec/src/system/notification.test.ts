import { describe, it, expect } from 'vitest';
import {
  EmailTemplateSchema,
  SMSTemplateSchema,
  PushNotificationSchema,
  InAppNotificationSchema,
  NotificationChannelSchema,
  type EmailTemplate,
  type SMSTemplate,
} from './notification.zod';

describe('EmailTemplateSchema', () => {
  it('should validate complete email template', () => {
    const validTemplate: EmailTemplate = {
      id: 'welcome-email',
      subject: 'Welcome to {{company_name}}',
      body: '<h1>Welcome {{user_name}}!</h1>',
      bodyType: 'html',
      variables: ['company_name', 'user_name'],
      attachments: [
        {
          name: 'guide.pdf',
          url: 'https://example.com/guide.pdf',
        },
      ],
    };

    expect(() => EmailTemplateSchema.parse(validTemplate)).not.toThrow();
  });

  it('should accept minimal email template', () => {
    const minimalTemplate = {
      id: 'simple-email',
      subject: 'Test Email',
      body: 'Simple text body',
    };

    expect(() => EmailTemplateSchema.parse(minimalTemplate)).not.toThrow();
  });

  it('should default bodyType to html', () => {
    const template = {
      id: 'test',
      subject: 'Test',
      body: 'Body',
    };

    const parsed = EmailTemplateSchema.parse(template);
    expect(parsed.bodyType).toBe('html');
  });

  it('should accept text bodyType', () => {
    const template = {
      id: 'text-email',
      subject: 'Plain Text',
      body: 'Plain text body',
      bodyType: 'text' as const,
    };

    expect(() => EmailTemplateSchema.parse(template)).not.toThrow();
  });

  it('should accept markdown bodyType', () => {
    const template = {
      id: 'markdown-email',
      subject: 'Markdown Email',
      body: '# Header\n\nContent',
      bodyType: 'markdown' as const,
    };

    expect(() => EmailTemplateSchema.parse(template)).not.toThrow();
  });

  it('should validate attachment URLs', () => {
    const invalidTemplate = {
      id: 'email-1',
      subject: 'Test',
      body: 'Body',
      attachments: [
        {
          name: 'file.pdf',
          url: 'not-a-url',
        },
      ],
    };

    expect(() => EmailTemplateSchema.parse(invalidTemplate)).toThrow();
  });
});

describe('SMSTemplateSchema', () => {
  it('should validate complete SMS template', () => {
    const validTemplate: SMSTemplate = {
      id: 'verification-sms',
      message: 'Your verification code is {{code}}',
      maxLength: 160,
      variables: ['code'],
    };

    expect(() => SMSTemplateSchema.parse(validTemplate)).not.toThrow();
  });

  it('should accept minimal SMS template', () => {
    const minimalTemplate = {
      id: 'simple-sms',
      message: 'Hello World',
    };

    expect(() => SMSTemplateSchema.parse(minimalTemplate)).not.toThrow();
  });

  it('should default maxLength to 160', () => {
    const template = {
      id: 'sms-1',
      message: 'Test message',
    };

    const parsed = SMSTemplateSchema.parse(template);
    expect(parsed.maxLength).toBe(160);
  });

  it('should accept custom maxLength', () => {
    const template = {
      id: 'long-sms',
      message: 'Long message',
      maxLength: 320,
    };

    const parsed = SMSTemplateSchema.parse(template);
    expect(parsed.maxLength).toBe(320);
  });
});

describe('PushNotificationSchema', () => {
  it('should validate complete push notification', () => {
    const validPush = {
      title: 'New Message',
      body: 'You have a new message from John',
      icon: 'https://example.com/icon.png',
      badge: 5,
      data: { messageId: 'msg_123' },
      actions: [
        { action: 'view', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };

    expect(() => PushNotificationSchema.parse(validPush)).not.toThrow();
  });

  it('should accept minimal push notification', () => {
    const minimalPush = {
      title: 'Alert',
      body: 'Something happened',
    };

    expect(() => PushNotificationSchema.parse(minimalPush)).not.toThrow();
  });

  it('should validate icon URL', () => {
    const invalidPush = {
      title: 'Test',
      body: 'Body',
      icon: 'not-a-url',
    };

    expect(() => PushNotificationSchema.parse(invalidPush)).toThrow();
  });

  it('should accept custom data payload', () => {
    const push = {
      title: 'Order Update',
      body: 'Your order has shipped',
      data: {
        orderId: 'ord_123',
        trackingNumber: 'TRK456',
        status: 'shipped',
      },
    };

    expect(() => PushNotificationSchema.parse(push)).not.toThrow();
  });
});

describe('InAppNotificationSchema', () => {
  it('should validate complete in-app notification', () => {
    const validNotification = {
      title: 'System Update',
      message: 'New features are now available',
      type: 'info' as const,
      actionUrl: '/updates',
      dismissible: true,
      expiresAt: 1704067200000,
    };

    expect(() => InAppNotificationSchema.parse(validNotification)).not.toThrow();
  });

  it('should accept minimal in-app notification', () => {
    const minimalNotification = {
      title: 'Alert',
      message: 'Important message',
      type: 'warning' as const,
    };

    expect(() => InAppNotificationSchema.parse(minimalNotification)).not.toThrow();
  });

  it('should default dismissible to true', () => {
    const notification = {
      title: 'Test',
      message: 'Message',
      type: 'info' as const,
    };

    const parsed = InAppNotificationSchema.parse(notification);
    expect(parsed.dismissible).toBe(true);
  });

  it('should accept all notification types', () => {
    const types = ['info', 'success', 'warning', 'error'] as const;

    types.forEach((type) => {
      const notification = {
        title: 'Test',
        message: 'Message',
        type,
      };

      expect(() => InAppNotificationSchema.parse(notification)).not.toThrow();
    });
  });

  it('should reject invalid notification type', () => {
    const invalidNotification = {
      title: 'Test',
      message: 'Message',
      type: 'invalid',
    };

    expect(() => InAppNotificationSchema.parse(invalidNotification)).toThrow();
  });
});

describe('NotificationChannelSchema', () => {
  it('should accept all valid channels', () => {
    const validChannels = [
      'email',
      'sms',
      'push',
      'in-app',
      'slack',
      'teams',
      'webhook',
    ];

    validChannels.forEach((channel) => {
      expect(() => NotificationChannelSchema.parse(channel)).not.toThrow();
    });
  });

  it('should reject invalid channel', () => {
    expect(() => NotificationChannelSchema.parse('invalid')).toThrow();
  });
});

// Pin: this module no longer declares the bare NotificationConfig names. The
// pin is compile-time (typeof import is type-level only — no runtime barrel
// load): if either bare name is re-added here, the conditional type flips to
// `true` and the `false` assignment fails `tsc --noEmit`. The name left the
// spec export surface entirely (#4610): its ./ui twin was removed in the same
// change, and ADR-0030's delivery vocabulary (NotificationService.emit /
// NotifyConfigSchema / sys_* objects) is the live contract.
describe('NotificationConfig removal (#4610)', () => {
  it('does not re-expose the bare NotificationConfig names from ./system', () => {
    type SystemNotificationModule = typeof import('./notification.zod');
    const hasConfigSchema: 'NotificationConfigSchema' extends keyof SystemNotificationModule
      ? true
      : false = false;
    expect(hasConfigSchema).toBe(false);
  });
});
