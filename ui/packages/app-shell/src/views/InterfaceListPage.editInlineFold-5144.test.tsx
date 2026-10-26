// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5144, the interface-page half, with the v18 default (objectui#12086).
 *
 * An ADR-0047 interface page reads the page config's `userActions.editInline`
 * with the protocol's default, on (`!== false`, objectstack#22605), and hands
 * it to `ListView` as the view's `inlineEdit`. It does not forward `editInline`
 * itself, so the `userActions` block it builds carries no `editInline` key. The
 * page wires no inline-edit toggle, so that `inlineEdit` is the grid's edit
 * mode: a page that declares nothing opens its grid editable in place, and
 * `editInline: false` is the opt-out.
 *
 * `ListView` reads what this page composes through `normalizeListViewSchema`,
 * which folds the `inlineEdit` the page sets into `userActions.editInline`. So
 * the two readings agree. This file pins it by capturing the schema the page
 * hands `ListView` and running it through the real fold, which is the input
 * `ListView`'s `inlineEditOffered` reads. What `ListView` does with
 * `editInline`, the permission gate included, is pinned in
 * `@object-ui/plugin-list`'s `ListView.permissions.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

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

import { normalizeListViewSchema } from '@object-ui/core';
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

/** Renders the page and returns the schema it hands `ListView`. */
async function composedSchema(pageUserActions: Record<string, unknown> | undefined) {
  testDataSource = {};
  testObjects = [objectDef];
  const page = {
    name: 'showcase_task_list',
    label: 'Tasks',
    interfaceConfig: {
      source: OBJECT_NAME,
      sourceView: 'all',
      recordAction: 'none',
      ...(pageUserActions ? { userActions: pageUserActions } : {}),
    },
  };
  render(<InterfaceListPage page={page as any} />);
  await waitFor(() => expect(screen.queryByTestId('list-view-schema')).not.toBeNull());
  return JSON.parse(screen.getByTestId('list-view-schema').getAttribute('data-schema') || 'null');
}

/** The `editInline` `ListView` reads: the composed schema, through the fold. */
const editInlineRead = (schema: Record<string, unknown>) =>
  (normalizeListViewSchema(schema).userActions as Record<string, unknown> | undefined)?.editInline;

describe('InterfaceListPage: editInline reads the same as ListView after the fold (objectui#5144)', () => {
  beforeEach(() => {
    testDataSource = undefined;
    testObjects = [];
  });

  it('an ABSENT page editInline reads on, on both: edit mode, and `editInline` folds to true (objectui#12086)', async () => {
    const schema = await composedSchema({ search: true });
    // The page's own reading: the protocol default, `!== false`.
    expect(schema.inlineEdit).toBe(true);
    // The page forwards no `editInline` of its own…
    expect(schema.userActions).not.toHaveProperty('editInline');
    // …so `ListView` reads the folded one, which is on.
    expect(editInlineRead(schema)).toBe(true);
  });

  it('a page with no `userActions` block at all reads on the same way', async () => {
    const schema = await composedSchema(undefined);
    expect(schema.inlineEdit).toBe(true);
    expect(editInlineRead(schema)).toBe(true);
  });

  it('an explicit page `editInline: true` reads on, on both', async () => {
    const schema = await composedSchema({ editInline: true });
    expect(schema.inlineEdit).toBe(true);
    expect(editInlineRead(schema)).toBe(true);
  });

  it('an explicit page `editInline: false` is the opt-out: off on both', async () => {
    const schema = await composedSchema({ editInline: false });
    expect(schema.inlineEdit).toBe(false);
    expect(editInlineRead(schema)).toBe(false);
  });
});
