// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An interface page's toolbar toggles read the published defaults of
 * `UserActionsConfigSchema` — the one schema a page's
 * `interfaceConfig.userActions` and a list view's `userActions` share.
 *
 * The spec declares `search`, `sort`, `filter`, `rowHeight`, `group` and
 * `hideFields` on by default and `rowColor` off by default. The page used to
 * read four of the on-by-default toggles as `=== true`, so a control appeared
 * only after a parse had materialised the default: a parsed block that omitted
 * `hideFields` drew Hide Fields, while a page with no `userActions` block, or
 * a stored page that was never parsed, did not. One page, two toolbars,
 * decided by the route it took to the console.
 *
 * This file captures the schema the page hands `ListView` and pins the
 * `userActions` it composes. `ListView` draws each control off that block
 * (`ua?.filter !== false`, … in its toolbar flags, `ua?.rowColor === true` for
 * colour), so an explicit boolean here is the toolbar. That read is
 * `@object-ui/plugin-list`'s and is unchanged here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { PageSchema, UserActionsConfigSchema } from '@objectstack/spec/ui';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useObjectTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return { ...actual, useAuth: () => ({}) };
});

// Only the schema this page hands `ListView` is under test.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => (
    <div data-testid="list-view-schema" data-schema={JSON.stringify(props?.schema ?? null)} />
  ),
}));

let testDataSource: any;
let testObjects: any[];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useAdapter: () => testDataSource,
    useMetadata: () => ({ objects: testObjects }),
  };
});

import { InterfaceListPage } from './InterfaceListPage';

const OBJECT_NAME = 'showcase_task';
const VIEW_ID = `${OBJECT_NAME}.all`;

const objectDef = {
  name: OBJECT_NAME,
  fields: { title: { type: 'text' }, status: { type: 'text' } },
  listViews: {
    [VIEW_ID]: { name: VIEW_ID, type: 'grid', columns: ['title', 'status'] },
  },
};

const PAGE_BASE = {
  name: 'showcase_task_list',
  label: 'Tasks',
  type: 'list',
};

/** The `interfaceConfig` of a page, with or without a `userActions` block. */
function interfaceConfig(userActions: Record<string, unknown> | undefined) {
  return {
    source: OBJECT_NAME,
    sourceView: 'all',
    recordAction: 'none',
    ...(userActions ? { userActions } : {}),
  };
}

/** Renders the page and returns the `userActions` block it hands `ListView`. */
async function composedUserActions(page: Record<string, unknown>) {
  testDataSource = {};
  testObjects = [objectDef];
  render(<InterfaceListPage page={page as any} />);
  await waitFor(() => expect(screen.queryByTestId('list-view-schema')).not.toBeNull());
  const schema = JSON.parse(screen.getByTestId('list-view-schema').getAttribute('data-schema') || 'null');
  cleanup();
  return schema.userActions as Record<string, boolean>;
}

/** A page exactly as authored: never parsed, defaults not materialised. */
const unparsedPage = (userActions: Record<string, unknown> | undefined) => ({
  ...PAGE_BASE,
  interfaceConfig: interfaceConfig(userActions),
});

/** The same page after the spec parse, which materialises every default. */
const parsedPage = (userActions: Record<string, unknown> | undefined) =>
  PageSchema.parse(unparsedPage(userActions)) as Record<string, unknown>;

/** The toolbar a page that says nothing gets: the spec defaults. */
const SPEC_DEFAULT_TOOLBAR = {
  search: true,
  sort: true,
  filter: true,
  rowHeight: true,
  group: true,
  hideFields: true,
  rowColor: false,
};

const ON_BY_DEFAULT = ['filter', 'rowHeight', 'group', 'hideFields'] as const;

describe('InterfaceListPage: userActions toggles read the UserActionsConfigSchema defaults', () => {
  beforeEach(() => {
    testDataSource = undefined;
    testObjects = [];
  });

  it('a page with NO userActions block offers filter, rowHeight, group and hideFields', async () => {
    expect(await composedUserActions(unparsedPage(undefined))).toEqual(SPEC_DEFAULT_TOOLBAR);
  });

  it('an unparsed empty block draws the same toolbar as no block', async () => {
    expect(await composedUserActions(unparsedPage({}))).toEqual(SPEC_DEFAULT_TOOLBAR);
  });

  it('a parsed block that omits every key draws the same toolbar as no block', async () => {
    const parsed = parsedPage({});
    // The parse materialised the defaults the page now reads for an omitted key.
    expect((parsed.interfaceConfig as any).userActions).toMatchObject(SPEC_DEFAULT_TOOLBAR);
    expect(await composedUserActions(parsed)).toEqual(SPEC_DEFAULT_TOOLBAR);
  });

  it('a curated block draws the same toolbar parsed or unparsed', async () => {
    // The shape the showcase and HotCRM interface pages author: it omits
    // `group` and `hideFields`, so both take the spec default.
    const curated = { sort: true, search: true, filter: false, rowHeight: false, addRecordForm: false };
    const expected = { ...SPEC_DEFAULT_TOOLBAR, filter: false, rowHeight: false };
    expect(await composedUserActions(unparsedPage(curated))).toEqual(expected);
    expect(await composedUserActions(parsedPage(curated))).toEqual(expected);
  });

  it.each(ON_BY_DEFAULT)('an explicit `%s: false` withholds that control alone', async (key) => {
    expect(await composedUserActions(unparsedPage({ [key]: false }))).toEqual({
      ...SPEC_DEFAULT_TOOLBAR,
      [key]: false,
    });
  });

  it.each(ON_BY_DEFAULT)('an explicit `%s: true` keeps that control', async (key) => {
    expect((await composedUserActions(unparsedPage({ [key]: true })))[key]).toBe(true);
  });

  it.each([
    ['no keys', {}],
    ['a curated block', { sort: true, search: true, filter: false, rowHeight: false }],
    ['every control withheld', { filter: false, rowHeight: false, group: false, hideFields: false, rowColor: false }],
    ['row colour opted in', { rowColor: true, hideFields: false }],
  ])('%s: the page draws what a list view parses the same block to', async (_label, block) => {
    // One key, one default, on both surfaces: a list view's `userActions`
    // is this schema, and `ListView` draws its toolbar from the parsed values.
    const listView: Record<string, unknown> = UserActionsConfigSchema.parse(block);
    const composed = await composedUserActions(unparsedPage(block));
    for (const key of Object.keys(SPEC_DEFAULT_TOOLBAR)) {
      expect([key, composed[key]]).toEqual([key, listView[key]]);
    }
  });

  it('rowColor stays opt-in, as the spec declares it: off when omitted, on only for `true`', async () => {
    expect((await composedUserActions(unparsedPage(undefined))).rowColor).toBe(false);
    expect((await composedUserActions(parsedPage({}))).rowColor).toBe(false);
    expect((await composedUserActions(unparsedPage({ rowColor: true }))).rowColor).toBe(true);
  });
});
