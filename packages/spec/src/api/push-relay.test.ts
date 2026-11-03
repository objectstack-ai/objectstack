// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The server → push relay wire shape, pinned by both ends: the push channel
// that sends it and the hosted relay that receives it. The payload is ID-only
// (the push delivery data plus one generic visible line, never a title or
// body), the response answers each delivery token with ok, invalid or retry,
// and a whole-request refusal is the house error envelope for 401 (bad or
// revoked binding) and 429 (rate limit or quota, with the next step).

import { describe, it, expect } from 'vitest';
import {
  PushRelayDeliverySchema,
  PushRelayErrorResponseSchema,
  PushRelayErrorSchema,
  PushRelayPayloadSchema,
  PushRelayPrioritySchema,
  PushRelayRequestSchema,
  PushRelayResponseSchema,
  PushRelayResultSchema,
  PushRelayResultStatusSchema,
} from './push-relay.zod';

const PAYLOAD = {
  data: { notificationId: 'ntf_1', route: '/opportunity/123', origin: 'https://crm.example.com' },
  text: 'You have a new notification',
} as const;

const DELIVERY = { token: 'apns-device-token-1', vendor: 'apns', payload: PAYLOAD, priority: 'high' } as const;

describe('PushRelayRequestSchema', () => {
  it('accepts one delivery per device token, across both vendors and priorities', () => {
    const request = {
      deliveries: [
        DELIVERY,
        { token: 'fcm-device-token-1', vendor: 'fcm', payload: { ...PAYLOAD, data: { notificationId: 'ntf_1' } }, priority: 'normal' },
      ],
    } as const;
    expect(PushRelayRequestSchema.parse(request)).toEqual(request);
  });

  it('refuses an empty batch', () => {
    const parsed = PushRelayRequestSchema.safeParse({ deliveries: [] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['deliveries']);
  });

  it('carries no credential in the body: the binding is the bearer', () => {
    const parsed = PushRelayRequestSchema.safeParse({ deliveries: [DELIVERY], credential: 'oscc_x' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it.each(['token', 'vendor', 'payload', 'priority'] as const)('requires %j on every delivery', (key) => {
    const { [key]: _omitted, ...rest } = DELIVERY;
    const parsed = PushRelayDeliverySchema.safeParse(rest);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([key]);
  });

  it('keeps the vendor to apns and fcm, and the priority to high and normal', () => {
    expect(PushRelayPrioritySchema.options).toEqual(['high', 'normal']);
    expect(PushRelayDeliverySchema.safeParse({ ...DELIVERY, vendor: 'hms' }).error?.issues[0]?.path).toEqual(['vendor']);
    expect(PushRelayDeliverySchema.safeParse({ ...DELIVERY, priority: 'low' }).error?.issues[0]?.path).toEqual(['priority']);
  });
});

describe('PushRelayPayloadSchema — ID-only', () => {
  it('holds the push delivery data and one generic visible line', () => {
    expect(PushRelayPayloadSchema.parse(PAYLOAD)).toEqual(PAYLOAD);
  });

  it.each(['title', 'body', 'subtitle'])('refuses notification content under %j, by name', (key) => {
    const parsed = PushRelayPayloadSchema.safeParse({ ...PAYLOAD, [key]: 'Deal closed: ACME renewal' });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('A push through the relay is ID-only');
  });

  it('judges data by the push delivery data contract (a route the shell would open off-server is refused)', () => {
    const parsed = PushRelayPayloadSchema.safeParse({ ...PAYLOAD, data: { notificationId: 'ntf_1', route: '//evil.example.com' } });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['data', 'route']);
  });

  it('requires the notification id and a non-empty visible line', () => {
    expect(PushRelayPayloadSchema.safeParse({ ...PAYLOAD, data: {} }).error?.issues[0]?.path).toEqual(['data', 'notificationId']);
    expect(PushRelayPayloadSchema.safeParse({ ...PAYLOAD, text: '' }).error?.issues[0]?.path).toEqual(['text']);
  });
});

describe('PushRelayResponseSchema', () => {
  it('names exactly three per-token outcomes', () => {
    expect(PushRelayResultStatusSchema.options).toEqual(['ok', 'invalid', 'retry']);
  });

  it.each(['ok', 'invalid', 'retry'] as const)('answers a delivery token with %j', (status) => {
    const response = { results: [{ token: 'apns-device-token-1', status }] };
    expect(PushRelayResponseSchema.parse(response)).toEqual(response);
  });

  it('answers each delivery of a batch, in request order', () => {
    const response = {
      results: [
        { token: 't1', status: 'ok' },
        { token: 't2', status: 'invalid' },
        { token: 't3', status: 'retry' },
      ],
    } as const;
    expect(PushRelayResponseSchema.parse(response).results.map((r) => r.status)).toEqual(['ok', 'invalid', 'retry']);
  });

  it('refuses an outcome outside the three', () => {
    const parsed = PushRelayResponseSchema.safeParse({ results: [{ token: 't1', status: 'failed' }] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['results', 0, 'status']);
  });
});

describe('PushRelayErrorResponseSchema', () => {
  it.each(['binding_invalid', 'binding_revoked'] as const)('answers a %s binding with 401 UNAUTHENTICATED and its next step', (reason) => {
    const body = {
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        httpStatus: 401,
        message: 'The push relay did not accept this server binding.',
        details: { reason },
        helpText: 'Bind this server to the cloud again, then retry.',
      },
    } as const;
    const parsed = PushRelayErrorResponseSchema.parse(body);
    expect(parsed.error.code).toBe('UNAUTHENTICATED');
    expect(parsed.error.httpStatus).toBe(401);
    expect(parsed.error.code === 'UNAUTHENTICATED' && parsed.error.details.reason).toBe(reason);
  });

  it('answers request pacing with 429 RATE_LIMIT_EXCEEDED, the wait and the next step', () => {
    const error = {
      code: 'RATE_LIMIT_EXCEEDED',
      httpStatus: 429,
      message: 'Too many push relay requests.',
      retryable: true,
      retryAfterSeconds: 30,
      helpText: 'Send again after 30 seconds.',
    } as const;
    const parsed = PushRelayErrorSchema.parse(error);
    expect(parsed).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', httpStatus: 429, retryAfterSeconds: 30 });
  });

  it('answers a used-up quota with 429 QUOTA_EXCEEDED and the next step', () => {
    const error = {
      code: 'QUOTA_EXCEEDED',
      httpStatus: 429,
      message: 'The push quota of this plan is used up.',
      helpText: 'Raise the plan, or wait for the quota to reset.',
    } as const;
    expect(PushRelayErrorSchema.parse(error)).toMatchObject({ code: 'QUOTA_EXCEEDED', httpStatus: 429 });
  });

  it.each([
    ['a 401 without its reason', { code: 'UNAUTHENTICATED', httpStatus: 401, message: 'x', helpText: 'y' }, ['details']],
    ['a 401 with a reason outside the two', { code: 'UNAUTHENTICATED', httpStatus: 401, message: 'x', helpText: 'y', details: { reason: 'expired' } }, ['details', 'reason']],
    ['a rate limit without the wait', { code: 'RATE_LIMIT_EXCEEDED', httpStatus: 429, message: 'x', helpText: 'y' }, ['retryAfterSeconds']],
    ['a quota error without the next step', { code: 'QUOTA_EXCEEDED', httpStatus: 429, message: 'x' }, ['helpText']],
    ['a rate limit on the wrong status', { code: 'RATE_LIMIT_EXCEEDED', httpStatus: 503, message: 'x', helpText: 'y', retryAfterSeconds: 1 }, ['httpStatus']],
  ] as const)('refuses %s', (_name, error, path) => {
    const parsed = PushRelayErrorSchema.safeParse(error);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(path);
  });

  it('refuses a code the relay does not answer with', () => {
    const parsed = PushRelayErrorSchema.safeParse({ code: 'PERMISSION_DENIED', httpStatus: 403, message: 'x', helpText: 'y' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['code']);
  });
});

// Declared ahead of its producer (ADR-0049): no push channel sends this
// request yet, and each schema says so in its description.
describe('the push relay wire shape is declared, not yet served', () => {
  it.each([
    ['PushRelayPayloadSchema', PushRelayPayloadSchema],
    ['PushRelayDeliverySchema', PushRelayDeliverySchema],
    ['PushRelayRequestSchema', PushRelayRequestSchema],
    ['PushRelayResultSchema', PushRelayResultSchema],
    ['PushRelayResponseSchema', PushRelayResponseSchema],
    ['PushRelayErrorSchema', PushRelayErrorSchema],
    ['PushRelayErrorResponseSchema', PushRelayErrorResponseSchema],
  ] as const)('%s carries the PLANNED marker', (_name, schema) => {
    expect(schema.description).toMatch(/^\[PLANNED — /);
  });
});
