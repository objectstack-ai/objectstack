import { describe, it, expect } from 'vitest';
import { mergeLayoutIntoSchema } from '../DashboardGridLayout';
import type { DashboardComponentSchema } from '@object-ui/types';

// No dashboard-root `title`: that key was retired (objectui#7509), so it was
// inert here and compiled only through `BaseSchema`'s index signature
// (objectui#11348). Nothing below reads it.
const SCHEMA: DashboardComponentSchema = {
  type: 'dashboard',
  name: 'demo',
  widgets: [
    { id: 'w1', title: 'A', type: 'metric', layout: { x: 0, y: 0, w: 3, h: 2 } },
    { id: 'w2', title: 'B', type: 'metric', layout: { x: 3, y: 0, w: 3, h: 2 } },
  ],
};

describe('mergeLayoutIntoSchema', () => {
  it('writes new x/y/w/h back into each widget by id', () => {
    const next = mergeLayoutIntoSchema(SCHEMA, [
      { i: 'w1', x: 6, y: 0, w: 6, h: 5 },
      { i: 'w2', x: 0, y: 5, w: 12, h: 4 },
    ]);
    expect(next.widgets?.[0]).toMatchObject({
      id: 'w1',
      title: 'A',
      layout: { x: 6, y: 0, w: 6, h: 5 },
    });
    expect(next.widgets?.[1]).toMatchObject({
      id: 'w2',
      title: 'B',
      layout: { x: 0, y: 5, w: 12, h: 4 },
    });
  });

  it('leaves widgets without a matching layout entry untouched', () => {
    const next = mergeLayoutIntoSchema(SCHEMA, [
      { i: 'w1', x: 6, y: 0, w: 6, h: 5 },
    ]);
    expect(next.widgets?.[1]).toEqual(SCHEMA.widgets?.[1]);
  });

  it('returns the original schema reference when there are no widgets', () => {
    const empty: DashboardComponentSchema = { type: 'dashboard', name: 'empty', widgets: [] };
    expect(mergeLayoutIntoSchema(empty, [{ i: 'x', x: 0, y: 0, w: 1, h: 1 }])).toBe(empty);
  });

  it('falls back to "widget-${index}" id for widgets missing an explicit id', () => {
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      name: 'unnamed',
      widgets: [{ title: 'no id', type: 'metric' }],
    };
    const next = mergeLayoutIntoSchema(schema, [
      { i: 'widget-0', x: 2, y: 3, w: 4, h: 5 },
    ]);
    // Read through the slot's element type (objectui#11514): both arms declare
    // `layout`, the component arm by reference to the spec's widget member.
    const first: DashboardComponentSchema['widgets'][number] | undefined = next.widgets?.[0];
    expect(first?.layout).toEqual({ x: 2, y: 3, w: 4, h: 5 });
  });
});
