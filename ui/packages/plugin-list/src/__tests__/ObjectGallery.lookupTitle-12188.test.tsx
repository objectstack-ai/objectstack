/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12188 — a gallery card whose title field is a LOOKUP draws the
 * referenced record's name, never `[object Object]` and never the bare id.
 *
 * ## The defect
 *
 * `renderCard` titled each card `String(item[titleField])`. A reference value
 * read through `$expand` is the related RECORD, so the title printed the
 * literal `[object Object]` — on the cloud organization page's Members tab at
 * phone width, where `RelatedList` hands its rows to this gallery and the
 * first column, `sys_member.user_id`, is a `lookup` to `sys_user`. The same
 * card's detail rows (`renderFields`) and the desktop grid's cells already drew
 * that value through `getCellRenderer`; only the title did not.
 *
 * ## The fix these pins hold
 *
 *  - The title CONTENT of a reference-typed title field (the
 *    `EXPANDABLE_FIELD_TYPES` family `@object-ui/core` owns) renders through
 *    the same cell renderer `renderFields` uses, with the field enriched the
 *    same way — so an expanded record draws its name, and a bare id is
 *    resolved by the lookup cell's own fetch, exactly as in the grid.
 *  - The title TEXT (the heading's `title` tooltip, the cover / icon tile,
 *    the placeholder seed) comes from `getRecordDisplayName(objectDef, item,
 *    { titleField })`, the ADR-0079 resolver that was already this card's
 *    fallback: an embedded record resolves through its display chain.
 *  - A plain `text` title is BYTE-IDENTICAL to before (the control).
 *
 * ## The related-list half
 *
 * The first three cases feed the gallery the node `RelatedList`'s mobile
 * branch emits (its `viewSchema` memo: `type`, `data`, `objectName`, and
 * `gallery` carrying `titleField` = the first column, `visibleFields`,
 * `coverField: 'image'`, `cardSize: 'medium'`), rendered through the real
 * `SchemaRenderer` and registry. That `RelatedList` emits that node at phone
 * width, with the lookup value unchanged in both shapes, is pinned on its own
 * side in `plugin-detail`'s `RelatedList.mobileLookupTitle-12188.test.tsx`;
 * `@object-ui/plugin-detail` does not depend on this package, so the two
 * halves meet at the node shape.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
// Registers `object-gallery` → the real `ObjectGallery`.
import '../index';

afterEach(() => cleanup());

const OBJECT_DEF_LITERAL = '[object Object]';

/** `sys_member`, as `@objectstack/platform-objects` declares the fields this card reads. */
const memberDef = {
  name: 'sys_member',
  fields: {
    user_id: { type: 'lookup', label: 'User', reference: 'sys_user' },
    role: {
      type: 'select',
      label: 'Role',
      options: [
        { value: 'owner', label: 'Owner' },
        { value: 'member', label: 'Member' },
      ],
    },
    owner: { type: 'user', label: 'Owner', reference: 'sys_user' },
    note: { type: 'text', label: 'Note' },
  },
};

const userDef = {
  name: 'sys_user',
  nameField: 'name',
  fields: { name: { type: 'text', label: 'Name' }, email: { type: 'email', label: 'Email' } },
};

/** The referenced users the id-shaped arm resolves through the lookup cell's own fetch. */
const users: Record<string, Record<string, unknown>> = {
  u_id_shape: { id: 'u_id_shape', name: 'Ada Lovelace', email: 'ada@example.com' },
};

function makeDataSource(opts: { rows?: Record<string, unknown>[]; noSchema?: boolean } = {}) {
  return {
    find: vi.fn(async (_object: string) => opts.rows ?? []),
    findOne: vi.fn(async (_object: string, id: unknown) => users[String(id)]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...(opts.noSchema
      ? {}
      : {
          getObjectSchema: vi.fn(async (name: string) =>
            name === 'sys_member' ? memberDef : name === 'sys_user' ? userDef : null,
          ),
        }),
  };
}

/** The node `RelatedList`'s mobile branch hands `SchemaRenderer` (see the file header). */
function relatedListGalleryNode(rows: Record<string, unknown>[], titleField = 'user_id') {
  return {
    type: 'object-gallery',
    data: rows,
    objectName: 'sys_member',
    gallery: {
      titleField,
      visibleFields: ['role'],
      coverField: 'image',
      cardSize: 'medium',
    },
  };
}

function renderNode(node: unknown, ds: ReturnType<typeof makeDataSource>) {
  return render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={node as any} />
    </SchemaRendererProvider>,
  );
}

/** Every card heading, in DOM order. */
const headings = () => screen.getAllByRole('heading', { level: 3 }) as HTMLElement[];

