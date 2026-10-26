/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11211 — `AppSchemaRenderer`'s mobile tab bar (`mobileNavMode:
 * 'bottom_nav'`) opens the page the sidebar opens.
 *
 * The bar used to spell each tab's href itself, one branch per entry type, so
 * the same navigation entry opened a different page on the tab bar than in the
 * sidebar: a record deep link landed on the list, a `filters` entry lost its
 * filter, a `runAction` entry lost its action, and a `metadata:*` component
 * entry went to the generic component route. `resolveHref` is the one
 * nav-to-URL rule, and its docblock requires every surface to use it; the bar
 * now takes every tab's href from it, with the arguments the sidebar's
 * `NavigationRenderer` gets inside `AppSchemaRenderer` — `basePath`, and no
 * template context, since `AppSchemaRendererProps` carries none.
 *
 * Each row asserts the tab's href against `resolveHref`'s answer and against
 * the sidebar link the same entry draws, and pins `resolveHref`'s answer to the
 * card's table so the row is known to exercise the branch it names. The plain
 * `object` entry is the control: both spellings always agreed on it.
 *
 * Two more answers of the same rule pair travel with the href, and the bar
 * honours them the sidebar's way: which tab lights is `resolveActiveNavItem`'s
 * election (a tab whose href carries a query string can never prefix-match the
 * pathname), and an `external` answer opens in a new tab.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { AppSchemaRenderer } from '../AppSchemaRenderer';
import { resolveHref } from '../NavigationRenderer';

const BASE = '/apps/crm';

const CONTROL: NavigationItem = { id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'account' };
const RECORD: NavigationItem = { id: 'nav_me', type: 'object', label: 'My Profile', objectName: 'sys_user', recordId: 'u1' };
const FILTERS: NavigationItem = { id: 'nav_open', type: 'object', label: 'Open Tasks', objectName: 'task', filters: { status: 'open' } };
const RUN_ACTION: NavigationItem = { id: 'nav_new', type: 'object', label: 'New Task', objectName: 'task', runAction: 'task_create' };
const METADATA: NavigationItem = {
  id: 'nav_objects',
  type: 'component',
  label: 'Objects',
  componentRef: 'metadata:resource',
  params: { type: 'object' },
};

function renderBar(navigation: NavigationItem[], at = '/') {
  const { container } = render(
    <MemoryRouter initialEntries={[at]}>
      <AppSchemaRenderer
        schema={{ type: 'app', name: 'crm', title: 'CRM', navigation }}
        basePath={BASE}
        mobileNavMode="bottom_nav"
      >
        <div />
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
  const bar = container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
  expect(bar).not.toBeNull();
  const tabs = Array.from(bar!.querySelectorAll('a'));
  const tab = (label: string) => {
    const hit = tabs.filter((a) => a.textContent === label);
    expect(hit).toHaveLength(1);
    return hit[0];
  };
  // The sidebar row for the same entry: the one link with that text that is
  // not a tab.
  const sidebarHref = (label: string) => {
    const hit = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === label && !bar!.contains(a),
    );
    expect(hit).toHaveLength(1);
    return hit[0].getAttribute('href');
  };
  const lit = () => tabs.filter((a) => a.className.includes('text-primary')).map((a) => a.textContent);
  return { tab, sidebarHref, lit };
}

describe('objectui#11211 — every mobile tab href is `resolveHref`\'s answer, the page its sidebar row opens', () => {
  const entries = [CONTROL, RECORD, FILTERS, RUN_ACTION, METADATA];

  it.each([
    ['a plain object entry (control)', CONTROL, `${BASE}/account`],
    ['a record deep link (`recordId`)', RECORD, `${BASE}/sys_user/record/u1`],
    ['a `filters` entry', FILTERS, `${BASE}/task/data?filter%5Bstatus%5D=open`],
    ['a `runAction` entry', RUN_ACTION, `${BASE}/task?runAction=task_create`],
    ['a `metadata:resource` component entry with `params`', METADATA, `${BASE}/metadata/object`],
  ])('%s', (_name, entry, page) => {
    const { tab, sidebarHref } = renderBar(entries);
    const label = entry.label as string;
    expect(resolveHref(entry, BASE).href).toBe(page);
    expect(tab(label).getAttribute('href')).toBe(resolveHref(entry, BASE).href);
    expect(tab(label).getAttribute('href')).toBe(sidebarHref(label));
  });
});

describe('objectui#11211 — the bar honours the rest of the sidebar\'s answer', () => {
  it('lights the tab the sidebar elects, by `resolveActiveNavItem`, and only that one', () => {
    // On the filtered slice only the `filters` tab lights; on the bare list the
    // `runAction` entry is the sidebar's exact match; a record page lights its
    // deep link (the control — a query-less href the old prefix test also hit).
    expect(renderBar([CONTROL, RECORD, FILTERS, RUN_ACTION], `${BASE}/task/data?filter%5Bstatus%5D=open`).lit()).toEqual(['Open Tasks']);
    expect(renderBar([CONTROL, RECORD, FILTERS, RUN_ACTION], `${BASE}/task`).lit()).toEqual(['New Task']);
    expect(renderBar([CONTROL, RECORD, FILTERS, RUN_ACTION], `${BASE}/sys_user/record/u1`).lit()).toEqual(['My Profile']);
  });

  it('opens an `external` answer in a new tab, as the sidebar does; control: an internal tab stays a router link', () => {
    const SITE: NavigationItem = { id: 'nav_site', type: 'url', label: 'Website', url: 'https://example.com/help', target: '_blank' };
    expect(resolveHref(SITE, BASE).external).toBe(true);
    const { tab } = renderBar([CONTROL, SITE]);
    expect(tab('Website').getAttribute('href')).toBe('https://example.com/help');
    expect(tab('Website').getAttribute('target')).toBe('_blank');
    expect(tab('Website').getAttribute('rel')).toBe('noopener noreferrer');
    expect(tab('Accounts').getAttribute('target')).toBeNull();
  });
});
