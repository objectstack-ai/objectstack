/**
 * ObjectUI — usePageAssignment: the record page scoped to the record's app opens
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Maintainer ruling A on objectstack#28979: a record page may name the apps
 * whose routes open it for its object (`PageSchema.apps`). Inside one of those
 * apps that page opens; everywhere else the object's one `isDefault` record
 * page still opens. The spec allows one record page per object per app, and
 * `defaultRecordPageObject(page, app)` is the one reading of that slot.
 *
 * The hook's `app` option carries the app's NAME. Resolving a route segment
 * to that name is the caller's (`RecordDetailView`), pinned in app-shell.
 *
 * Each pin asserts WHICH PAGE is returned, against a control that holds the
 * served list fixed and changes only the app.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import { MetadataCtx, type MetadataContextValue } from '../../context/AppShellContext';
import { usePageAssignment, type PageAssignmentOptions } from '../usePageAssignment';

type Page = Record<string, unknown>;

function wrapperFor(pages: Page[]) {
  const ctx: MetadataContextValue = {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [],
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider>;
  };
}

async function assign(pages: Page[], objectName: string, opts?: PageAssignmentOptions) {
  const { result } = renderHook(() => usePageAssignment(objectName, opts), {
    wrapper: wrapperFor(pages),
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

const OBJECT = 'sys_user';

const record = (name: string, extra: Page = {}): Page => ({
  name,
  label: name,
  type: 'record',
  object: OBJECT,
  ...extra,
});

/** The platform's default record page for users (Setup → Users opens it). */
const PLATFORM_DEFAULT = record('sys_user_detail', { isDefault: true });
/** The app's own record page for users, scoped to the `duly` app. */
const DULY_MEMBER = record('duly_member', { apps: ['duly'] });

describe('usePageAssignment — the page scoped to the record\'s app opens (ruling A on objectstack#28979)', () => {
  it('the fixtures are read the way the platform\'s doors read them (precondition)', () => {
    expect(defaultRecordPageObject(DULY_MEMBER, 'duly')).toBe(OBJECT);
    expect(defaultRecordPageObject(DULY_MEMBER, 'setup')).toBeUndefined();
    expect(defaultRecordPageObject(DULY_MEMBER)).toBeUndefined();
    expect(defaultRecordPageObject(PLATFORM_DEFAULT)).toBe(OBJECT);
  });

  it('inside the app the page names, the scoped page opens, whatever the served order', async () => {
    for (const pages of [[PLATFORM_DEFAULT, DULY_MEMBER], [DULY_MEMBER, PLATFORM_DEFAULT]]) {
      const result = await assign(pages, OBJECT, { app: 'duly' });
      expect(result.current.page?.name).toBe('duly_member');
    }
  });

  it('inside another app (Setup) the default record page still opens', async () => {
    const result = await assign([DULY_MEMBER, PLATFORM_DEFAULT], OBJECT, { app: 'setup' });
    expect(result.current.page?.name).toBe('sys_user_detail');
  });

  it('with no app named, the default record page opens (the scope is never read without an app)', async () => {
    const result = await assign([DULY_MEMBER, PLATFORM_DEFAULT], OBJECT);
    expect(result.current.page?.name).toBe('sys_user_detail');
  });

  it('a page listing several apps opens in each of them, and only there', async () => {
    const shared = record('shared_member', { apps: ['duly', 'crew'] });
    expect((await assign([PLATFORM_DEFAULT, shared], OBJECT, { app: 'crew' })).current.page?.name).toBe('shared_member');
    expect((await assign([PLATFORM_DEFAULT, shared], OBJECT, { app: 'duly' })).current.page?.name).toBe('shared_member');
    expect((await assign([PLATFORM_DEFAULT, shared], OBJECT, { app: 'setup' })).current.page?.name).toBe('sys_user_detail');
  });

  it('with no default, an app without a scoped page falls through to declaration order', async () => {
    const first = record('first_authored');
    const result = await assign([first, DULY_MEMBER], OBJECT, { app: 'setup' });
    expect(result.current.page?.name).toBe('first_authored');
  });

  it('a page of another object scoped to the app is not taken', async () => {
    const otherObject = { ...DULY_MEMBER, name: 'duly_shift_page', object: 'duly_shift' };
    const result = await assign([otherObject, PLATFORM_DEFAULT], OBJECT, { app: 'duly' });
    expect(result.current.page?.name).toBe('sys_user_detail');
  });

  it('a scoped slotted page hands back its slots, as the default slot does', async () => {
    const slotted = record('duly_member_slots', { apps: ['duly'], kind: 'slotted', slots: { header: { type: 'text' } } });
    const result = await assign([PLATFORM_DEFAULT, slotted], OBJECT, { app: 'duly' });
    expect(result.current.page).toBeNull();
    expect(result.current.slots).toEqual({ header: { type: 'text' } });
  });

  it('an explicit page name still wins over the app', async () => {
    const result = await assign([PLATFORM_DEFAULT, DULY_MEMBER], OBJECT, { app: 'duly', pageName: 'sys_user_detail' });
    expect(result.current.page?.name).toBe('sys_user_detail');
  });

  it('CONTROL: with no `apps` on any page, naming an app changes nothing', async () => {
    const plain = [record('first_authored'), PLATFORM_DEFAULT];
    const withApp = await assign(plain, OBJECT, { app: 'duly' });
    const without = await assign(plain, OBJECT);
    expect(withApp.current.page?.name).toBe('sys_user_detail');
    expect(withApp.current.page).toBe(without.current.page);
  });
});
