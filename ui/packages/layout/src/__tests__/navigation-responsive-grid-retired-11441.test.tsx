/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `navigation-renderer` and `responsive-grid` node keys are RETIRED
 * (objectui#11441, the maintainer's ruling `5950208338`, letters B / B, executed
 * as an objectui#10859 batch), and the two components they served stay
 * exports.
 *
 * Until that card, `navigation-renderer-items-declaration.test.tsx` pinned the
 * `navigation-renderer` registration's declaration: `items` as an array
 * (objectui#3972) and as required (objectui#3987), with the render crash that
 * made `required` a crash-stopper. The manifest half of the same pins sat in
 * `examples/schema-catalog/test/pageheader-with-actions.test.tsx`, with
 * `responsive-grid` as the all-optional control. With both registrations gone
 * there is no declaration left to judge, so those describes went with them; the
 * manifest half of this retirement now sits in that same schema-catalog file.
 *
 * What is pinned here, each a different fact:
 *   - the SOURCE and the LIVE registry agree: `registerLayout()` has no register
 *     call for either key, and nothing loaded claims either spelling. The lit
 *     control is `app-schema-renderer`, the layout key it still publishes under
 *     both spellings, and the whole-shell door navigation now goes through;
 *   - the refusal an author SEES: a node of either key renders the OBJUI-001
 *     "Unknown component type" panel, with a registered layout key rendered the
 *     same way as the control, because "no panel appeared" passes just as
 *     happily on a probe that cannot tell the two apart;
 *   - the components stay: `NavigationRenderer` is still exported (the console's
 *     `UnifiedSidebar` and `AppSchemaRenderer` mount it), and `ResponsiveGrid`
 *     still turns a `BreakpointColumnMap` into grid classes, as a React-only
 *     export now.
 *
 * The absence keys are literals on purpose: `scripts/__tests__/
 * unit-registry-absence-collision.test.ts` resolves a registry-absence key
 * statically and pins the sites it cannot.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// The two retired keys are refused on purpose, and the control is
// `@object-ui/layout`'s own namespaced registration; no `@object-ui/types`
// declaration names any of them, so each crosses through the one test helper for
// undeclared input (objectui#11466).
import { undeclaredNode } from '@object-ui/test-support';

// The shared registration reader (objectui#4894). Plain JS, and this package's
// test program sets `allowJs: false`, so the import is untyped here.
// @ts-expect-error — plain-JS shared helper, intentionally untyped
import { readComponentRegistrations } from '../../../../scripts/component-registrations.mjs';

import { registerLayout, NavigationRenderer, ResponsiveGrid } from '../index';

/** Repo root — four levels up from `packages/layout/src/__tests__`. */
const REPO_ROOT = resolve(__dirname, '../../../..');
const LAYOUT_INDEX_SRC = readFileSync(join(REPO_ROOT, 'packages', 'layout', 'src', 'index.ts'), 'utf8');

const registeredKeys = (): string[] =>
  readComponentRegistrations(LAYOUT_INDEX_SRC, 'packages/layout/src/index.ts').keys;

beforeAll(() => {
  // The barrel registers on evaluation; say so explicitly, so an import-order
  // accident is not what makes the absences below true.
  registerLayout();
});

describe('the `navigation-renderer` and `responsive-grid` registrations are retired (objectui#11441)', () => {
  it('src/index.ts registers neither key, and still registers `app-schema-renderer`', () => {
    const keys = registeredKeys();
    // Lit control: the read found the registrations that remain.
    expect(keys).toContain('app-schema-renderer');
    expect(keys).not.toContain('navigation-renderer');
    expect(keys).not.toContain('responsive-grid');
  });

  it('the loaded registry claims neither spelling of either key', () => {
    // Lit control first: a key `registerLayout()` still publishes, both spellings.
    expect(ComponentRegistry.getConfig('app-schema-renderer')).toBeTruthy();
    expect(ComponentRegistry.getConfig('app-schema-renderer', 'layout')).toBeTruthy();
    expect(ComponentRegistry.getConfig('navigation-renderer')).toBeUndefined();
    expect(ComponentRegistry.getConfig('navigation-renderer', 'layout')).toBeUndefined();
    expect(ComponentRegistry.has('layout:navigation-renderer')).toBe(false);
    expect(ComponentRegistry.getConfig('responsive-grid')).toBeUndefined();
    expect(ComponentRegistry.getConfig('responsive-grid', 'layout')).toBeUndefined();
    expect(ComponentRegistry.has('layout:responsive-grid')).toBe(false);
  });
});

describe('a node of either retired key renders the "Unknown component type" panel (objectui#11441)', () => {
  it('`navigation-renderer` is refused by name', () => {
    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'navigation-renderer', items: [] })} />);
    const panel = container.querySelector('[role="alert"]');
    expect(panel, 'a `navigation-renderer` node rendered something other than the unknown-type panel').not.toBeNull();
    expect(panel?.textContent).toContain('Unknown component type: navigation-renderer');
    expect(panel?.textContent).toContain('OBJUI-001');
  });

  it('`responsive-grid` is refused by name', () => {
    const { container } = render(
      <SchemaRenderer schema={undeclaredNode({ type: 'responsive-grid', columns: { xs: 1, md: 2 }, children: [] })} />,
    );
    const panel = container.querySelector('[role="alert"]');
    expect(panel, 'a `responsive-grid` node rendered something other than the unknown-type panel').not.toBeNull();
    expect(panel?.textContent).toContain('Unknown component type: responsive-grid');
    expect(panel?.textContent).toContain('OBJUI-001');
  });

  it('and the probe can tell a registered layout key apart — `layout:page:card` renders', () => {
    // The control: without it, the two rows above would pass on a renderer that
    // panels EVERY node.
    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'layout:page:card' })} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('Unknown component type');
  });
});

describe('the components stay exported (objectui#11441)', () => {
  it('`NavigationRenderer` is still a function export', () => {
    expect(typeof NavigationRenderer).toBe('function');
  });

  it('`ResponsiveGrid` still turns a `BreakpointColumnMap` into grid classes', () => {
    const { container } = render(
      <ResponsiveGrid columns={{ xs: 1, md: 2, lg: 4 }} gap={2}>
        <span>cell</span>
      </ResponsiveGrid>,
    );
    const grid = container.firstElementChild as HTMLElement | null;
    expect(grid?.className).toContain('grid-cols-1');
    expect(grid?.className).toContain('md:grid-cols-2');
    expect(grid?.className).toContain('lg:grid-cols-4');
    expect(grid?.className).toContain('gap-2');
    expect(grid?.textContent).toBe('cell');
  });
});
