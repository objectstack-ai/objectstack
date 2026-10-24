/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 14 — `generateViewSchema` (the authored `object-view`
 * element's own views) reads each per-kind block by its DECLARED keys only.
 *
 * The second route to the per-kind renderers, beside `ListView`, which
 * `plugin-list`'s `ListView.readersRetired-6152.test.tsx` pins. This branch
 * spread the whole kanban, calendar, gallery, timeline, gantt and tree blocks
 * onto the node after its own keys, and read the pre-#2231 aliases. Every
 * list-view door refuses those keys, so the round retired the reads here too:
 *
 *   1. A block key named like a NODE key no longer overrides the node's own
 *      `objectName` (the K8 hazard of round 13), on every branch that spread.
 *   2. The DECLARED keys keep their route, each beside the undeclared key the
 *      spread used to carry with it. The gantt and timeline arms are driven off
 *      the spec's own block shapes.
 *   3. The gallery cover goes out from `coverField` only. Since objectui#12053
 *      it rides the node's nested `gallery` block (the shape `ListView` hands
 *      `ObjectGallery`), not the flat `imageField` this round left in place;
 *      `ObjectView.galleryBlockNested-12053.test.tsx` pins the rest of the block.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

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

/** Mount an `object-view` whose host `views` entry is one view of `type`, and return the node it generated. */
async function generatedNode(type: string, view: Record<string, unknown>): Promise<any> {
  cleanup();
  rendered.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema}
      views={[{ id: 'v', label: 'View', type, ...view }] as any}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  const node = rendered[rendered.length - 1];
  expect(node.type).toBe(`object-${type}`);
  return node;
}

beforeEach(() => {
  rendered.length = 0;
});

describe('1 · a block key named like a node key no longer overrides the node (objectui#6152 round 14)', () => {
  const ARMS: Array<[string, Record<string, unknown>]> = [
    ['kanban', { kanban: { groupByField: 'stage', objectName: HIJACK } }],
    ['calendar', { calendar: { startDateField: 'due', objectName: HIJACK } }],
    ['gallery', { gallery: { coverField: 'photo', objectName: HIJACK } }],
    ['timeline', { timeline: { startDateField: 'due', objectName: HIJACK } }],
    ['gantt', { gantt: { startDateField: 'due', endDateField: 'due', objectName: HIJACK } }],
    ['tree', { tree: { parentField: 'parent', objectName: HIJACK } }],
  ];
  for (const [type, view] of ARMS) {
    it(`${type}: the node keeps its own \`objectName\``, async () => {
      const node = await generatedNode(type, view);
      expect(node.objectName).toBe('task');
      expect(JSON.stringify(node)).not.toContain(HIJACK);
    });
  }
});

describe('2 · the declared keys keep their route; the undeclared ones do not (objectui#6152 round 14)', () => {
  it('kanban: `summarizeField` reaches the board, `swimlaneField` does not', async () => {
    const node = await generatedNode('kanban', { kanban: { groupByField: 'stage', summarizeField: 'amount', swimlaneField: 'lane' } });
    expect(node.summarizeField).toBe('amount');
    expect(node).not.toHaveProperty('swimlaneField');
  });

  it('calendar: the five declared keys reach the calendar, `defaultView` does not', async () => {
    const node = await generatedNode('calendar', {
      calendar: { startDateField: 'a', endDateField: 'b', titleField: 'c', colorField: 'd', allDayField: 'e', defaultView: 'week' },
    });
    expect([node.startDateField, node.endDateField, node.titleField, node.colorField, node.allDayField]).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(node).not.toHaveProperty('defaultView');
  });

  it('gantt: EVERY key the spec declares on the block reaches the gantt, an undeclared one does not', async () => {
    const declared = Object.keys(SpecListViewSchema.shape.gantt.unwrap().shape);
    expect(declared.length).toBeGreaterThan(20);
    const block = Object.fromEntries(declared.map((k) => [k, `V_${k}`]));
    const node = await generatedNode('gantt', { gantt: { ...block, zzzUndeclared: 1 } });
    for (const k of declared) expect(node[k], k).toBe(`V_${k}`);
    expect(node).not.toHaveProperty('zzzUndeclared');
  });

  it('timeline: EVERY key the spec declares on the block reaches the timeline flat; the `dateField` alias does not', async () => {
    const declared = Object.keys(SpecListViewSchema.shape.timeline.unwrap().shape);
    expect(declared).toContain('startDateField');
    const block = Object.fromEntries(declared.map((k) => [k, `V_${k}`]));
    const node = await generatedNode('timeline', { timeline: { ...block, dateField: 'ALIAS' } });
    for (const k of declared) expect(node[k], k).toBe(`V_${k}`);
    // The alias used to land on the node's FLAT `dateField`, a prop
    // `ObjectTimeline` reads as its own declared binding.
    expect(node).not.toHaveProperty('dateField');
  });

  it('tree: the four declared keys reach the tree, `titleField` labels nothing', async () => {
    const node = await generatedNode('tree', { tree: { parentField: 'p', titleField: 'owner', defaultExpandedDepth: 2 } });
    expect(node.parentField).toBe('p');
    expect(node.labelField).toBe('name');
    expect(node.defaultExpandedDepth).toBe(2);
    expect(node).not.toHaveProperty('titleField');
  });
});

describe('3 · the gallery cover goes out from `coverField` only (objectui#6152 round 14)', () => {
  it('`coverField` becomes the nested `gallery.coverField` the gallery reads (objectui#12053)', async () => {
    const node = await generatedNode('gallery', { gallery: { coverField: 'photo' } });
    expect(node.gallery.coverField).toBe('photo');
  });

  it('the retired `imageField` alias binds no cover', async () => {
    const node = await generatedNode('gallery', { gallery: { imageField: 'photo' } });
    expect(node.gallery).not.toHaveProperty('coverField');
    expect(node.gallery).not.toHaveProperty('imageField');
    expect(node).not.toHaveProperty('imageField');
  });
});
