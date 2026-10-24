/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10859 batch 8, phase 2d — the `sidebar` node supplies its own
 * `SidebarProvider` only when none is above it, and honours the spec's boolean
 * `collapsible` (the seat's fork ruling, "Fork 3").
 *
 * Measured through the real `SchemaRenderer`, in both host shapes the ruling
 * names:
 *
 *  1. A BARE host (no provider). Before this phase shadcn's `Sidebar` threw
 *     "useSidebar must be used within a SidebarProvider." there, and the only
 *     authored provider was the `sidebar-provider` primitive this phase
 *     retires. Now the node mounts exactly one provider of its own.
 *  2. A host WITH a provider (the app shell mounts one through `AppShell`; the
 *     docs site's demo hosts mount one with `defaultOpen={false}`). The host's
 *     provider must never be shadowed: there is still exactly one provider in
 *     the tree, and the HOST's open state drives the node.
 *
 * A provider is counted by its wrapper, the `group/sidebar-wrapper` element
 * `SidebarProvider` renders around its children; the node's own state is read
 * off the `data-state` its desktop form carries.
 *
 * `collapsible` is the spec's boolean (`SidebarSchema.collapsible`): `false` →
 * shadcn's in-flow, not-collapsible form; `true` or absent → the default the
 * renderer applied before (`offcanvas`). Before this phase the boolean reached
 * the DOM verbatim as `data-collapsible="true"`, which no rule matches.
 *
 * Each node rendered here is also validated on both validator faces,
 * because the ruling measures the taught node "by a render AND by
 * `objectui validate`".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import { safeValidateSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';
import { SidebarProvider } from '../../ui';
import '../../renderers';

afterEach(cleanup);

const ITEMS = [
  { type: 'text', content: 'Dashboard' },
  { type: 'text', content: 'Settings' },
];

const providers = (c: HTMLElement) => c.querySelectorAll('[class*="group/sidebar-wrapper"]').length;
const sidebarState = (c: HTMLElement) =>
  c.querySelector('[data-state][data-collapsible]')?.getAttribute('data-state') ?? null;
const collapsibleAttr = (c: HTMLElement) =>
  c.querySelector('[data-state][data-collapsible]')?.getAttribute('data-collapsible') ?? null;

const validates = (node: unknown) => ({
  tolerant: safeValidateSchema(node).success,
  strict: (StrictAnyComponentSchema as { safeParse: (v: unknown) => { success: boolean } }).safeParse(node).success,
});

describe('a bare host: the sidebar node mounts its own provider (objectui#10859 batch 8)', () => {
  it('draws the in-flow form for `collapsible: false`, inside exactly one provider', () => {
    const node = { type: 'sidebar', collapsible: false, children: ITEMS };
    const { container } = render(<SchemaRenderer schema={node as never} />);

    expect(container.textContent).toContain('Dashboard');
    expect(container.textContent).toContain('Settings');
    expect(container.textContent).not.toContain('failed to render');
    expect(providers(container)).toBe(1);
    // The in-flow form: no desktop peer element, no viewport-fixed container.
    expect(container.querySelector('[data-collapsible]')).toBeNull();
    expect(container.querySelector('.fixed')).toBeNull();
    expect(validates(node)).toEqual({ tolerant: true, strict: true });
  });

  it('keeps the default collapsible form when `collapsible` is omitted, expanded by its own provider', () => {
    const node = { type: 'sidebar', children: ITEMS };
    const { container } = render(<SchemaRenderer schema={node as never} />);

    expect(container.textContent).toContain('Dashboard');
    expect(providers(container)).toBe(1);
    expect(sidebarState(container)).toBe('expanded');
    expect(collapsibleAttr(container)).toBe('offcanvas');
    expect(validates(node)).toEqual({ tolerant: true, strict: true });
  });
});

describe('a host with a provider is never shadowed (objectui#10859 batch 8)', () => {
  const inHost = (open: boolean, node: unknown) => (
    <SidebarProvider open={open} onOpenChange={() => {}} className="min-h-0 w-full">
      <SchemaRenderer schema={node as never} />
    </SidebarProvider>
  );

  it("keeps exactly one provider, and the HOST's open state drives the node", () => {
    const node = { type: 'sidebar', children: ITEMS };
    const { container, rerender } = render(inHost(false, node));

    expect(container.textContent).toContain('Dashboard');
    expect(providers(container)).toBe(1);
    expect(sidebarState(container)).toBe('collapsed');

    rerender(inHost(true, node));
    expect(providers(container)).toBe(1);
    expect(sidebarState(container)).toBe('expanded');
  });

  it('draws the in-flow form for `collapsible: false` under the host provider too', () => {
    const node = { type: 'sidebar', collapsible: false, children: ITEMS };
    const { container } = render(inHost(false, node));

    expect(container.textContent).toContain('Settings');
    expect(providers(container)).toBe(1);
    expect(container.querySelector('[data-collapsible]')).toBeNull();
  });
});

describe('`collapsible` is the spec boolean, and the renderer honours it (objectui#10859 batch 8)', () => {
  it.each([
    // [authored value, data-collapsible on the desktop form, or null for the in-flow form]
    [false, null],
    [true, 'offcanvas'],
    [undefined, 'offcanvas'],
  ] as const)('`collapsible: %s` → data-collapsible %s', (collapsible, expected) => {
    const node = { type: 'sidebar', children: ITEMS, ...(collapsible === undefined ? {} : { collapsible }) };
    const { container } = render(<SchemaRenderer schema={node as never} />);
    // Drawn first: a node that rendered nothing has no `data-collapsible`
    // either, which would read as the in-flow `null` below.
    expect(container.textContent).toContain('Dashboard');
    expect(providers(container)).toBe(1);
    expect(collapsibleAttr(container)).toBe(expected);
    // Never the verbatim boolean the renderer used to forward.
    expect(container.querySelector('[data-collapsible="true"], [data-collapsible="false"]')).toBeNull();
    expect(validates(node)).toEqual({ tolerant: true, strict: true });
  });
});
