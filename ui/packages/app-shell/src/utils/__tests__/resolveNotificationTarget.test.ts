// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resolveNotificationTarget` — the one answer to "where does this
 * notification's `action_url` take the user" (objectui#5179).
 *
 * The two producers that navigate a notification (Home's action centre and the
 * top-bar bell) each had their own, and the two disagreed. These cases pin the
 * policy itself; the two component test files pin that each producer actually
 * routes through it.
 *
 * The input contract under test: `action_url` is APP-RELATIVE. The producer
 * (`service-messaging`'s `actionUrlFor()`) takes an explicit `payload.url` when
 * given one and otherwise synthesizes `/{object}/{id}` from the emit's source,
 * "so the materialization is self-sufficient for navigation" (ADR-0030 L5).
 */

import { describe, it, expect } from 'vitest';
import { resolveNotificationTarget } from '../appRoute';

describe('resolveNotificationTarget', () => {
  describe('the app-relative link the producer synthesizes', () => {
    it('hosts /{object}/{id} under the resolved app', () => {
      expect(resolveNotificationTarget('/showcase_task/t_42', 'crm')).toEqual({
        kind: 'route',
        path: '/apps/crm/showcase_task/t_42',
      });
    });

    it('is the shape the producer actually emits', () => {
      // `messaging-service.test.ts` pins `/showcase_task/t_42`;
      // `inbox-channel.test.ts` pins `/opportunities/42`. Both are bare object
      // paths — neither carries an `/apps/` segment, which is why navigating
      // the field verbatim reached the console catch-all.
      expect(resolveNotificationTarget('/opportunities/42', 'sales')).toEqual({
        kind: 'route',
        path: '/apps/sales/opportunities/42',
      });
    });

    it('tolerates a producer that omits the leading slash', () => {
      expect(resolveNotificationTarget('showcase_task/t_42', 'crm')).toEqual({
        kind: 'route',
        path: '/apps/crm/showcase_task/t_42',
      });
    });

    it('carries a query string through untouched', () => {
      expect(resolveNotificationTarget('/invoice/9?tab=lines', 'crm')).toEqual({
        kind: 'route',
        path: '/apps/crm/invoice/9?tab=lines',
      });
    });
  });

  describe('a target that already names its app', () => {
    it('is left alone rather than hosted twice', () => {
      // Hosting it again would build `/apps/crm/apps/acme/invoice/42` and break
      // the one case that worked before this fix.
      expect(resolveNotificationTarget('/apps/acme/invoice/42', 'crm')).toEqual({
        kind: 'route',
        path: '/apps/acme/invoice/42',
      });
    });

    it('treats the bare app launcher as a console route too', () => {
      expect(resolveNotificationTarget('/apps', 'crm')).toEqual({ kind: 'route', path: '/apps' });
    });

    it('does NOT mistake an object whose name merely starts with "apps" for one', () => {
      // `/appsettings/1` is a record path, not `/apps/…`. A `startsWith('/apps')`
      // test without the separator would silently strand it.
      expect(resolveNotificationTarget('/appsettings/1', 'crm')).toEqual({
        kind: 'route',
        path: '/apps/crm/appsettings/1',
      });
    });
  });

  describe('off-console links', () => {
    it('reports an https url as external instead of hosting it', () => {
      // `/apps/crm/https://…` is not a route; the caller opens it instead.
      expect(resolveNotificationTarget('https://status.example.com/incident/7', 'crm')).toEqual({
        kind: 'external',
        url: 'https://status.example.com/incident/7',
      });
    });

    it('treats any other scheme as external, not just http(s)', () => {
      expect(resolveNotificationTarget('mailto:ops@example.com', 'crm')).toEqual({
        kind: 'external',
        url: 'mailto:ops@example.com',
      });
    });

    it('treats a protocol-relative url as external', () => {
      // `//host/path` is another origin whatever the current scheme is.
      expect(resolveNotificationTarget('//cdn.example.com/report.pdf', 'crm')).toEqual({
        kind: 'external',
        url: '//cdn.example.com/report.pdf',
      });
    });
  });

  describe('no link to follow', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty', ''],
      ['blank', '   '],
    ])('returns null for %s so the caller keeps its own fallback', (_label, input) => {
      // Home opens the full inbox; the bell has nothing to open. Fabricating a
      // target here would send both somewhere neither chose.
      expect(resolveNotificationTarget(input as string | null | undefined, 'crm')).toBeNull();
    });
  });
});
