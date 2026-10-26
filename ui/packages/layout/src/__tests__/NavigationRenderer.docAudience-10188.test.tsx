/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10188 — a `doc` navigation entry the member may not read is not
 * drawn, as defence in depth behind the server.
 *
 * The server is the enforcer (ADR-0046 §6.7): since objectstack#19790 its app
 * read drops a `doc` entry the caller may not read before the menu ever sees
 * it. That ruling's point 2 keeps the renderer's pruning as defence in depth.
 * The layer holds no audience rules, so the HOST answers the question from the
 * member's own doc / book reads (`checkDocTarget`), and this guard hides what
 * the answer omits — on every path the other item guards already share: the
 * sidebar rows, the derived area visibility and the Favorites section.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { AppSchemaRenderer } from '../AppSchemaRenderer';
import { NavigationRenderer, hasVisibleNavigationItems } from '../NavigationRenderer';

const APP = '/apps/com.example.crm';

const OPEN_PAGE: NavigationItem = { id: 'nav_open', type: 'doc', label: 'Open Guide', doc: 'crm_open_guide' };
const STAFF_PAGE: NavigationItem = { id: 'nav_staff', type: 'doc', label: 'Staff Guide', doc: 'crm_staff_guide' };
const STAFF_BOOK: NavigationItem = { id: 'nav_staff_book', type: 'doc', label: 'Staff Manual', book: 'crm_staff_manual' };
const STAFF_PAGE_IN_BOOK: NavigationItem = {
  id: 'nav_staff_in_book', type: 'doc', label: 'Staff Guide In Manual', book: 'crm_staff_manual', doc: 'crm_staff_guide',
};
const EMPTY_BOOK: NavigationItem = { id: 'nav_empty', type: 'doc', label: 'Empty Manual', book: 'crm_empty_manual' };
const OBJECT_ENTRY: NavigationItem = { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead' };

/** The member's readable set, as the host would answer it from the member's own reads. */
const READABLE = { docs: new Set(['crm_open_guide']), books: new Set<string>() };
const memberCheck = (target: { book?: string; doc?: string }) =>
  (target.book === undefined || READABLE.books.has(target.book))
  && (target.doc === undefined || READABLE.docs.has(target.doc));

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={[APP]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath={APP} {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('objectui#10188 — NavigationRenderer hides a `doc` entry the host says the member may not read', () => {
  it('readable: an entry whose target the member can read is drawn', () => {
    renderNav([OPEN_PAGE], { checkDocTarget: memberCheck });
    expect(screen.getByRole('link', { name: 'Open Guide' }).getAttribute('href')).toBe(`${APP}/docs/crm_open_guide`);
  });

  it('unreadable: a page, a book and a page in a book the member cannot read are not drawn', () => {
    renderNav([OPEN_PAGE, STAFF_PAGE, STAFF_BOOK, STAFF_PAGE_IN_BOOK], { checkDocTarget: memberCheck });
    expect(screen.queryByRole('link', { name: 'Staff Guide' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Staff Manual' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Staff Guide In Manual' })).toBeNull();
    // Control: the readable sibling under the same checker still draws.
    expect(screen.getByRole('link', { name: 'Open Guide' })).toBeTruthy();
  });

  it('empty book: a book with no page the member can read is not drawn', () => {
    const noReadablePage = (target: { book?: string; doc?: string }) => target.book !== 'crm_empty_manual';
    renderNav([EMPTY_BOOK, OPEN_PAGE], { checkDocTarget: noReadablePage });
    expect(screen.queryByRole('link', { name: 'Empty Manual' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Guide' })).toBeTruthy();
  });

  it('the checker is asked about the entry\'s own target, and only for `doc` entries', () => {
    const check = vi.fn(() => true);
    renderNav([STAFF_PAGE_IN_BOOK, STAFF_BOOK, OBJECT_ENTRY], { checkDocTarget: check });
    expect(check).toHaveBeenCalledWith({ book: 'crm_staff_manual', doc: 'crm_staff_guide' });
    expect(check).toHaveBeenCalledWith({ book: 'crm_staff_manual', doc: undefined });
    for (const [target] of check.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      expect(target).not.toHaveProperty('objectName');
    }
    expect(screen.getByRole('link', { name: 'Leads' })).toBeTruthy();
  });

  it('with no checker every `doc` entry draws — the server\'s answer stands', () => {
    renderNav([OPEN_PAGE, STAFF_PAGE]);
    expect(screen.getByRole('link', { name: 'Open Guide' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Staff Guide' })).toBeTruthy();
  });

  it('a hidden entry is not collected into Favorites either', () => {
    renderNav([{ ...OPEN_PAGE, pinned: true }, { ...STAFF_PAGE, pinned: true }], {
      checkDocTarget: memberCheck,
      enablePinning: true,
    });
    expect(screen.queryAllByRole('link', { name: 'Staff Guide' })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Open Guide' }).length).toBeGreaterThan(0);
  });
});

describe('objectui#10188 — the derived area visibility reads the same gate', () => {
  it('an area whose only entry is unreadable does not count as visible', () => {
    expect(hasVisibleNavigationItems([STAFF_PAGE], { checkDocTarget: memberCheck })).toBe(false);
    expect(hasVisibleNavigationItems([STAFF_PAGE, OPEN_PAGE], { checkDocTarget: memberCheck })).toBe(true);
    // Control: without the checker the same area is visible.
    expect(hasVisibleNavigationItems([STAFF_PAGE])).toBe(true);
  });

  it('AppSchemaRenderer forwards the checker to its sidebar and its area derivation', () => {
    render(
      <MemoryRouter initialEntries={[APP]}>
        <AppSchemaRenderer
          schema={{
            type: 'app',
            name: 'crm',
            title: 'CRM',
            areas: [
              { id: 'area_staff', label: 'Staff', navigation: [STAFF_PAGE] },
              { id: 'area_open', label: 'Open', navigation: [OPEN_PAGE] },
            ],
          }}
          basePath={APP}
          checkDocTarget={memberCheck}
        >
          <div />
        </AppSchemaRenderer>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'Staff Guide' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Guide' })).toBeTruthy();
  });
});
