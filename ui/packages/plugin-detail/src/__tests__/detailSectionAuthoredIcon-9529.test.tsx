/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9529 — an authored `icon` on a `detail-section` node VALIDATES and
 * RENDERS.
 *
 * ## The gap
 *
 * `DetailSection` renders `section.icon` in both of its header branches, but
 * the `detail-section` registration did not declare `icon` among its `inputs`,
 * and `DetailSectionNode` folds only the declared names into the `section` it
 * hands the component. So an author who wrote `icon` on the node met both
 * halves of one gap:
 *
 *  - the JSX-page compiler's validator (a manifest built from
 *    `getKnownTypes()` plus these `inputs`, the way
 *    `packages/components/src/renderers/layout/page.tsx` builds it) warned
 *    `unknown-prop "icon"` — steering the author away from a key the renderer
 *    honours; and
 *  - the fold left `icon` out of `section`, so the header rendered no icon.
 *
 * The ruling on the card (director seat, maintainer-agreed) declares the key:
 * `{ name: 'icon', type: 'string' }` on the registration and in
 * `DETAIL_SECTION_NODE_INPUTS`.
 *
 * ## What each row reads, and why it is a verdict
 *
 * - VALIDATES — the node with an authored `icon` draws ZERO diagnostics from
 *   the live manifest. The declared TYPE is read through the same judge: a
 *   non-string `icon` draws `type-mismatch` naming the key, which only a
 *   declared `string` input can produce (an undeclared key draws
 *   `unknown-prop` instead).
 * - THE CONTROL IS LIT — `iconName`, a near-miss this block neither declares
 *   nor reads, still draws `unknown-prop` from the same manifest in the same
 *   run. A silenced validator would pass the rows above vacuously; it cannot
 *   pass this one. The two `DetailViewSection` members the block leaves out
 *   cannot serve: `visible` is one of the validator's base node keys
 *   (`BASE_PROPS` in `sdui-parser`'s `validate.ts`), which every node may carry
 *   and which are never judged against `inputs`, and `name` (the control until
 *   objectui#11044) is a base prop wherever a type does not declare it.
 * - RENDERS — measured in the DOM through the real `SchemaRenderer` and the
 *   real registry, in BOTH header branches `DetailSection` reads the key in:
 *   the authored Lucide name is drawn as that icon's glyph beside the
 *   authored title, and the same node without `icon` draws nothing there.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// The reference glyph the render rows compare against, imported at module
// scope rather than in a hook (see the test-discipline section of AGENTS.md):
// `LazyIcon` draws `map-pin` through lucide's `DynamicIcon`, which fetches the
// icon module with a lazy `import()`, and lucide's ESM entry re-exports
// `MapPin` from that same icon module.
import { MapPin } from 'lucide-react';

// Module scope, not a hook (same section of AGENTS.md): importing the package index
// executes its registration side-effects, so the entry under test is the very
// one production resolves.
import '../index';

const TAG = 'detail-section';
const TITLE = 'Billing Address';

/** A minimal authored node: the one required input plus a title to anchor on. */
const authoredNode = (overrides: Record<string, unknown> = {}) =>
  ({
    type: TAG,
    title: TITLE,
    fields: [{ name: 'street', label: 'Street' }],
    ...overrides,
  }) as never;

const RECORD = { street: '1 Market St' };

/** Built the way `page.tsx` builds the JSX-page compiler's manifest. */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return {
        type,
        namespace: meta?.namespace,
        isContainer: meta?.isContainer,
        inputs: meta?.inputs,
      };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const diagnose = (overrides: Record<string, unknown>) =>
  validateTree(authoredNode(overrides), liveManifest()).diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
  }));

/** The row the header's title sits in — where `DetailSection` puts the icon. */
const titleRow = () => {
  const row = screen.getByText(TITLE).parentElement;
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

afterEach(() => {
  cleanup();
});

describe('objectui#9529 — an authored detail-section icon validates', () => {
  it('draws no diagnostic for an authored string icon', () => {
    expect(diagnose({ icon: 'map-pin' })).toEqual([]);
  });

  it('judges the authored icon as a declared STRING input', () => {
    const found = diagnose({ icon: 42 });
    expect(found.map((d) => d.code)).toEqual(['type-mismatch']);
    expect(found[0].message).toContain('"icon"');
  });

  it('CONTROL: still warns on iconName, which the block neither declares nor reads', () => {
    const found = diagnose({ iconName: 'map-pin' });
    expect(found.map((d) => d.code)).toEqual(['unknown-prop']);
    expect(found[0].message).toContain('"iconName"');
  });
});

describe('objectui#9529 — an authored detail-section icon renders', () => {
  // Both header branches read `section.icon`, so both are measured. The
  // verdict is the GLYPH: the drawn svg's markup must equal `MapPin`'s, which
  // the `Database` glyph `LazyIcon` draws while loading (and for an unknown
  // name) can never satisfy.
  for (const collapsible of [false, true]) {
    it(`draws the authored Lucide icon before the title (collapsible: ${collapsible})`, async () => {
      const expected = render(<MapPin />).container.querySelector('svg')?.innerHTML ?? '';
      expect(expected.length).toBeGreaterThan(0);
      cleanup();

      render(
        <SchemaRenderer schema={authoredNode({ collapsible, icon: 'map-pin' })} data={RECORD} />,
      );
      await waitFor(() => {
        expect(titleRow().querySelector('svg')?.innerHTML).toBe(expected);
      });

      // Control: the same node without `icon` draws nothing beside its title.
      cleanup();
      render(<SchemaRenderer schema={authoredNode({ collapsible })} data={RECORD} />);
      expect(titleRow().querySelector('svg')).toBeNull();
      expect(titleRow().textContent).toBe(TITLE);
    });
  }
});
