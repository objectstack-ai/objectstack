/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4490, the HOST half — the object list page publishes its record-URL
 * builder so the grid's link column can render a real anchor.
 *
 * The seam was the measured question. `RelatedRecordActionsProvider` mounted
 * only on the record DETAIL body (`RelatedRecordActionsBridge`), which is why
 * PR #4489's anchors reached lookup values there and never the list page. Of
 * the two candidate seams — mount the existing provider on the list host, or
 * thread an href callback through the grid's navigation context — the first
 * needs no new package dependency and no new schema key: app-shell and
 * plugin-grid both already depend on `@object-ui/react`, where the context and
 * its `recordHref` (added by #4489) live.
 *
 * What is pinned here is the part that is this file's own: the URL is built
 * ONCE, by the host, from the same expression its "open in new window" action
 * has always used — so the anchor a user middle-clicks and the tab the row's
 * ⌘-click opens address the same record by construction, not by coincidence.
 *
 * REVERSE VERIFICATION — direction predicted, then measured. These are pure
 * functions that do not exist on `origin/main`, so reverting the source does
 * not produce a value mismatch: the import fails and the whole file dies before
 * an assertion runs. Stated plainly because it bounds what this file proves —
 * it pins the builder's CONTRACT going forward (scoping, encoding, the `/view/`
 * strip); the case that discriminates old behavior from new is the anchor
 * itself, in `plugin-grid/src/__tests__/ObjectGrid.linkCellAnchor.test.tsx`.
 */
import { describe, it, expect, vi } from 'vitest';

import { listRecordDetailUrl, listRecordActionsValue, type ListRecordRoutes } from './ObjectView';

describe('listRecordDetailUrl — one record-route shape for the list surface (#4490)', () => {
  it('strips the trailing view segment and appends the record route', () => {
    expect(listRecordDetailUrl('/apps/demo/crm_lead/view/all', 'r1')).toBe(
      '/apps/demo/crm_lead/record/r1',
    );
  });

  it('works on the object page with no view segment', () => {
    expect(listRecordDetailUrl('/apps/demo/crm_lead', 'r1')).toBe(
      '/apps/demo/crm_lead/record/r1',
    );
  });

  it('encodes the record id', () => {
    expect(listRecordDetailUrl('/apps/demo/crm_lead', 'a/b c')).toBe(
      '/apps/demo/crm_lead/record/a%2Fb%20c',
    );
  });

  it('numeric ids survive as ids, not as coincidental path segments', () => {
    expect(listRecordDetailUrl('/apps/demo/crm_lead/view/mine', 42)).toBe(
      '/apps/demo/crm_lead/record/42',
    );
  });
});

describe('listRecordActionsValue — what the list page publishes (#4490)', () => {
  const pathname = () => '/apps/demo/crm_lead/view/all';

  it('publishes an href for the object this view lists', () => {
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname);
    expect(value.recordHref!('crm_lead', 'r1')).toBe('/apps/demo/crm_lead/record/r1');
  });

  it('without the console routes, publishes NO href for any other object', () => {
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname);
    // With no routable-object set there is nothing to build another object's
    // route from, so a lookup cell pointing at a third object renders as the
    // plain value, which is what `null` means to the consumer. Inventing a URL
    // here is exactly the #4472 mistake; `ObjectView` passes the routes
    // (objectui#12673, pinned below).
    expect(value.recordHref!('crm_account', 'acc-1')).toBeNull();
  });

  it('publishes NO href for a record with no id', () => {
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname);
    expect(value.recordHref!('crm_lead', '')).toBeNull();
  });

  it('openRecord routes through the host own record navigation', () => {
    const openPage = vi.fn();
    const value = listRecordActionsValue('crm_lead', openPage, pathname);

    value.openRecord!('crm_lead', 'r1');
    expect(openPage).toHaveBeenCalledTimes(1);
    expect(openPage).toHaveBeenCalledWith('r1');
  });

  it('openRecord is a no-op for an object this page cannot address', () => {
    const openPage = vi.fn();
    const value = listRecordActionsValue('crm_lead', openPage, pathname);

    value.openRecord!('crm_account', 'acc-1');
    expect(openPage).not.toHaveBeenCalled();
  });

  it('reads the pathname at CALL time, so a view switch cannot leave a stale base', () => {
    let current = '/apps/demo/crm_lead/view/all';
    const value = listRecordActionsValue('crm_lead', vi.fn(), () => current);
    expect(value.recordHref!('crm_lead', 'r1')).toBe('/apps/demo/crm_lead/record/r1');

    current = '/apps/other/crm_lead/view/mine';
    expect(value.recordHref!('crm_lead', 'r1')).toBe('/apps/other/crm_lead/record/r1');
  });

  it('resolves NO related-list handlers — a list page has no child collection', () => {
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname);
    // The context reads an omitted handler as "capability unavailable", i.e.
    // the same read-only outcome a consumer gets with no provider at all. So
    // mounting this provider grants no affordance that was not there before.
    expect(value.resolve({ objectName: 'crm_lead' })).toEqual({});
    // Stable identity, so a consumer memoizing on it does not churn.
    expect(value.resolve({ objectName: 'crm_lead' })).toBe(
      value.resolve({ objectName: 'anything' }),
    );
  });
});

