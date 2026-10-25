import { describe, it, expect } from 'vitest';
import { parsePath, readAt, writeAt, readSiblings, writeSiblings, getByPath, setByPath, hopsToPath } from '../PageBlockInspector';

const draft = {
  regions: [
    {
      name: 'main',
      components: [
        { type: 'element:text' },
        {
          type: 'page:tabs',
          properties: {
            items: [
              { key: 'a', label: 'A', children: [{ type: 'record:line_items', properties: { childObject: 'showcase_task' } }] },
              { key: 'b', label: 'B', children: [] },
            ],
          },
        },
      ],
    },
  ],
};

describe('PageBlockInspector path helpers (object-key + array hops)', () => {
  it('parsePath accepts both key and key[index] segments', () => {
    expect(parsePath('regions[0].components[1]')).toEqual([
      { key: 'regions', index: 0 },
      { key: 'components', index: 1 },
    ]);
    expect(parsePath('regions[0].components[1].properties.items[0].children[0]')).toEqual([
      { key: 'regions', index: 0 },
      { key: 'components', index: 1 },
      { key: 'properties', index: -1 },
      { key: 'items', index: 0 },
      { key: 'children', index: 0 },
    ]);
    expect(parsePath('not a path!')).toBeNull();
  });

  it('readAt resolves a deeply nested block under properties.items[].children', () => {
    const hops = parsePath('regions[0].components[1].properties.items[0].children[0]')!;
    expect(readAt(draft as any, hops)).toEqual({ type: 'record:line_items', properties: { childObject: 'showcase_task' } });
  });

  it('writeAt immutably patches a nested block and returns a top-level patch', () => {
    const hops = parsePath('regions[0].components[1].properties.items[0].children[0]')!;
    const patch = writeAt(draft as any, hops, { type: 'record:line_items', properties: { childObject: 'edited' } });
    expect(Object.keys(patch)).toEqual(['regions']);
    const newChild = (patch as any).regions[0].components[1].properties.items[0].children[0];
    expect(newChild.properties.childObject).toBe('edited');
    // original draft untouched (immutability)
    expect((draft as any).regions[0].components[1].properties.items[0].children[0].properties.childObject).toBe('showcase_task');
  });

  it('writeAt removes a nested block when replacement is null', () => {
    const hops = parsePath('regions[0].components[1].properties.items[0].children[0]')!;
    const patch = writeAt(draft as any, hops, null);
    expect((patch as any).regions[0].components[1].properties.items[0].children).toHaveLength(0);
  });

  it('appends a block into a nested children array (the add-nested path)', () => {
    const path = hopsToPath(parsePath('regions[0].components[1].properties.items[1].children')!);
    const cur = getByPath(draft as any, path) || [];
    expect(cur).toHaveLength(0);
    const next = setByPath(draft as any, path, [...cur, { type: 'element:text' }]);
    expect(next.regions[0].components[1].properties.items[1].children).toEqual([{ type: 'element:text' }]);
    // original untouched
    expect((draft as any).regions[0].components[1].properties.items[1].children).toHaveLength(0);
  });

  it('readSiblings / writeSiblings operate on the nested children array', () => {
    const hops = parsePath('regions[0].components[1].properties.items[0].children[0]')!;
    const sib = readSiblings(draft as any, hops)!;
    expect(sib.index).toBe(0);
    expect(sib.siblings).toHaveLength(1);
    const patch = writeSiblings(draft as any, hops, [{ type: 'x' }, { type: 'y' }]);
    expect((patch as any).regions[0].components[1].properties.items[0].children).toEqual([{ type: 'x' }, { type: 'y' }]);
  });
});
