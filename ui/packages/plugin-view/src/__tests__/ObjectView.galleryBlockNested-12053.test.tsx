/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12053 — `generateViewSchema` hands `ObjectGallery` the gallery block
 * NESTED, as the node's own `gallery`.
 *
 * `ObjectGallery` reads `coverFit`, `cardSize` and `visibleFields` off
 * `schema.gallery` and nowhere else (`coverField` and `titleField` too, ahead
 * of the flat `imageField` / `titleField`). This branch built a FLAT node
 * carrying `imageField` and `titleField` only, so a gallery view handed to
 * plugin-view's `ObjectView` drew `coverFit: 'contain'` covers cropped, at the
 * default card size, with no card body. `ListView`, the other route to the
 * same renderer, already hands it the nested block.
 *
 * The node is read at the `SchemaRenderer` seam, the sink every sibling file
 * here uses. The end-to-end reading through the real `ObjectGallery` is on the
 * pull request: this package does not depend on `@object-ui/plugin-list`, so
 * its type-checked test program cannot import the renderer.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ObjectView } from '../ObjectView';
import type { NamedListView, ObjectViewSchema } from '@object-ui/types';

const HIJACK = 'HIJACK_FROM_THE_BLOCK';
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: ReactMod.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: { name: { name: 'name', type: 'text' } } }),
});

const NODE = { type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema;

/**
 * Mount and return the last node handed to `SchemaRenderer`. `cleanup()` is
 * load-bearing: a previous mount keeps pushing into the sink otherwise
 * (objectui#9242).
 */
async function mountAndRead(ui: React.ReactElement): Promise<any> {
  cleanup();
  rendered.length = 0;
  render(ui);
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  const node = rendered[rendered.length - 1];
  expect(node.type).toBe('object-gallery');
  return node;
}

/** The host `views` prop route: one gallery view carrying `gallery`. */
function viaViewsProp(gallery: Record<string, unknown>): Promise<any> {
  return mountAndRead(
    <ObjectView
      schema={NODE}
      views={[{ id: 'v', label: 'Cards', type: 'gallery', gallery }] as any}
      dataSource={dataSource()}
    />,
  );
}

/** The named `listViews` route: the same block on a named view. */
function viaNamedView(gallery: NonNullable<NamedListView['gallery']>): Promise<any> {
  return mountAndRead(
    <ObjectView
      schema={{ ...NODE, listViews: { cards: { label: 'Cards', type: 'gallery', gallery } } } as unknown as ObjectViewSchema}
      dataSource={dataSource()}
    />,
  );
}

const ROUTES: Array<[string, (gallery: any) => Promise<any>]> = [
  ['the host `views` prop', viaViewsProp],
  ['a named `listViews` entry', viaNamedView],
];

beforeEach(() => {
  rendered.length = 0;
});

for (const [route, mount] of ROUTES) {
  describe(`${route}: the gallery block reaches ObjectGallery nested (objectui#12053)`, () => {
    it('`coverFit: contain` reaches `gallery.coverFit`', async () => {
      const node = await mount({ coverField: 'photo', coverFit: 'contain' });
      expect(node.gallery.coverFit).toBe('contain');
      expect(node.gallery.coverField).toBe('photo');
    });

    it('`cardSize` and `visibleFields` reach `gallery` the same way', async () => {
      const node = await mount({ cardSize: 'small', visibleFields: ['stage', 'amount'] });
      expect(node.gallery.cardSize).toBe('small');
      expect(node.gallery.visibleFields).toEqual(['stage', 'amount']);
    });

    it('EVERY key the spec declares on the block reaches `gallery`', async () => {
      const declared = Object.keys(SpecListViewSchema.shape.gallery.unwrap().shape);
      expect(declared).toContain('coverFit');
      const block = Object.fromEntries(declared.map((k) => [k, `V_${k}`]));
      const node = await mount(block);
      for (const k of declared) expect(node.gallery[k], k).toBe(`V_${k}`);
    });

    it('one spelling per key: no flat `imageField` or `titleField` beside the block', async () => {
      const node = await mount({ coverField: 'photo', titleField: 'subject' });
      expect(node.gallery.titleField).toBe('subject');
      expect(node).not.toHaveProperty('imageField');
      expect(node).not.toHaveProperty('titleField');
    });

    it('an undeclared title keeps the branch\'s `name` floor, inside the block', async () => {
      const node = await mount({ coverField: 'photo' });
      expect(node.gallery.titleField).toBe('name');
    });
  });
}

describe('control: an undeclared key in the authored block does not reach the node (objectui#12053)', () => {
  it('neither inside `gallery` nor on the node', async () => {
    const node = await viaViewsProp({ coverFit: 'contain', zzzUndeclared: 1, objectName: HIJACK });
    expect(node.gallery.coverFit).toBe('contain');
    expect(node.gallery).not.toHaveProperty('zzzUndeclared');
    expect(node).not.toHaveProperty('zzzUndeclared');
    expect(node.objectName).toBe('task');
    expect(JSON.stringify(node)).not.toContain(HIJACK);
  });
});
