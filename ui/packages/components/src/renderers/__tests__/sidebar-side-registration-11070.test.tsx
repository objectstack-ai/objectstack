/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11070 round 12 — `SidebarSchema.side` takes the `sidebar`
 * registration's own enum, held against the LIVE registration rather than a
 * copied list.
 *
 * Before this round the registration offered `side` (`left` / `right`) and
 * shadcn's `Sidebar` drew by it, while neither `@object-ui/types` face declared
 * it: the strict authoring face (`StrictAnyComponentSchema`) refused it with
 * `unrecognized_keys`, so `objectui validate` on that face would have told an
 * author to delete a key that works. This file reads the registration's `side`
 * input and asks both validator faces about every value in it, so a
 * registration that grows a value the schema does not take turns this red.
 *
 * The render half holds what the declaration says about the two values,
 * measured through the real `SchemaRenderer` and registry. The node does not
 * name `side`: it reaches shadcn's `Sidebar` through the props the node
 * forwards. On the collapsible form the two values draw differently and `left`
 * is the default; on the in-flow form (`collapsible: false`) shadcn ignores
 * `side`, so every value draws the same column.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { safeValidateSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';
import '../../renderers';

afterEach(cleanup);

const ITEMS = [{ type: 'text', content: 'Details' }];

type Parse = { success: boolean; error?: { issues: { path: PropertyKey[] }[] } };
const strict = StrictAnyComponentSchema as unknown as { safeParse: (v: unknown) => Parse };
const refusedAt = (result: Parse) => (result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.join('.')));

/** The `side` enum the live `sidebar` registration offers. */
function registeredSides(): string[] {
  const inputs = (ComponentRegistry.getMeta('sidebar')?.inputs ?? []) as { name: string; enum?: unknown[] }[];
  const side = inputs.find((i) => i.name === 'side');
  if (!side || !Array.isArray(side.enum)) throw new Error('the `sidebar` registration offers no `side` enum');
  return side.enum.map(String);
}

/** The markup a node draws in a bare host (the node mounts its own provider there). */
const markup = (node: object) => {
  const { container } = render(<SchemaRenderer schema={node as never} />);
  const html = container.innerHTML;
  cleanup();
  return html;
};

describe('`SidebarSchema.side` is the registration\'s enum (objectui#11070)', () => {
  it('the registration offers a non-empty enum', () => {
    expect(registeredSides().length).toBeGreaterThan(0);
  });

  it('every value the registration offers validates on the strict face and the tolerant face', () => {
    const refused = registeredSides().flatMap((side) => {
      const node = { type: 'sidebar', side, children: ITEMS };
      return [
        ...refusedAt(strict.safeParse(node)).map((p) => `strict ${side} @${p}`),
        ...refusedAt(safeValidateSchema(node) as Parse).map((p) => `tolerant ${side} @${p}`),
      ];
    });
    expect(refused).toEqual([]);
  });

  it('a value outside the enum is refused at `side` on both faces', () => {
    const node = { type: 'sidebar', side: 'top', children: ITEMS };
    expect(refusedAt(strict.safeParse(node))).toEqual(['side']);
    expect(refusedAt(safeValidateSchema(node) as Parse)).toEqual(['side']);
  });
});

describe('what each side draws, through the real SchemaRenderer (objectui#11070)', () => {
  it('on the collapsible form, every offered value draws differently, and `left` is the default', () => {
    const base = { type: 'sidebar', children: ITEMS };
    const drawn = registeredSides().map((side) => markup({ ...base, side }));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(markup({ ...base, side: 'left' })).toBe(markup(base));
    // The difference is the edge shadcn pins the panel to: the outer element
    // names the side, and the panel is positioned at that edge.
    const right = markup({ ...base, side: 'right' });
    expect(right).toContain('data-side="right"');
    expect(right).toContain('right-0');
    expect(markup(base)).toContain('data-side="left"');
  });

  it('on the in-flow form (`collapsible: false`), every value draws the same column', () => {
    const base = { type: 'sidebar', collapsible: false, children: ITEMS };
    const absent = markup(base);
    for (const side of registeredSides()) {
      expect(markup({ ...base, side }), side).toBe(absent);
    }
  });
});
