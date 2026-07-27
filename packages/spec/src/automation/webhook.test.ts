import { describe, it, expect } from 'vitest';
import {
  WebhookSchema,
  WebhookTriggerType,
  type Webhook,
} from './webhook.zod';

describe('WebhookTriggerType', () => {
  it('should accept valid trigger types', () => {
    const validTypes = ['create', 'update', 'delete'];

    validTypes.forEach(type => {
      expect(() => WebhookTriggerType.parse(type)).not.toThrow();
    });
  });

  it('should reject undelete / api — removed, no event source (#3196)', () => {
    // `undelete` had no soft-delete/restore producer; `api` had no manual fire
    // path. Removed rather than left as silent no-ops — authoring one now fails
    // loudly instead of registering a webhook that never fires.
    expect(() => WebhookTriggerType.parse('undelete')).toThrow();
    expect(() => WebhookTriggerType.parse('api')).toThrow();
  });

  it('should reject invalid trigger types', () => {
    expect(() => WebhookTriggerType.parse('insert')).toThrow();
    expect(() => WebhookTriggerType.parse('modify')).toThrow();
    expect(() => WebhookTriggerType.parse('')).toThrow();
  });
});

describe('WebhookSchema', () => {
  it('should accept valid minimal webhook', () => {
    const webhook: Webhook = {
      name: 'account_webhook',
      object: 'account',
      triggers: ['create', 'update'],
      url: 'https://example.com/webhook',
    };

    expect(() => WebhookSchema.parse(webhook)).not.toThrow();
  });

  it('should validate webhook name format (snake_case)', () => {
    expect(() => WebhookSchema.parse({
      name: 'valid_webhook_name',
      object: 'account',
      triggers: ['create'],
      url: 'https://example.com/webhook',
    })).not.toThrow();

    expect(() => WebhookSchema.parse({
      name: 'InvalidWebhook',
      object: 'account',
      triggers: ['create'],
      url: 'https://example.com/webhook',
    })).toThrow();

    expect(() => WebhookSchema.parse({
      name: 'invalid-webhook',
      object: 'account',
      triggers: ['create'],
      url: 'https://example.com/webhook',
    })).toThrow();
  });

  it('should apply default values', () => {
    const webhook = WebhookSchema.parse({
      name: 'test_webhook',
      url: 'https://example.com/webhook',
    });

    expect(webhook.method).toBe('POST');
    expect(webhook.isActive).toBe(true);
    expect(webhook.timeoutMs).toBe(30000);
  });

  it('should accept webhook with all fields', () => {
    const webhook = WebhookSchema.parse({
      name: 'full_webhook',
      label: 'Full Webhook',
      object: 'contact',
      triggers: ['create', 'update', 'delete'],
      url: 'https://example.com/webhook',
      method: 'POST',
      secret: 'secret_key_123',
      headers: {
        'Authorization': 'Bearer token123',
        'X-Custom-Header': 'value',
      },
      isActive: true,
    });

    expect(webhook.label).toBe('Full Webhook');
    expect(webhook.triggers).toHaveLength(3);
    expect(webhook.secret).toBe('secret_key_123');
  });

  it('should accept different HTTP methods', () => {
    const methods: Array<Webhook['method']> = ['POST', 'PUT', 'GET'];

    methods.forEach(method => {
      const webhook = WebhookSchema.parse({
        name: 'test_webhook',
        object: 'account',
        triggers: ['create'],
        url: 'https://example.com/webhook',
        method,
      });
      expect(webhook.method).toBe(method);
    });
  });

  it('should reject invalid HTTP method', () => {
    expect(() => WebhookSchema.parse({
      name: 'test_webhook',
      url: 'https://example.com/webhook',
      method: 'TRACE',
    })).toThrow();
  });

  it('should accept multiple triggers', () => {
    const webhook = WebhookSchema.parse({
      name: 'multi_trigger_webhook',
      object: 'account',
      triggers: ['create', 'update', 'delete'],
      url: 'https://example.com/webhook',
    });

    expect(webhook.triggers).toHaveLength(3);
  });

  it('should accept HMAC secret for signing', () => {
    const webhook = WebhookSchema.parse({
      name: 'secure_webhook',
      object: 'account',
      triggers: ['create'],
      url: 'https://example.com/webhook',
      secret: 'hmac_secret_key',
    });

    expect(webhook.secret).toBe('hmac_secret_key');
  });

  it('should accept custom headers', () => {
    const webhook = WebhookSchema.parse({
      name: 'auth_webhook',
      object: 'account',
      triggers: ['create'],
      url: 'https://example.com/webhook',
      headers: {
        'Authorization': 'Bearer token',
        'X-API-Key': 'api_key_123',
      },
    });

    expect(webhook.headers).toHaveProperty('Authorization');
    expect(webhook.headers).toHaveProperty('X-API-Key');
  });

  it('should accept inactive webhook', () => {
    const webhook = WebhookSchema.parse({
      name: 'inactive_webhook',
      object: 'account',
      triggers: ['create'],
      url: 'https://example.com/webhook',
      isActive: false,
    });

    expect(webhook.isActive).toBe(false);
  });

  it('should validate URL format', () => {
    expect(() => WebhookSchema.parse({
      name: 'test_webhook',
      object: 'account',
      triggers: ['create'],
      url: 'not-a-url',
    })).toThrow();

    expect(() => WebhookSchema.parse({
      name: 'test_webhook',
      object: 'account',
      triggers: ['create'],
      url: 'https://example.com/webhook',
    })).not.toThrow();
  });

  it('should handle Slack webhook', () => {
    const webhook = WebhookSchema.parse({
      name: 'slack_notification',
      label: 'Slack Notification',
      object: 'opportunity',
      triggers: ['create'],
      url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX',
      method: 'POST',
    });

    expect(webhook.url).toContain('slack.com');
  });

  it('should handle Stripe webhook', () => {
    const webhook = WebhookSchema.parse({
      name: 'stripe_payment',
      object: 'payment',
      triggers: ['create', 'update'],
      url: 'https://example.com/stripe/webhook',
      secret: 'whsec_stripe_signing_secret',
    });

    expect(webhook.secret).toContain('whsec');
  });

  it('should reject webhook without required fields', () => {
    expect(() => WebhookSchema.parse({
      url: 'https://example.com/webhook',
    })).toThrow();

    expect(() => WebhookSchema.parse({
      name: 'test_webhook',
    })).toThrow();
  });
});
