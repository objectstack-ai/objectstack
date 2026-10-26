/**
 * ObjectUI — usePageAssignment: page assignment resolves by DECLARATION ORDER
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7298 (half ①). `usePageAssignment` used to sort its candidates on a
 * `priority` key read off the page:
 *
 *     candidates.sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0));
 *
 * `PageSchema` is a `strictObject` and does not declare `priority`, so no
 * author could ever set it — writing it is a hard parse error, and omitting it
 * left every candidate at `0`. The sort was decided by list position in every
 * reachable case, and the read documented an affordance the schema refuses.
 *
 * These pins assert WHICH PAGE is returned, not that the hook ran, so the
 * ordering rule is nailed down rather than implied — and the last block pins
 * the CONTRACT the removal rests on, so that if `priority` is ever declared
 * upstream (route A on that card) this file reds and points back here.
 *
 * Declaration order is the rule among pages that are NOT the object's default
 * record page. Since objectui#12195 the declared `isDefault` decides first:
 * maintainer ruling A on objectstack#23015 (record 6134056653) allows at most
 * one default record page per object per deployment, and the renderer honours
 * it with no tie-break. Three pins below used to say the flag was inert; they
 * now pin the ruled behaviour, and `usePageAssignment.isDefault-12195.test.tsx`
 * carries the rule's own pins and controls.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { MetadataCtx } from '../../context/AppShellContext';
import { usePageAssignment } from '../usePageAssignment';

/** A metadata context carrying exactly the `pages` list under test. */
function wrapperFor(pages: any[]) {
  const ctx: any = {
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

async function assign(pages: any[], objectName: string) {
  const { result } = renderHook(() => usePageAssignment(objectName), {
    wrapper: wrapperFor(pages),
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

/** An app-authored full record page. */
const full = (name: string, object: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  type: 'record',
  object,
  ...extra,
});

/**
 * The platform's page, as `@objectstack/platform-objects` actually ships it:
 * `packages/platform-objects/src/pages/sys-user.page.ts` — `type: 'record'`,
 * `object: 'sys_user'`, `isDefault: true`, and `kind: 'slotted'`.
 */
const SYS_USER_DETAIL = {
  name: 'sys_user_detail',
  label: 'User',
  type: 'record',
  object: 'sys_user',
  template: 'default',
  kind: 'slotted',
  isDefault: true,
  regions: [],
  slots: { discussion: [] },
};

describe('usePageAssignment — among pages that are not the default, selection is by declaration order', () => {
  it('returns the FIRST matching candidate, naming it', async () => {
    const result = await assign(
      [full('first_page', 'sys_user'), full('second_page', 'sys_user'), full('third_page', 'sys_user')],
      'sys_user',
    );
    expect(result.current.page?.name).toBe('first_page');
  });

  it('reversing the declaration order reverses the winner — with no default, position is the whole rule', async () => {
    const a = full('alpha', 'sys_user');
    const b = full('beta', 'sys_user');

    expect((await assign([a, b], 'sys_user')).current.page?.name).toBe('alpha');
    expect((await assign([b, a], 'sys_user')).current.page?.name).toBe('beta');
  });

  it('`isDefault` on a later candidate promotes it over an earlier page that is not the default (ruling A)', async () => {
    const result = await assign(
      [full('authored', 'sys_user'), full('marked_default', 'sys_user', { isDefault: true })],
      'sys_user',
    );
    // This pin used to read 'authored': the flag was declared and writable but
    // nothing read it. Ruling A on objectstack#23015 (record 6134056653) makes
    // the default record page the one that opens, so declaration order only
    // decides among the pages that are not the default.
    expect(result.current.page?.name).toBe('marked_default');
  });

  it('skips pages for other objects and other page types while ordering the rest', async () => {
    const result = await assign(
      [
        full('other_object', 'sys_organization'),
        // Another page type for the SAME object, spelled with the one key
        // `PageSchema` declares for it. (This row used to be `type: 'record'`
        // plus `pageType: 'record_detail'` — a key the schema refuses, and
        // the filter no longer reads it: objectui#9674.)
        { ...full('list_page', 'sys_user'), type: 'list' },
        full('the_winner', 'sys_user'),
        full('the_runner_up', 'sys_user'),
      ],
      'sys_user',
    );
    expect(result.current.page?.name).toBe('the_winner');
  });
});

describe('usePageAssignment — the collision every stock install has (objectui#7298)', () => {
  // `@objectstack/platform-objects` ships `sys_user_detail`, so ANY app that
  // authors its own `sys_user` record page has exactly two candidates. The
  // platform's page is the object's default record page; the app's is not.

  it('the app page declared first no longer wins: the platform default does (ruling A)', async () => {
    const result = await assign(
      [full('app_user_detail', 'sys_user'), SYS_USER_DETAIL],
      'sys_user',
    );
    // This pin used to read 'app_user_detail': declaration order was the only
    // override an app had. Ruling A on objectstack#23015 (record 6134056653)
    // keeps two override paths, an ADR-0005 overlay by name and host
    // composition; an earlier position in the served list is not one.
    // `sys_user_detail` is `kind: 'slotted'`, so its win shows up as populated
    // `slots` and a null `page`.
    expect(result.current.page).toBeNull();
    expect(result.current.slots).toEqual({ discussion: [] });
  });

  it('the platform page wins when IT is declared first as well — the default wins from either position', async () => {
    const result = await assign(
      [SYS_USER_DETAIL, full('app_user_detail', 'sys_user')],
      'sys_user',
    );
    // `sys_user_detail` is `kind: 'slotted'`, so the win shows up as populated
    // `slots` and a null `page` — an unmistakable discriminator between the two.
    expect(result.current.page).toBeNull();
    expect(result.current.slots).toEqual({ discussion: [] });
  });

  it('`isDefault: true` on the platform page makes it win from second place — the flag, not the position, decides', async () => {
    const served = [full('app_user_detail', 'sys_user'), SYS_USER_DETAIL];
    expect(SYS_USER_DETAIL.isDefault).toBe(true);
    // This pin used to read 'app_user_detail' (the flag was inert). Ruling A
    // on objectstack#23015 (record 6134056653): the default opens.
    const withFlag = await assign(served, 'sys_user');
    expect(withFlag.current.page).toBeNull();
    expect(withFlag.current.slots).toEqual({ discussion: [] });

    // The same two pages in the same order, the platform page's flag the only
    // change: declaration order decides again, so the flag is the variable.
    const withoutFlag = await assign(
      [full('app_user_detail', 'sys_user'), { ...SYS_USER_DETAIL, isDefault: false }],
      'sys_user',
    );
    expect(withoutFlag.current.page?.name).toBe('app_user_detail');
    expect(withoutFlag.current.slots).toBeNull();
  });
});

describe('PageSchema refuses `priority` — the contract the removal rests on', () => {
  // Measured by PARSING, not by grepping: a bare grep for the key name
  // false-positives on `priority` appearing as a VALUE, and on the several
  // same-spelling keys of a DIFFERENT kind in this repo (validation rules,
  // hooks, action-handler registration, and a plain data field on business
  // objects). Parsing cannot be fooled by any of them.
  const base = { name: 'x_user_detail', label: 'User', type: 'record', object: 'sys_user' };

  it('is strict: a nonsense key is refused (negative control)', () => {
    const r = PageSchema.safeParse({ ...base, zzzNotAKey: 1 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some(i => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('accepts the keys it DOES declare (positive control)', () => {
    // Without this leg the refusals below would also be produced by a schema
    // that rejects everything, and would say nothing about `priority`.
    expect(PageSchema.safeParse(base).success).toBe(true);
    expect(PageSchema.safeParse({ ...base, isDefault: true }).success).toBe(true);
    expect(PageSchema.safeParse({ ...base, icon: 'user' }).success).toBe(true);
  });

  it('refuses `priority` the same way it refuses a nonsense key — it is undeclared, not mistyped', () => {
    for (const value of [10, 0]) {
      const r = PageSchema.safeParse({ ...base, priority: value });
      expect(r.success).toBe(false);
      const unrecognized = r.error!.issues.filter(i => i.code === 'unrecognized_keys');
      expect(unrecognized).toHaveLength(1);
      expect((unrecognized[0] as any).keys).toEqual(['priority']);
    }
  });
});
