/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11336 — `isServedView` answers for BOTH serving reads.
 *
 * Since objectstack#21072 (`@objectstack/spec` 17.6.0) the server's
 * `translateObject` translates the `listViews` an object document embeds, so a
 * key of the served `/meta/object` document's own `listViews` names a view that
 * arrived translated, as a `/meta/view` document's name already did
 * (objectui#11295). The label sites draw both as given; the integration pins
 * are `ObjectView.servedViewLabel-11295` and `AppHeader.servedLabels-11295`.
 * This file pins the predicate's edges, which those worlds do not reach, and
 * the identity the hook hands out (AGENTS.md #10).
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { useServedViewItems, isServedView } from '../useServedViewItems';

const VIEW_DOC = { name: 'showcase_task.in_progress', object: 'showcase_task', viewKind: 'list', label: 'In Progress' };
const TASK_DOC = { name: 'showcase_task', label: 'Task', listViews: { mine: { type: 'grid', label: 'My Tasks' } } };
const PROJECT_DOC = { name: 'showcase_project', label: 'Project', listViews: { open: { type: 'grid', label: 'Open' } } };

function metadataWith(read: { view: unknown[]; object: unknown[] }): MetadataContextValue {
  return {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'view' ? read.view : type === 'object' ? read.object : []),
    getTypeStatus: () => 'ready',
  };
}

function servedFrom(view: unknown[], object: unknown[]) {
  const value = metadataWith({ view, object });
  return renderHook(() => useServedViewItems(), {
    wrapper: ({ children }) => <MetadataCtx.Provider value={value}>{children}</MetadataCtx.Provider>,
  }).result.current;
}

describe('isServedView — both serving reads (objectui#11336)', () => {
  const served = servedFrom([VIEW_DOC], [TASK_DOC, PROJECT_DOC]);

  it('a `/meta/view` document answers by its name', () => {
    expect(isServedView(served, 'showcase_task', 'showcase_task.in_progress')).toBe(true);
  });

  it('a key of the served object document\'s own `listViews` answers', () => {
    expect(isServedView(served, 'showcase_task', 'mine')).toBe(true);
  });

  it('the key answers only under the object whose document embeds it', () => {
    expect(isServedView(served, 'showcase_project', 'mine')).toBe(false);
    expect(isServedView(served, 'showcase_project', 'open')).toBe(true);
    expect(isServedView(served, undefined, 'mine')).toBe(false);
  });

  it('a view only the client derived — a container expansion — is not served', () => {
    expect(isServedView(served, 'showcase_task', 'showcase_task.board')).toBe(false);
  });

  it('the legacy `list_views` spelling is not served: the server translates `listViews` only', () => {
    const legacy = servedFrom([], [{ name: 'showcase_task', list_views: { mine: { label: 'My Tasks' } } }]);
    expect(isServedView(legacy, 'showcase_task', 'mine')).toBe(false);
  });

  it('a non-record entry and an inherited key are not served', () => {
    const odd = servedFrom([], [{ name: 'showcase_task', listViews: { mine: 'My Tasks' } }]);
    expect(isServedView(odd, 'showcase_task', 'mine')).toBe(false);
    expect(isServedView(served, 'showcase_task', 'toString')).toBe(false);
  });

  it('no view id is not served', () => {
    expect(isServedView(served, 'showcase_task', undefined)).toBe(false);
  });
});

describe('useServedViewItems — one record per pair of read payloads (AGENTS.md #10)', () => {
  it('keeps its identity while both reads keep theirs, and moves when either is refetched', () => {
    const read = { view: [VIEW_DOC] as unknown[], object: [TASK_DOC] as unknown[] };
    const value = metadataWith(read);
    const { result, rerender } = renderHook(() => useServedViewItems(), {
      wrapper: ({ children }) => <MetadataCtx.Provider value={value}>{children}</MetadataCtx.Provider>,
    });
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);

    read.object = [TASK_DOC, PROJECT_DOC];
    rerender();
    expect(result.current).not.toBe(first);
    expect(isServedView(result.current, 'showcase_project', 'open')).toBe(true);
  });

  it('outside a provider both reads are empty, under one identity', () => {
    const { result, rerender } = renderHook(() => useServedViewItems());
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);
    expect(isServedView(first, 'showcase_task', 'mine')).toBe(false);
  });
});
