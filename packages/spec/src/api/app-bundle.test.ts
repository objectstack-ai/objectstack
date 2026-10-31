// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { AppMetadataBundleResponseSchema } from './app-bundle.zod';
import { GetMetaItemResponseSchema } from './protocol.zod';

const entry = (type: string, name: string) => ({ type, name, item: { name } });
const bundle = {
  app: entry('app', 'crm'),
  objects: [entry('object', 'account')],
  views: [entry('view', 'all_accounts')],
  pages: [entry('page', 'account_record')],
  dashboards: [entry('dashboard', 'pipeline')],
};

describe('[#27627] the app metadata bundle carries each member as its own item read answers it', () => {
  it('takes the app and the four member lists of item envelopes', () => {
    expect(AppMetadataBundleResponseSchema.safeParse(bundle).success).toBe(true);
    expect(AppMetadataBundleResponseSchema.safeParse({ ...bundle, objects: [], views: [], pages: [], dashboards: [] }).success).toBe(true);
  });

  it('declares every member list with the item read\'s own envelope', () => {
    const shape = (AppMetadataBundleResponseSchema as any).shape;
    expect(Object.keys(shape).sort()).toEqual(['app', 'dashboards', 'objects', 'pages', 'views']);
    for (const key of ['objects', 'views', 'pages', 'dashboards']) {
      expect(shape[key].element, key).toBe(GetMetaItemResponseSchema);
    }
  });

  it('refuses a missing member list, a member without its envelope, and an undeclared key', () => {
    const { dashboards: _dropped, ...withoutDashboards } = bundle;
    for (const answer of [
      withoutDashboards,
      { ...bundle, objects: [{ item: { name: 'account' } }] },
      { ...bundle, app: { name: 'crm', item: {} } },
      { ...bundle, reports: [] },
    ]) {
      expect(AppMetadataBundleResponseSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(false);
    }
  });
});
