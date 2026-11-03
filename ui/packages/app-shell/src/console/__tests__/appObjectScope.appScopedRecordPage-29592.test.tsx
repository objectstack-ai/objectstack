/**
 * A record route reads the objects of the record page it RENDERS
 * (objectui#13046), so the route's object scope must pick the page the way
 * `RecordDetailView` does through `usePageAssignment`. With app-scoped record
 * pages (`PageSchema.apps`, maintainer ruling A on objectstack#28979) that
 * pick depends on the route's app: inside an app a page names, that page;
 * elsewhere the object's default record page.
 *
 * Harness: `readAppObjectScope` with the app `AppContent` resolved from the
 * route segment, a settled page list, and a scope reader that records the
 * names it is asked. Each page binds one marker object, so the names asked
 * say which page was picked. The same matrix is asked of `usePageAssignment`
 * with the same app's name, and the two answers must agree.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MetadataCtx, usePageAssignment, type MetadataContextValue } from '@object-ui/react';
import { readAppObjectScope } from '../appObjectScope';

type Page = Record<string, unknown>;

const OBJECT = 'sys_user';

/** A full record page of the user object binding one marker object. */
const userPage = (name: string, marker: string, extra: Page = {}): Page => ({
  name,
  label: name,
  type: 'record',
  object: OBJECT,
  ...extra,
  regions: [{ name: 'main', components: [{ type: 'object-grid', objectName: marker }] }],
});

const SYS_USER_DETAIL = userPage('sys_user_detail', 'marker_default', { isDefault: true });
const DULY_MEMBER = userPage('duly_member', 'marker_duly', { apps: ['duly'] });
const MARKER_OF: Record<string, string> = { sys_user_detail: 'marker_default', duly_member: 'marker_duly' };

const SETUP_APP = { name: 'setup', _packageId: 'com.objectstack.setup', navigation: [] };
const DULY_APP = { name: 'duly', _packageId: 'com.duly', navigation: [] };

/** The page `readAppObjectScope` picked, read off the marker names it asked for. */
function scopePick(app: Record<string, unknown>, pages: Page[]): string | undefined {
  const asked = new Set<string>();
  const readObjectScope = ((q: { names?: readonly string[] }) => {
    for (const n of q.names ?? []) asked.add(n);
    return { objects: [], served: [], missing: [], settled: true };
  }) as never;
  readAppObjectScope(readObjectScope, app, `${OBJECT}/record/r1`, '', [], undefined, () => ({ pages, settled: true }));
  const picked = Object.entries(MARKER_OF).filter(([, marker]) => asked.has(marker)).map(([name]) => name);
  expect(picked.length, `exactly one page's objects are read, got ${picked.join(', ') || 'none'}`).toBe(1);
  return picked[0];
}

/** The page `usePageAssignment` picks for the same app's name. */
async function assignmentPick(appName: string, pages: Page[]): Promise<string | undefined> {
  const ctx = {
    apps: [], objects: [], dashboards: [], reports: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => pages,
    getItem: async () => null, getItemsByType: () => [], getTypeStatus: () => 'ready' as const,
  } as unknown as MetadataContextValue;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider>
  );
  const { result } = renderHook(() => usePageAssignment(OBJECT, { app: appName }), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.page?.name;
}

describe('appObjectScope — a record route reads the objects of the app-scoped page it renders (ruling A on objectstack#28979)', () => {
  it('inside the Duly app the route reads duly_member\'s objects; inside Setup, sys_user_detail\'s', () => {
    expect(scopePick(DULY_APP, [SYS_USER_DETAIL, DULY_MEMBER])).toBe('duly_member');
    expect(scopePick(SETUP_APP, [DULY_MEMBER, SYS_USER_DETAIL])).toBe('sys_user_detail');
  });

  it('the scope picker and usePageAssignment agree on every app and order', async () => {
    for (const app of [DULY_APP, SETUP_APP]) {
      for (const pages of [[SYS_USER_DETAIL, DULY_MEMBER], [DULY_MEMBER, SYS_USER_DETAIL]]) {
        expect(scopePick(app, pages)).toBe(await assignmentPick(app.name, pages));
      }
    }
  });

  it('CONTROL: with no `apps` on any page, every app reads the default page\'s objects', () => {
    const plain = [{ ...DULY_MEMBER, apps: undefined }, SYS_USER_DETAIL];
    expect(scopePick(DULY_APP, plain)).toBe('sys_user_detail');
    expect(scopePick(SETUP_APP, plain)).toBe('sys_user_detail');
  });
});
