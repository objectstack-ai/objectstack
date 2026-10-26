/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12188 — the RELATED-LIST half of a lookup-titled card at phone
 * width: what `RelatedList` hands the `object-gallery` it renders below the
 * 768 px breakpoint (`useIsMobile`), when the list's first column is a lookup.
 *
 * The cloud organization page's Members tab is this list: `sys_member` rows
 * under a `sys_organization` parent, first column `user_id`, a `lookup` to
 * `sys_user`. Its card titled `[object Object]` while the desktop grid named
 * the user. The fix sits in the card (`ObjectGallery`'s heading, pinned in
 * `plugin-list`'s `ObjectGallery.lookupTitle-12188.test.tsx`), because this
 * side was measured to hand the value over intact. These pins hold that
 * measurement, so the card-side pin's input stays the real one:
 *
 *  - the node is `object-gallery`, titled by the lookup column, and carries the
 *    child object's name — what the gallery reads the definition by, without
 *    which the title field would enrich to no type at all;
 *  - an `$expand`-ed value reaches the card as the related RECORD, unchanged;
 *  - an UNexpanded value (a backend that ignores `$expand`) reaches it as the
 *    bare id, unchanged — the lookup cell resolves it card-side by its own
 *    fetch, as the grid's lookup cell does;
 *  - the node's keys are exactly the ones the card-side pin feeds.
 *
 * `SchemaRenderer` is captured rather than rendered: `@object-ui/plugin-detail`
 * does not depend on `@object-ui/plugin-list`, so the real card cannot be
 * mounted from here; the two halves meet at the node shape.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

/** Phone width, chosen rather than inherited (objectui#8399): below 768 the list renders a gallery. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
});
afterAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/** Capture the node `RelatedList` hands `SchemaRenderer`. */
const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const OBJECT = 'sys_member';

/** The `sys_member` fields this list draws, as `@objectstack/platform-objects` declares them. */
const memberDef = {
  name: OBJECT,
  fields: {
    organization_id: { type: 'lookup', label: 'Organization', reference: 'sys_organization' },
    user_id: { type: 'lookup', label: 'User', reference: 'sys_user' },
    role: {
      type: 'select',
      label: 'Role',
      options: [
        { value: 'owner', label: 'Owner' },
        { value: 'member', label: 'Member' },
      ],
    },
    created_at: { type: 'datetime', label: 'Created At' },
  },
};

const EXPANDED_USER = { id: 'u_1', name: 'JIANGUO Zhuang', email: 'jz@example.com' };

/**
 * A backend that honours `$expand` (the ObjectStack read path) when `expands`
 * is true, and one that ignores it when false.
 */
const makeDataSource = (expands: boolean) => ({
  getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? memberDef : null)),
  find: vi.fn(async (object: string, params: Record<string, any> = {}) => {
    if (object !== OBJECT) return { data: [] };
    const expandUser = expands && Array.isArray(params.$expand) && params.$expand.includes('user_id');
    return {
      data: [
        {
          id: 'm_1',
          organization_id: 'org_1',
          user_id: expandUser ? EXPANDED_USER : 'u_1',
          role: 'owner',
          created_at: '2026-10-01T08:00:00Z',
        },
      ],
      total: 1,
    };
  }),
});

const renderMembers = (ds: ReturnType<typeof makeDataSource>) =>
  render(
    <RelatedList
      title="Members"
      type="table"
      api={OBJECT}
      objectName={OBJECT}
      referenceField="organization_id"
      parentId="org_1"
      columns={['user_id', 'role', 'created_at']}
      dataSource={ds as any}
    />,
  );

/** Readiness: the gallery node carries fetched rows. */
const galleryLanded = () => h.schema?.type === 'object-gallery' && (h.schema?.data?.length ?? 0) > 0;

beforeEach(() => {
  h.schema = null;
});
afterEach(() => {
  cleanup();
});

describe('objectui#12188 — RelatedList at phone width hands a lookup title to the card intact', () => {
  it('the node is an `object-gallery` titled by the lookup column, naming the child object', async () => {
    renderMembers(makeDataSource(true));
    await waitFor(() => expect(galleryLanded()).toBe(true));

    expect(h.schema.objectName).toBe(OBJECT);
    expect(h.schema.gallery.titleField).toBe('user_id');
    // The parent key is not a column, so it is neither title nor detail row.
    expect(h.schema.gallery.visibleFields).toEqual(['role', 'created_at']);
  });

  it('OBJECT shape: an `$expand`-ed lookup reaches the card as the related record', async () => {
    const ds = makeDataSource(true);
    renderMembers(ds);
    await waitFor(() => expect(galleryLanded()).toBe(true));

    // The list asked for the expansion …
    const params = ds.find.mock.calls.filter(([o]: any[]) => o === OBJECT).at(-1)?.[1] ?? {};
    expect(params.$expand).toContain('user_id');
    // … and hands the record through untouched: naming it is the card's job.
    expect(h.schema.data[0].user_id).toEqual(EXPANDED_USER);
  });

  it('ID shape: a backend that ignores `$expand` hands the card the bare id, unchanged', async () => {
    renderMembers(makeDataSource(false));
    await waitFor(() => expect(galleryLanded()).toBe(true));

    expect(h.schema.data[0].user_id).toBe('u_1');
  });

  it('the node carries exactly the keys the card-side pin feeds the real gallery', async () => {
    renderMembers(makeDataSource(true));
    await waitFor(() => expect(galleryLanded()).toBe(true));

    expect(Object.keys(h.schema).sort()).toEqual(['data', 'gallery', 'objectName', 'onRowClick', 'type']);
    expect(Object.keys(h.schema.gallery).sort()).toEqual(['cardSize', 'coverField', 'titleField', 'visibleFields']);
    expect(h.schema.gallery.coverField).toBe('image');
    expect(h.schema.gallery.cardSize).toBe('medium');
  });
});
