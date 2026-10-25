/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:header-bar` merges the authored `BaseSchema.className` onto its root
 * `header` (objectui#10397).
 *
 * `HeaderBarSchema` extends `BaseSchema`, whose `className` is the declared
 * Tailwind override channel. The renderer's root carried a fixed class string,
 * so a header authored with `className` rendered byte-identical to one without
 * it. The root now merges `schema.className` AFTER its own classes through
 * `cn()` (tailwind-merge), so an authored utility that conflicts with a default
 * replaces it.
 *
 * Every row renders through the real `SchemaRenderer` and the real registry —
 * the path an authored JSON node takes — not a direct mount of the registered
 * component.
 *
 * ## The `SidebarProvider` host
 *
 * `header-bar` renders `SidebarTrigger`, which calls `useSidebar()` and THROWS
 * without a provider. `SchemaErrorBoundary` catches that and paints markup with
 * no `header` in it, so `headerFor` refuses to return anything but the real
 * element, and the harness row asserts it rather than assuming it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { scopeClassFor } from '@object-ui/core';
// Registered at module scope, NOT in a `beforeAll`: there the cold transform is
// billed to `hookTimeout`, which is narrower than the timeout it replaces
// (objectui#3010 / #3021, and `object-ui/no-dynamic-import-in-test-hook`).
import '../renderers';
import { SidebarProvider } from '../ui';

afterEach(() => cleanup());

/**
 * The root's class attribute before objectui#10397, verbatim. The no-`className`
 * control compares against THIS rather than against another render of the same
 * tree, because "unchanged" means unchanged from before the repair.
 */
const PRE_REPAIR_ROOT_CLASS = 'flex h-14 sm:h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-4';

/** A class no Tailwind utility spells, so tailwind-merge can never drop it. */
const AUTHORED = 'zz-header-bar-authored-10397';

function headerFor(schema: Record<string, unknown>): HTMLElement {
  const { container } = render(
    <SidebarProvider>
      <SchemaRenderer schema={{ type: 'header-bar', ...schema } as never} />
    </SidebarProvider>,
  );
  const header = container.querySelector('header');
  if (!header) throw new Error('no header element: the harness did not mount the real renderer');
  return header;
}

function classesOf(header: HTMLElement): string[] {
  return (header.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

describe('ui:header-bar merges the authored className onto its root (objectui#10397)', () => {
  it('harness: the real header mounts, with its sidebar trigger inside it', () => {
    const header = headerFor({});
    expect(header.querySelector('[data-sidebar="trigger"]')).not.toBeNull();
  });

  it('an authored class reaches the root, beside every default class', () => {
    const classes = classesOf(headerFor({ className: AUTHORED }));
    expect(classes).toContain(AUTHORED);
    expect(classes).toEqual([...PRE_REPAIR_ROOT_CLASS.split(' '), AUTHORED]);
  });

  it('the authored class appears ONCE: one channel is read, not the schema and the prop both', () => {
    // `SchemaRenderer` hands the component the node's className on `schema` AND
    // as the `className` prop. tailwind-merge does not collapse a repeated
    // non-Tailwind class, so a renderer reading both prints it twice.
    const classes = classesOf(headerFor({ className: AUTHORED }));
    expect(classes.filter((c) => c === AUTHORED)).toHaveLength(1);
  });

  it('a conflicting authored utility wins: `h-20` replaces `h-14`', () => {
    const classes = classesOf(headerFor({ className: 'h-20' }));
    expect(classes).toContain('h-20');
    expect(classes).not.toContain('h-14');
    // Per variant, not per property: the `sm:` height is a different utility
    // and stays, which is what the docs page tells an author.
    expect(classes).toContain('sm:h-16');
  });

  it('an authored `sm:` utility replaces the `sm:` default too', () => {
    const classes = classesOf(headerFor({ className: 'h-20 sm:h-20' }));
    expect(classes).toEqual(expect.arrayContaining(['h-20', 'sm:h-20']));
    expect(classes).not.toContain('h-14');
    expect(classes).not.toContain('sm:h-16');
  });

  it('a `responsiveStyles` scope class rides the same channel and reaches the root', () => {
    // `SchemaRenderer` compiles a node's `responsiveStyles` to CSS scoped to a
    // class it appends to the node's className. Before the repair that class
    // never reached this root either, so the compiled rules matched nothing.
    const classes = classesOf(
      headerFor({ id: 'hb-10397', responsiveStyles: { large: { color: 'red' } } }),
    );
    expect(classes).toContain(scopeClassFor('hb-10397'));
  });

  it('control: without className the root class is exactly what it was before the repair, beside `data-obj-type` only', () => {
    const header = headerFor({});
    expect(header.getAttribute('class')).toBe(PRE_REPAIR_ROOT_CLASS);
    // Was exactly `['class']` until objectui#10496 routed the root's props
    // through `toDomProps`. `SchemaRenderer` hands every component
    // `data-obj-type` unconditionally, and the whitelist forwards the open
    // `data-*` family, so it is the one attribute that joins on an unauthored
    // node. The other channels it now forwards (`id`, `data-obj-id`,
    // `aria-label`, `data-testid`, `style`) arrive only when authored, and are
    // pinned in `header-bar-root-dom-props-10496.test.tsx`. Sorted, because
    // the order React sets attributes in is not the contract.
    expect([...header.getAttributeNames()].sort()).toEqual(['class', 'data-obj-type']);
    expect(header.getAttribute('data-obj-type')).toBe('header-bar');
  });
});
