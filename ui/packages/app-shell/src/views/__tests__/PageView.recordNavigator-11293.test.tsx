/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11293 — a custom page publishes the console's record navigator to
 * the blocks placed on it.
 *
 * `useNavigationOverlay` hands an authored `page` click with no `onNavigate`
 * to the `openRecord` its host publishes on `RelatedRecordActionsContext`. The
 * record page and the object list page publish one; `PageView` published
 * none, so an `object-kanban` / `object-calendar` on a page whose `navigation`
 * resolves to `page` still opened nothing. The kanban's and calendar's own
 * member pins drive the click into a published `openRecord`; this file pins
 * the other half — that the page publishes it, and where it goes.
 *
 * The mount case is the discriminating one: with the provider removed from
 * `PageView`, the block reads `null` and the first case goes red.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import type { RelatedRecordActionsValue } from '@object-ui/react';

const PAGE_NAME = 'the_page';
const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ pageName: PAGE_NAME }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => navigate,
  // The router's root href, which the page's navigator joins its hrefs to
  // (objectui#12233). `/` is a root mount; the basename case is below.
  useHref: () => '/',
  useLocation: () => ({ pathname: `/apps/crm/page/${PAGE_NAME}`, search: '' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'User', role: 'user', image: null },
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string; name?: string }) => o?.defaultValue ?? o?.name ?? k,
  }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    pages: [{ name: PAGE_NAME, label: 'A Page', type: 'app' }],
    objects: [{ name: 'account' }],
  }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

/** What the page's blocks read off `RelatedRecordActionsContext`. */
let seen: RelatedRecordActionsValue | null | undefined;

vi.mock('@object-ui/react', async (orig) => {
  const actual = await orig<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useAdapter: () => ({}),
    // Stands in for the blocks the page renders: it reads the context exactly
    // as `useNavigationOverlay` does.
    SchemaRenderer: () => {
      seen = actual.useRelatedRecordActions();
      return null;
    },
  };
});

import { PageView } from '../PageView';
import { pageRecordActionsValue } from '../pageRecordActions';

beforeEach(() => {
  cleanup();
  navigate.mockReset();
  seen = undefined;
});

describe('objectui#11293 — PageView publishes the record navigator its blocks open a record through', () => {
  it('a block on the page reads a navigator, and `openRecord` routes to the record page', () => {
    render(<PageView />);
    expect(seen, 'the page published no record navigator to its blocks').toBeTruthy();
    seen!.openRecord!('account', 'r 1');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/apps/crm/account/record/r%201');
  });

  it('an object the console cannot route to opens nothing, and resolves no related-list handlers', () => {
    render(<PageView />);
    seen!.openRecord!('not_an_object', 'r1');
    expect(navigate).not.toHaveBeenCalled();
    expect(seen!.recordHref!('not_an_object', 'r1')).toBeNull();
    // A page has no parent record: a related list (it names its
    // relationship) with no parent bound stays read-only.
    expect(seen!.resolve({ objectName: 'account', relationshipField: 'owner_id', parentId: null })).toEqual({});
    // objectui#13089 — an object-scoped list (no relationship, no parent: a
    // page `list-view` node) is served the create pair alone, for its Add
    // button; no Edit, Delete or row click.
    expect(Object.keys(seen!.resolve({ objectName: 'account' }))).toEqual(['onCreate']);
  });
});

describe('pageRecordActionsValue — the builder the page publishes', () => {
  const objects = [{ name: 'account' }, { name: '' }, null, { label: 'nameless' }];

  it('addresses a routable object under the app route', () => {
    const value = pageRecordActionsValue('crm', objects, vi.fn(), '/');
    expect(value.recordHref!('account', 7)).toBe('/apps/crm/account/record/7');
  });

  it('under a basename, `recordHref` is the document href and `openRecord` still navigates by the router path (objectui#12233)', () => {
    const go = vi.fn();
    const value = pageRecordActionsValue('crm', objects, go, '/_console');
    expect(value.recordHref!('account', 'a/b')).toBe('/_console/apps/crm/account/record/a%2Fb');
    value.openRecord!('account', 'a/b');
    expect(go).toHaveBeenCalledWith('/apps/crm/account/record/a%2Fb');
    expect(value.recordHref!('contact', 7)).toBeNull();
  });

  it('answers null outside an app route, for an unknown object, and for an empty id', () => {
    expect(pageRecordActionsValue(undefined, objects, vi.fn(), '/').recordHref!('account', 7)).toBeNull();
    const value = pageRecordActionsValue('crm', objects, vi.fn(), '/');
    expect(value.recordHref!('contact', 7)).toBeNull();
    expect(value.recordHref!('account', '')).toBeNull();
  });

  it('`openRecord` navigates to exactly the `recordHref` destination, and to nothing without one', () => {
    const go = vi.fn();
    const value = pageRecordActionsValue('crm', objects, go, '/');
    value.openRecord!('account', 'a/b');
    expect(go).toHaveBeenCalledWith(value.recordHref!('account', 'a/b'));
    expect(go).toHaveBeenCalledWith('/apps/crm/account/record/a%2Fb');
    value.openRecord!('contact', 'x');
    expect(go).toHaveBeenCalledTimes(1);
  });
});
