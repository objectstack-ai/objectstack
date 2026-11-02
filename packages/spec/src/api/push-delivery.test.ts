// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The data a push delivery carries to the shell. Its `route` is opened by the
// shell on tap, so the contract admits only a same-server relative path: a
// value that could navigate anywhere else (another origin, a scheme, a
// protocol-relative reference, or a path a URL parser rewrites into one) is
// refused here, and the server leaves `route` out instead of sending it.

import { describe, it, expect } from 'vitest';
import { PushDeliveryDataSchema, PushRouteSchema } from './push-delivery.zod';

describe('PushDeliveryDataSchema', () => {
  it('accepts a notification id with a Console route', () => {
    const data = { notificationId: 'ntf_1', route: '/apps/crm/opportunity/123' };
    expect(PushDeliveryDataSchema.parse(data)).toEqual(data);
  });

  it('accepts an absent route', () => {
    expect(PushDeliveryDataSchema.parse({ notificationId: 'ntf_1' })).toEqual({ notificationId: 'ntf_1' });
  });

  it('accepts the derived record route `/OBJECT/ID` and a query or fragment', () => {
    expect(PushRouteSchema.safeParse('/opportunity/123').success).toBe(true);
    expect(PushRouteSchema.safeParse('/apps/crm/opportunity/123?tab=notes#activity').success).toBe(true);
    expect(PushRouteSchema.safeParse('/').success).toBe(true);
  });

  it('requires a notification id', () => {
    const parsed = PushDeliveryDataSchema.safeParse({ route: '/x' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['notificationId']);
  });

  it.each([
    'https://evil.example/x',
    '//evil.example',
    'javascript:alert(1)',
    'apps/crm/opportunity/123',
    '',
    // A URL parser reads a backslash as a slash and strips tab / newline, so
    // each of these becomes a protocol-relative reference once parsed.
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/apps/crm\\..\\x',
  ])('refuses route %j', (route) => {
    const parsed = PushDeliveryDataSchema.safeParse({ notificationId: 'ntf_1', route });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['route']);
  });
});
