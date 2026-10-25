/**
 * ObjectUI — usePageAssignment: the object's DEFAULT record page opens
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12195. The record-page pick used to return the first matching page
 * in served order and never read the declared `PageSchema.isDefault`, so the
 * flag on a shipped page (the platform's `sys_user_detail`, for one) was inert
 * while looking decisive.
 *
 * Maintainer ruling A on objectstack#23015 (record 6134056653) states the rule
 * this hook now follows: at most one `isDefault: true` record page may exist for
 * an object in a deployment, a second is refused at every door that can add one
 * (naming both pages), and the renderer honours `isDefault` with no tie-break.
 * Among pages that are not the default, declaration order stays the last
 * resort (`usePageAssignment.declarationOrder-7298.test.tsx`).
 *
 * These pins assert WHICH PAGE is returned. Each rule pin has a control that
 * holds the served list fixed and changes only the flag or only the order, so
 * the flag is shown to be the variable.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import { MetadataCtx, type MetadataContextValue } from '../../context/AppShellContext';
import { usePageAssignment, type PageAssignmentOptions } from '../usePageAssignment';

/** A page as the metadata cache holds it: the body as served, unparsed. */
type Page = Record<string, unknown>;

/** A metadata context carrying exactly the `pages` list under test. */
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

const OBJECT = 'showcase_task';

/** A full record page for `object`; `extra` adds or overrides keys. */
const record = (name: string, object: string = OBJECT, extra: Page = {}): Page => ({
  name,
  label: name,
  type: 'record',
  object,
  ...extra,
});

/** The same, declared the object's default record page. */
const defaultRecord = (name: string, object: string = OBJECT, extra: Page = {}): Page =>
  record(name, object, { isDefault: true, ...extra });

describe('usePageAssignment — the object\'s default record page opens (objectui#12195, ruling A)', () => {
  it('the fixtures are read the way the platform\'s doors read them (precondition)', () => {
    // `defaultRecordPageObject` is the one reading every door that refuses a
    // second default asks. Without this leg, a fixture the spec does not count
    // as a default could make a pin below pass or fail for the wrong reason.
    expect(defaultRecordPageObject(defaultRecord('d'))).toBe(OBJECT);
    expect(defaultRecordPageObject(record('n'))).toBeUndefined();
    expect(defaultRecordPageObject(record('f', OBJECT, { isDefault: false }))).toBeUndefined();
  });

  it('a default declared second wins over a page that is not the default declared first', async () => {
    const result = await assign([record('authored_first'), defaultRecord('the_default')], OBJECT);
    expect(result.current.page?.name).toBe('the_default');
  });

  it('a default declared last wins from any depth in the served list', async () => {
    const result = await assign(
      [record('first'), record('second'), record('third'), defaultRecord('the_default')],
      OBJECT,
    );
    expect(result.current.page?.name).toBe('the_default');
  });

  it('CONTROL: the same served list with the flag removed falls back to declaration order', async () => {
    const result = await assign(
      [record('authored_first'), record('the_default', OBJECT, { isDefault: false })],
      OBJECT,
    );
    expect(result.current.page?.name).toBe('authored_first');
  });

  it('CONTROL: a single default with no other candidate is unchanged', async () => {
    const result = await assign([defaultRecord('only_page')], OBJECT);
    expect(result.current.page?.name).toBe('only_page');
    expect(result.current.slots).toBeNull();
  });

  it('CONTROL: with no default, declaration order holds, `isDefault: false` included', async () => {
    const pages = [
      record('alpha', OBJECT, { isDefault: false }),
      record('beta'),
      record('gamma', OBJECT, { isDefault: false }),
    ];
    expect((await assign(pages, OBJECT)).current.page?.name).toBe('alpha');
    expect((await assign([...pages].reverse(), OBJECT)).current.page?.name).toBe('gamma');
  });

  it('a slotted default wins the same way and populates `slots`, not `page`', async () => {
    const result = await assign(
      [record('authored_full'), defaultRecord('slotted_default', OBJECT, { kind: 'slotted', slots: { discussion: [] } })],
      OBJECT,
    );
    expect(result.current.page).toBeNull();
    expect(result.current.slots).toEqual({ discussion: [] });
  });

  it('an explicit `pageName` still wins over the object\'s default', async () => {
    const pages = [defaultRecord('the_default'), record('named_page')];
    const result = await assign(pages, OBJECT, { pageName: 'named_page' });
    expect(result.current.page?.name).toBe('named_page');
  });

  it('the default is chosen AFTER the filter: another object\'s default, or a non-record default, does not displace the record page', async () => {
    const result = await assign(
      [
        defaultRecord('other_object_default', 'showcase_project'),
        { ...defaultRecord('list_default'), type: 'list' },
        record('the_record_page'),
      ],
      OBJECT,
    );
    expect(result.current.page?.name).toBe('the_record_page');
  });

  it('two defaults (the cold-boot boundary the platform states): no tie-break is invented, served order decides', async () => {
    // The platform refuses a second default at every door, but a stored
    // default that hydrates after a package registered its own is not judged
    // (objectstack#23213, closed not_planned). The hook adds no rung for that
    // pair: the first default served wins, so reversing the order reverses the
    // winner. Pinned so a precedence rule cannot be added here unannounced.
    const a = defaultRecord('default_a');
    const b = defaultRecord('default_b');
    expect((await assign([record('not_default'), a, b], OBJECT)).current.page?.name).toBe('default_a');
    expect((await assign([record('not_default'), b, a], OBJECT)).current.page?.name).toBe('default_b');
  });
});
