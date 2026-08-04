import { describe, it, expect } from 'vitest';
import {
  NotificationTypeSchema,
  NotificationSeveritySchema,
  NotificationPositionSchema,
  type NotificationType,
  type NotificationSeverity,
  type NotificationPosition,
} from './notification.zod';

describe('NotificationTypeSchema', () => {
  it('should accept all valid notification types', () => {
    const types = ['toast', 'snackbar', 'banner', 'alert', 'inline'] as const;
    types.forEach(type => {
      expect(() => NotificationTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid notification types', () => {
    expect(() => NotificationTypeSchema.parse('popup')).toThrow();
    expect(() => NotificationTypeSchema.parse('')).toThrow();
  });
});

describe('NotificationSeveritySchema', () => {
  it('should accept all valid severities', () => {
    const severities = ['info', 'success', 'warning', 'error'] as const;
    severities.forEach(severity => {
      expect(() => NotificationSeveritySchema.parse(severity)).not.toThrow();
    });
  });

  it('should reject invalid severities', () => {
    expect(() => NotificationSeveritySchema.parse('critical')).toThrow();
    expect(() => NotificationSeveritySchema.parse('')).toThrow();
  });
});

describe('NotificationPositionSchema', () => {
  it('should accept all valid positions', () => {
    const positions = ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'] as const;
    positions.forEach(position => {
      expect(() => NotificationPositionSchema.parse(position)).not.toThrow();
    });
  });

  it('should reject invalid positions', () => {
    expect(() => NotificationPositionSchema.parse('center')).toThrow();
    expect(() => NotificationPositionSchema.parse('')).toThrow();
  });
});

// `NotificationActionSchema` had a describe block here until #5015 removed the
// schema (ADR-0049 enforce-or-remove — no carrier key, unreachable from every
// metadata root, zero parse outside this file). Its absence is pinned by symbol
// identity in `notification-embed-retirement.test.ts`, not by the silence here.

describe('Type exports', () => {
  it('should have valid type exports', () => {
    const type: NotificationType = 'toast';
    const severity: NotificationSeverity = 'info';
    const position: NotificationPosition = 'top_right';
    expect(type).toBeDefined();
    expect(severity).toBeDefined();
    expect(position).toBeDefined();
  });

  // Pin: this module no longer declares the bare Notification(Config) names.
  // The pin is compile-time (typeof import is type-level only — no runtime
  // barrel load): if either bare name is re-added here, the conditional type
  // flips to `true` and the `false` assignment fails `tsc --noEmit`. The bare
  // `Notification(Schema)` belongs to `@objectstack/spec/api` alone (#4610);
  // `NotificationConfig(Schema)` left the spec surface entirely.
  it('does not re-expose the bare Notification/NotificationConfig names from ./ui (#4610)', () => {
    type UiNotificationModule = typeof import('./notification.zod');
    const hasNotificationSchema: 'NotificationSchema' extends keyof UiNotificationModule
      ? true
      : false = false;
    const hasNotificationConfigSchema: 'NotificationConfigSchema' extends keyof UiNotificationModule
      ? true
      : false = false;
    expect(hasNotificationSchema).toBe(false);
    expect(hasNotificationConfigSchema).toBe(false);
  });
});