describe('objectui#12188 — a lookup title field on a gallery card draws the referenced name', () => {
  it('related-list hand-off, OBJECT-shaped value ($expand-ed): the card title is the user name', async () => {
    const ds = makeDataSource();
    const { container } = renderNode(
      relatedListGalleryNode([
        {
          id: 'm1',
          user_id: { id: 'u_obj_shape', name: 'JIANGUO Zhuang', email: 'jz@example.com' },
          role: 'owner',
        },
      ]),
      ds,
    );

    await waitFor(() => expect(headings()[0].textContent).toBe('JIANGUO Zhuang'));
    // The heading's own tooltip is TEXT, from the ADR-0079 resolver.
    expect(headings()[0].getAttribute('title')).toBe('JIANGUO Zhuang');
    expect(container.textContent).not.toContain(OBJECT_DEF_LITERAL);
    expect(container.innerHTML).not.toContain(OBJECT_DEF_LITERAL);
  });

  it('related-list hand-off, ID-shaped value (not expanded): the lookup cell resolves the name', async () => {
    const ds = makeDataSource();
    const { container } = renderNode(
      relatedListGalleryNode([{ id: 'm2', user_id: 'u_id_shape', role: 'member' }]),
      ds,
    );

    // Resolved by `LookupCellRenderer`'s fetch-on-demand, the same answer the
    // grid's lookup cell gives — not a raw id printed as if it were a name.
    await waitFor(() => expect(headings()[0].textContent).toBe('Ada Lovelace'));
    expect(ds.findOne).toHaveBeenCalledWith('sys_user', 'u_id_shape');
    expect(container.textContent).not.toContain(OBJECT_DEF_LITERAL);
  });

  it('a `user`-typed title field, object-shaped: the user cell names the person', async () => {
    const ds = makeDataSource();
    const { container } = renderNode(
      relatedListGalleryNode(
        [{ id: 'm3', owner: { id: 'u_owner', name: 'Grace Hopper' }, role: 'member' }],
        'owner',
      ),
      ds,
    );

    await waitFor(() => expect(headings()[0].textContent).toContain('Grace Hopper'));
    expect(headings()[0].getAttribute('title')).toBe('Grace Hopper');
    expect(container.textContent).not.toContain(OBJECT_DEF_LITERAL);
  });

  it('a standalone gallery whose title field is a lookup (its own `$expand`-ed query)', async () => {
    const ds = makeDataSource({
      rows: [{ id: 'm4', user_id: { id: 'u_standalone', name: 'Katherine Johnson' }, role: 'owner' }],
    });
    const { container } = renderNode(
      { type: 'object-gallery', objectName: 'sys_member', gallery: { titleField: 'user_id' } },
      ds,
    );

    await waitFor(() => expect(headings()[0].textContent).toBe('Katherine Johnson'));
    // The gallery owned this query and asked for the lookup to be expanded.
    expect(ds.find).toHaveBeenCalledWith('sys_member', expect.objectContaining({ $expand: expect.arrayContaining(['user_id']) }));
    expect(container.textContent).not.toContain(OBJECT_DEF_LITERAL);
  });

  it('no object definition reachable: the embedded record still titles by its name (TEXT path)', async () => {
    // A host whose adapter cannot describe objects: the title field enriches
    // to no type, so the content stays text — and the text is the ADR-0079
    // resolver's reading of the embedded record, not `String(object)`.
    const ds = makeDataSource({ noSchema: true });
    const { container } = renderNode(
      relatedListGalleryNode([{ id: 'm5', user_id: { id: 'u_noschema', name: 'Dorothy Vaughan' } }]),
      ds,
    );

    await waitFor(() => expect(headings()[0].textContent).toBe('Dorothy Vaughan'));
    expect(headings()[0].innerHTML).toBe('Dorothy Vaughan');
    expect(container.textContent).not.toContain(OBJECT_DEF_LITERAL);
  });

  it('CONTROL: a plain text title is byte-identical — bare text in the heading, same tooltip', async () => {
    const ds = makeDataSource();
    renderNode(relatedListGalleryNode([{ id: 'm6', note: 'Fix the pump', role: 'owner' }], 'note'), ds);

    await waitFor(() => expect(headings()[0].textContent).toBe('Fix the pump'));
    // No cell-renderer wrapper: the heading holds the text node alone, as it
    // always did, so every existing gallery DOM assertion is unaffected.
    expect(headings()[0].innerHTML).toBe('Fix the pump');
    expect(headings()[0].getAttribute('title')).toBe('Fix the pump');
  });
});
