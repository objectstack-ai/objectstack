/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An authored `flex` node takes its props in its `properties` bag
 * (objectui#11276, the maintainer's ruling A on objectui#11300), and the
 * narrowing is on the AUTHORING faces only: `SchemaRenderer`'s `properties`
 * hoist is untouched, so the bag node and a STORED flat node — a document
 * saved before the change, or a node composed in code — draw the same element.
 *
 * Both halves are read off the real `SchemaRenderer` and the real registry:
 *
 *   - the bag node draws what the flat node draws, class string and subtree
 *     alike, with every `flex` prop in play;
 *   - the stored flat node still draws (the hoist did not move), and the bag's
 *     own key never reaches the DOM as an attribute.
 *
 * The validator half (the flat spelling refused by name) is pinned with the
 * arm, in `packages/types/src/__tests__/flex-properties-bag-11276.test.ts`.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律):
 * registering them is an unbounded module load and must not be billed to a
 * bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';

function draw(schema: unknown) {
  const { container, unmount } = render(<SchemaRenderer schema={schema as never} />);
  const el = container.firstElementChild as HTMLElement;
  const out = { className: el.className, innerHTML: el.innerHTML, attributes: el.getAttributeNames() };
  unmount();
  return out;
}

const PROPS = {
  direction: 'col',
  justify: 'between',
  align: 'center',
  gap: 4,
  wrap: true,
  children: [
    { type: 'text', content: 'First' },
    { type: 'text', content: 'Second' },
  ],
} as const;

const BAG = { type: 'flex', id: 'row', className: 'p-4', properties: PROPS };
const STORED_FLAT = { type: 'flex', id: 'row', className: 'p-4', ...PROPS };

describe('a bag `flex` and a stored flat `flex` draw the same element (objectui#11276)', () => {
  it('the bag node draws every prop: the classes they map to, and the children', () => {
    const drawn = draw(BAG);
    expect(drawn.className).toBe('flex flex-col justify-between items-center gap-2 sm:gap-3 md:gap-4 flex-wrap p-4');
    expect(drawn.innerHTML).toContain('First');
    expect(drawn.innerHTML).toContain('Second');
  });

  it('the stored flat node still draws — `SchemaRenderer`\'s hoist reads both spellings', () => {
    const bag = draw(BAG);
    const flat = draw(STORED_FLAT);
    expect(flat.className).toBe(bag.className);
    expect(flat.innerHTML).toBe(bag.innerHTML);
  });

  it('the bag itself never reaches the DOM as an attribute', () => {
    const drawn = draw(BAG);
    expect(drawn.attributes).not.toContain('properties');
    for (const key of Object.keys(PROPS)) expect(drawn.attributes).not.toContain(key);
  });

  it('control: without the bag the same node draws the renderer defaults, so the readings above are the bag\'s', () => {
    const bare = draw({ type: 'flex', id: 'row', className: 'p-4', children: [] });
    expect(bare.className).toBe('flex flex-row justify-start items-start gap-1.5 sm:gap-2 p-4');
  });
});
