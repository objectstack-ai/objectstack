// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The data a push delivery carries to the shell. Its `route` is the
// notification's actionUrl, which the shell resolves on tap as the inbox does,
// so the contract admits only a same-server relative path: a value that could
// navigate anywhere else (another origin, a scheme, a protocol-relative
// reference, a path a URL parser rewrites into one, or a path a router would
// normalise or decode elsewhere) is refused here, and the server leaves
// `route` out instead of sending it.

import { describe, it, expect } from 'vitest';
import { PushDeliveryDataSchema, PushRouteSchema } from './push-delivery.zod';

describe('PushDeliveryDataSchema', () => {
  // The two shapes the inbox serves as actionUrl: app-relative (the shell
  // hosts it under its app) and a route already addressed to an app.
  it.each(['/opportunity/123', '/apps/crm/opportunity/123'])('accepts the inbox actionUrl %j as route', (route) => {
    const data = { notificationId: 'ntf_1', route };
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

  it.each(['/apps/crm/.well-known', '/apps/crm/...', '/apps/crm/x?next=%2Fapps%2Fcrm', '/apps/crm/x#%2e%2e', '/apps/crm/x?q=100%25'])(
    'accepts %j: no dot segment, and a query or fragment keeps its own encoding',
    (route) => {
      expect(PushRouteSchema.safeParse(route).success).toBe(true);
    },
  );

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
    // A router that normalises or decodes the path would open somewhere else.
    '/../../api/v1/me',
    '/%2e%2e/x',
    '/./x',
    '/a%2fb',
    '/a%5cb',
    '/apps/crm/..',
    '/a%2Fb',
    '/apps/crm/./x?tab=notes',
    // Double-encoded: one decode leaves %2F / %2E / %5C for the next one.
    '/a%252Fb',
    '/%252e%252e/x',
    '/a%255cb',
  ])('refuses route %j', (route) => {
    const parsed = PushDeliveryDataSchema.safeParse({ notificationId: 'ntf_1', route });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['route']);
  });
});

describe('PushDeliveryDataSchema is served', () => {
  it('carries no PLANNED marker: the push channel produces it (#29041)', () => {
    expect(PushDeliveryDataSchema.description).not.toMatch(/PLANNED/);
  });
});
