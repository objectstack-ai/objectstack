/**
 * ObjectUI — `isRecordPageOf`: the one reading of "a record page of object O"
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#12715. The console's named record page route renders record R of
 * object O on the page its URL names, and only when that page is a record
 * page of O. It asks `isRecordPageOf`, and `usePageAssignment`'s object-based
 * lookup filters its candidates with the same function, so the route and the
 * default lookup cannot disagree on what "a record page of O" is.
 *
 * Pinned here: the predicate's answers, that the object-based lookup still
 * reads through it (a page it refuses is never assigned), and that the hook's
 * `pageName` override is left as published: it returns the page with that
 * name whatever it is, which is why a caller rendering a record on it asks the
 * predicate first.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '../../context/AppShellContext';
import { usePageAssignment, isRecordPageOf, type PageAssignmentOptions } from '../usePageAssignment';

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

const OBJECT = 'invoice';

describe('isRecordPageOf (objectui#12715)', () => {
  it('is true for a record page bound to the object', () => {
    expect(isRecordPageOf({ name: 'doc', type: 'record', object: OBJECT }, OBJECT)).toBe(true);
  });

  it('is false for a record page of another object', () => {
    expect(isRecordPageOf({ name: 'note', type: 'record', object: 'delivery' }, OBJECT)).toBe(false);
  });

  it('is false for a page that is not a record page, even one naming the object', () => {
    for (const type of ['app', 'home', 'utility', 'list']) {
      expect(isRecordPageOf({ name: 'p', type, object: OBJECT }, OBJECT)).toBe(false);
    }
  });

  it('reads `type` alone: the refused `pageType` spelling decides nothing (objectui#9674)', () => {
    expect(isRecordPageOf({ name: 'p', pageType: 'record', object: OBJECT }, OBJECT)).toBe(false);
  });

  it('is false for no page, and for no object', () => {
    expect(isRecordPageOf(undefined, OBJECT)).toBe(false);
    expect(isRecordPageOf(null, OBJECT)).toBe(false);
    expect(isRecordPageOf({ name: 'p', type: 'record', object: OBJECT }, undefined)).toBe(false);
    expect(isRecordPageOf({ name: 'p', type: 'record' }, OBJECT)).toBe(false);
  });
});

describe('usePageAssignment reads the binding through isRecordPageOf', () => {
  it('assigns only a page the predicate accepts', async () => {
    const pages = [
      { name: 'other', type: 'record', object: 'delivery' },
      { name: 'app_page', type: 'app', object: OBJECT },
      { name: 'the_record_page', type: 'record', object: OBJECT },
    ];
    const result = await assign(pages, OBJECT);
    expect(result.current.page?.name).toBe('the_record_page');
    expect(isRecordPageOf(result.current.page, OBJECT)).toBe(true);
  });

  it('leaves the published `pageName` override as it was: it returns the named page whatever it is', async () => {
    // The named record page route does not rely on the override to check
    // anything; it asks `isRecordPageOf` itself. This pins that the hook's
    // contract was not narrowed on the way.
    const pages = [
      { name: 'the_record_page', type: 'record', object: OBJECT },
      { name: 'delivery_note', type: 'record', object: 'delivery' },
    ];
    const result = await assign(pages, OBJECT, { pageName: 'delivery_note' });
    expect(result.current.page?.name).toBe('delivery_note');
    expect(isRecordPageOf(result.current.page, OBJECT)).toBe(false);
  });
});
