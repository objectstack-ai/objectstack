/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11465 — `SidebarSchema.variant` takes the `sidebar` registration's
 * own enum, held against the LIVE registration rather than a copied list.
 *
 * Before this card the two disagreed: the registration offered shadcn's
 * `sidebar` / `floating` / `inset`, while both `@object-ui/types` faces
 * declared `default` / `bordered` / `floating`. So `objectui validate` refused
 * two of the three values the registration offers, and accepted two values
 * shadcn does not know (they drew exactly what `sidebar` draws). This file
 * reads the registration's `variant` input and asks both validator faces
 * about every value in it, so a registration that grows a value the schema
 * does not take turns this red.
 *
 * The render half holds what the declaration says about the three values,
 * measured through the real `SchemaRenderer` and registry: on the collapsible
 * form each draws differently, and on the in-flow form (`collapsible: false`)
 * shadcn ignores `variant`, so every value draws the same column.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { safeValidateSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';
import '../../renderers';

afterEach(cleanup);

const ITEMS = [{ type: 'text', content: 'Dashboard' }];

type Parse = { success: boolean; error?: { issues: { path: PropertyKey[] }[] } };
const strict = StrictAnyComponentSchema as unknown as { safeParse: (v: unknown) => Parse };
const refusedAt = (result: Parse) => (result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.join('.')));

/** The `variant` enum the live `sidebar` registration offers. */
function registeredVariants(): string[] {
  const inputs = (ComponentRegistry.getMeta('sidebar')?.inputs ?? []) as { name: string; enum?: unknown[] }[];
  const variant = inputs.find((i) => i.name === 'variant');
  if (!variant || !Array.isArray(variant.enum)) throw new Error('the `sidebar` registration offers no `variant` enum');
  return variant.enum.map(String);
}

/** The markup a node draws in a bare host (the node mounts its own provider there). */
const markup = (node: object) => {
  const { container } = render(<SchemaRenderer schema={node as never} />);
  const html = container.innerHTML;
  cleanup();
  return html;
};

describe('`SidebarSchema.variant` is the registration\'s enum (objectui#11465)', () => {
  it('the registration offers a non-empty enum, without the two retired values', () => {
    const offered = registeredVariants();
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain('default');
    expect(offered).not.toContain('bordered');
  });

  it('every value the registration offers validates on the strict face and the tolerant face', () => {
    const refused = registeredVariants().flatMap((variant) => {
      const node = { type: 'sidebar', variant, children: ITEMS };
      return [
        ...refusedAt(strict.safeParse(node)).map((p) => `strict ${variant} @${p}`),
        ...refusedAt(safeValidateSchema(node) as Parse).map((p) => `tolerant ${variant} @${p}`),
      ];
    });
    expect(refused).toEqual([]);
  });

  it.each(['default', 'bordered'])('the retired `%s` is refused at `variant` on both faces', (variant) => {
    const node = { type: 'sidebar', variant, children: ITEMS };
    expect(refusedAt(strict.safeParse(node))).toEqual(['variant']);
    expect(refusedAt(safeValidateSchema(node) as Parse)).toEqual(['variant']);
  });
});

describe('what each variant draws, through the real SchemaRenderer (objectui#11465)', () => {
  it('on the collapsible form, every offered value draws differently, and `sidebar` is the default', () => {
    const base = { type: 'sidebar', children: ITEMS };
    const drawn = registeredVariants().map((variant) => markup({ ...base, variant }));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(markup({ ...base, variant: 'sidebar' })).toBe(markup(base));
  });

  it('on the in-flow form (`collapsible: false`), every value draws the same column', () => {
    const base = { type: 'sidebar', collapsible: false, children: ITEMS };
    const absent = markup(base);
    for (const variant of registeredVariants()) {
      expect(markup({ ...base, variant }), variant).toBe(absent);
    }
  });
});