describe('listRecordActionsValue — any routable object, through the record page builder (objectui#12673)', () => {
  const pathname = () => '/_console/apps/demo/crm_lead/view/all';
  const routes = (over: Partial<ListRecordRoutes> = {}): ListRecordRoutes => ({
    appName: 'demo',
    objects: [{ name: 'crm_lead' }, { name: 'crm_account' }, { name: 'sys_approval_request' }],
    navigate: vi.fn(),
    routerRootHref: '/_console/',
    ...over,
  });

  it('publishes the document href of another routable object: basename, app, object, encoded id', () => {
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname, routes());
    expect(value.recordHref!('crm_account', 'a/1')).toBe('/_console/apps/demo/crm_account/record/a%2F1');
  });

  it('adds no `?from=` trail: a list page has no parent record', () => {
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname, routes());
    expect(value.recordHref!('crm_account', 'acc-1')).not.toContain('?');
  });

  it('openRecord navigates by the ROUTER path (the router applies its basename)', () => {
    const r = routes();
    const openPage = vi.fn();
    const value = listRecordActionsValue('crm_lead', openPage, pathname, r);
    value.openRecord!('crm_account', 'acc-1');
    expect(r.navigate).toHaveBeenCalledTimes(1);
    expect(r.navigate).toHaveBeenCalledWith('/apps/demo/crm_account/record/acc-1');
    // Another object's record is not the listed object's record page.
    expect(openPage).not.toHaveBeenCalled();
  });

  it('an object the console cannot route to: no href, and openRecord does nothing', () => {
    const r = routes();
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname, r);
    expect(value.recordHref!('legacy_ledger', 'x-1')).toBeNull();
    value.openRecord!('legacy_ledger', 'x-1');
    expect(r.navigate).not.toHaveBeenCalled();
  });

  it('no app segment: no href for another object', () => {
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname, routes({ appName: undefined }));
    expect(value.recordHref!('crm_account', 'acc-1')).toBeNull();
  });

  it('a record with no id: no href, and openRecord does nothing', () => {
    const r = routes();
    const value = listRecordActionsValue('crm_lead', vi.fn(), pathname, r);
    expect(value.recordHref!('crm_account', '')).toBeNull();
    value.openRecord!('crm_account', '');
    expect(r.navigate).not.toHaveBeenCalled();
  });

  it('the listed object keeps its own route and its own record navigation (control)', () => {
    const r = routes();
    const openPage = vi.fn();
    const value = listRecordActionsValue('crm_lead', openPage, pathname, r);
    expect(value.recordHref!('crm_lead', 'r1')).toBe('/_console/apps/demo/crm_lead/record/r1');
    value.openRecord!('crm_lead', 'r1');
    expect(openPage).toHaveBeenCalledWith('r1');
    expect(r.navigate).not.toHaveBeenCalled();
  });
});
