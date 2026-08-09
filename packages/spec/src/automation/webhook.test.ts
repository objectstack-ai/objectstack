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

// #4001 batch 11. The ledger carried this row as `authorable (p)` — "spec-only
// (#3461)". Resolving the `(p)` found the opposite: three parse doors, one of
// them a BOOT path. `plugin-webhooks`' `bootstrapDeclaredWebhooks` re-parses
// every declared webhook before materializing it into `sys_webhook`, and a
// failure there warns and SKIPS the subscription — so a rejection here is the
// difference between a webhook that exists and one that does not.
describe('unknown keys are rejected, not stripped (#4001 batch 11)', () => {
  const valid = { name: 'wh_probe', url: 'https://hooks.example/x' };
  const unknownKeyIssue = (value: unknown) => {
    const result = WebhookSchema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i) => i.code === 'unrecognized_keys');
  };

  it('points the sys_webhook COLUMN names back at the spec keys', () => {
    // `mapWebhookToRow` (plugin-webhooks) remaps `object → object_name` and
    // `isActive → active` on the way into the table. Someone reading a row back
    // and re-authoring from those column names is the concrete path here, and
    // neither word is within edit distance of the key it means.
    expect(unknownKeyIssue({ ...valid, object_name: 'task' })!.message)
      .toContain('`object_name` → `object`');
    expect(unknownKeyIssue({ ...valid, active: true })!.message)
      .toContain('`active` → `isActive`');
  });

  it('points `events` at `triggers`', () => {
    expect(unknownKeyIssue({ ...valid, events: ['create'] })!.message)
      .toContain('`events` → `triggers`');
  });

  it('carries the #3494 removals as prescriptions, not bare rejections', () => {
    for (const key of ['body', 'payloadFields', 'includeSession', 'authentication', 'retryPolicy']) {
      const message = unknownKeyIssue({ ...valid, [key]: {} })!.message;
      expect(message, `\`${key}\` should carry its #3494 reason`).toContain('#3494');
    }
  });

  // The reason the ADR-0010 envelope is part of this change and not a
  // follow-up. Both metadata load paths call `applyProtection` on EVERY type,
  // so a package-loaded webhook already carries these keys by the time the boot
  // parse sees it. `.strip` discarded them silently; `.strict()` without this
  // declaration would have turned every package-shipped webhook into a skipped
  // subscription after a redeploy — with one `warn` to say so.
  it('accepts the ADR-0010 protection envelope the loader stamps on it', () => {
    const parsed = WebhookSchema.parse({
      ...valid,
      _packageId: 'com.example.app', _packageVersion: '1.0.0', _provenance: 'package',
      _lock: 'no-overlay', _lockSource: 'artifact', _lockReason: 'ships with the package',
    });
    expect(parsed._packageId).toBe('com.example.app');
    expect(parsed._provenance).toBe('package');
  });

  /**
   * [#6362] The measurement that card asked for, kept as a pin.
   *
   * #6362 fixed `connector`, which TOLERATED the stamped envelope and then
   * stripped it — success with silent data loss — and asked whether `webhook`
   * had the same drop. It does not: `WebhookSchema` has carried
   * `...MetadataProtectionFields` since #4001 batch 11, and all SEVEN keys
   * survive the round-trip. No spread was added here; this pin is what makes
   * that reading durable rather than a note in a closed report.
   *
   * The test above is the one #4001 left, and it checks two keys by value —
   * enough for "accepts", not enough for "preserves". The whole `connector`
   * defect was invisible to an accepts-shaped assertion, so the preservation
   * question gets an assertion over the complete key set, by value.
   */
  it('[#6362] PRESERVES all seven envelope keys — measured, not assumed', () => {
    const envelope = {
      _lock: 'full',
      _lockReason: 'Ships with the package.',
      _lockSource: 'artifact',
      _lockDocsUrl: 'https://docs.example.com/locked-webhooks',
      _provenance: 'package',
      _packageId: 'com.example.app',
      _packageVersion: '1.0.0',
    } as const;

    const parsed = WebhookSchema.parse({ ...valid, ...envelope });

    expect({
      _lock: parsed._lock,
      _lockReason: parsed._lockReason,
      _lockSource: parsed._lockSource,
      _lockDocsUrl: parsed._lockDocsUrl,
      _provenance: parsed._provenance,
      _packageId: parsed._packageId,
      _packageVersion: parsed._packageVersion,
    }).toEqual(envelope);
  });

  it('accepts an authored `protection` block (the pre-envelope half of ADR-0010)', () => {
    expect(WebhookSchema.safeParse({
      ...valid,
      protection: { lock: 'full', reason: 'Ships with the package.' },
    }).success).toBe(true);
  });

  it('still accepts every key an author writes', () => {
    const parsed = WebhookSchema.parse({
      name: 'showcase_task_changed', label: 'Task Changed',
      object: 'showcase_task', triggers: ['create', 'update', 'delete'],
      url: 'https://hooks.example/showcase/task', method: 'POST',
      headers: { 'X-A': 'b' }, timeoutMs: 5000, secret: 's', isActive: false,
      description: 'd',
    });
    expect(parsed.isActive).toBe(false);
  });
});
