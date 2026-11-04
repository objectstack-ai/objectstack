// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30043 — the console page in view, read off the URL as the chat's
 * `context.surface` (cloud#1610's shape). The wire half — the dock's real
 * request carrying it — is pinned in `ChatDock.requestContext-30043.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { APP_ROUTE_SURFACES, consoleChatSurface } from '../chatSurfaceContext';
import { APP_ROUTE_METADATA_READS } from '../../console/appRouteMetadataReads';

describe('consoleChatSurface — the page in view as cloud#1610 `context.surface` (objectstack#30043)', () => {
  it('an object list names the object', () => {
    expect(consoleChatSurface('/apps/crm/account')).toEqual({ artifact: { type: 'object', name: 'account' } });
    expect(consoleChatSurface('/apps/crm/account/data')).toEqual({ artifact: { type: 'object', name: 'account' } });
    expect(consoleChatSurface('/apps/crm/account/new')).toEqual({ artifact: { type: 'object', name: 'account' } });
  });

  it('a saved list view names the object and the view', () => {
    expect(consoleChatSurface('/apps/crm/account/view/my_open')).toEqual({
      artifact: { type: 'object', name: 'account' },
      selection: { kind: 'view', id: 'my_open' },
    });
  });

  it('a record page names the object and the record id, on every record route', () => {
    const want = { artifact: { type: 'object', name: 'account' }, selection: { kind: 'record', id: 'rec_1' } };
    expect(consoleChatSurface('/apps/crm/account/record/rec_1')).toEqual(want);
    expect(consoleChatSurface('/apps/crm/account/record/rec_1/')).toEqual(want);
    expect(consoleChatSurface('/apps/crm/account/record/rec_1/edit')).toEqual(want);
    expect(consoleChatSurface('/apps/crm/account/record/rec_1/page/summary')).toEqual(want);
  });

  it('a dashboard, a report and a page name themselves with their metadata type', () => {
    expect(consoleChatSurface('/apps/crm/dashboard/sales')).toEqual({ artifact: { type: 'dashboard', name: 'sales' } });
    expect(consoleChatSurface('/apps/crm/design/dashboard/sales')).toEqual({
      artifact: { type: 'dashboard', name: 'sales' },
      mode: 'design',
    });
    expect(consoleChatSurface('/apps/crm/report/pipeline')).toEqual({ artifact: { type: 'report', name: 'pipeline' } });
    expect(consoleChatSurface('/apps/crm/page/welcome')).toEqual({ artifact: { type: 'page', name: 'welcome' } });
  });

  it('an encoded segment arrives decoded', () => {
    expect(consoleChatSurface('/apps/crm/account/record/a%2Fb%20c')?.selection).toEqual({ kind: 'record', id: 'a/b c' });
  });

  it('a page that shows no one artifact sends no surface', () => {
    for (const path of [
      '/apps/crm',
      '/apps/crm/',
      '/apps/crm/search',
      '/apps/crm/reports',
      '/apps/crm/create-app',
      '/apps/crm/system/marketplace',
      '/apps/crm/component/approvals/inbox',
      '/apps/crm/metadata/object/account',
      // The shorthand redirect: the record route it lands on carries its own surface.
      '/apps/crm/account/rec_1',
      '/ai',
      '/home',
      '/',
    ]) {
      expect(consoleChatSurface(path), path).toBeUndefined();
    }
  });

  it('a host route wins the way it wins in <Routes>, and names no surface', () => {
    expect(consoleChatSurface('/apps/crm/billing', ['billing'])).toBeUndefined();
    // An object of another name still reads as one beside the host route.
    expect(consoleChatSurface('/apps/crm/account', ['billing'])).toEqual({ artifact: { type: 'object', name: 'account' } });
  });

  it('every path it maps is a route the console declares', () => {
    const declared = new Set(APP_ROUTE_METADATA_READS.map(({ path }) => path));
    for (const path of Object.keys(APP_ROUTE_SURFACES)) expect(declared.has(path), path).toBe(true);
  });
});
