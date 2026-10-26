/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are partial stubs carrying only the members the path under test calls;
 * completing them would change which capability probes fire, and so would
 * change what these tests measure.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

/**
 * What an off-spec `rowHeight` actually RENDERS — the empirical half of
 * objectui#4440, pinned on the live path rather than argued from the mapping.
 *
 * `ListView` is the only in-repo caller of `@object-ui/core`'s
 * `rowHeightToDensityMode`. Before #4440 that function coerced an unknown
 * `rowHeight` to `'comfortable'`, so a garbage value rendered the toolbar (and
 * the rows it forwards its density to) one step looser than an ABSENT
 * `rowHeight` did — absent has always resolved to `'compact'` here, and
 * `ObjectGrid` independently defaults `schema.rowHeight ?? 'compact'` too.
 *
 * After #4440 the mapping abstains and the caller's own "nothing was said"
 * default applies, so off-spec renders exactly like absent. That is the
 * measured consequence of aligning with `@object-ui/react`'s spec bridge, and
 * this file is where it is visible: the density button's `aria-label` is
 * `density.mode` verbatim.
 *
 * Note the abstain deliberately does NOT fall through to `useDensityMode`'s own
 * parameter default, which is `'comfortable'` — landing there would have
 * re-created the retired coercion one stack frame further down and left the two
 * surfaces disagreeing exactly as before, while looking like a fix.
 */

const mockDataSource = {
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const renderListView = (rowHeight?: unknown) => {
  const schema = {
    type: 'list-view',
    objectName: 'contacts',
    viewType: 'grid',
    columns: ['name', 'email'],
    ...(rowHeight === undefined ? {} : { rowHeight }),
  } as ListViewSchema;

  return render(
    <SchemaRendererProvider dataSource={mockDataSource as unknown as DataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema }} />
    </SchemaRendererProvider>,
  );
};

/** The toolbar's density button labels itself `Density: <mode>`. */
const renderedDensity = () =>
  screen
    .getByRole('button', { name: /^Density: / })
    .getAttribute('aria-label')
    ?.replace('Density: ', '');

describe('ListView density for an off-spec rowHeight (#4440)', () => {
  describe('spec row heights — controls, unaffected by the change', () => {
    it.each([
      ['compact', 'Compact'],
      ['short', 'Compact'],
      ['medium', 'Comfortable'],
      ['tall', 'Spacious'],
      ['extra_tall', 'Spacious'],
    ])('renders %s as %s', (rowHeight, expected) => {
      renderListView(rowHeight);
      expect(renderedDensity()).toBe(expected);
    });

    it('renders an absent rowHeight as Compact', () => {
      renderListView(undefined);
      expect(renderedDensity()).toBe('Compact');
    });
  });

  describe('off-spec rowHeight renders exactly like an absent one', () => {
    // Every one of these rendered `Comfortable` before #4440. No authored
    // metadata in objectui, objectstack or the surveyed downstream app spells
    // any of them (the PR #4439 sweep, re-run for objectui and objectstack),
    // so this is the rendered consequence of a value that does not exist —
    // documented because it was measured, not because it was reachable.
    it.each(['comfortable', 'spacious', 'small', 'large', 'gargantuan'])(
      'renders the off-spec rowHeight %s as Compact',
      (rowHeight) => {
        renderListView(rowHeight);
        expect(renderedDensity()).toBe('Compact');
      },
    );

    it('renders a non-string rowHeight as Compact', () => {
      // Stored view definitions cross an untyped boundary
      // (`ObjectView`: `viewDef.rowHeight ?? listSchema.rowHeight`), so the
      // value is only statically a `RowHeight`.
      renderListView(42);
      expect(renderedDensity()).toBe('Compact');
    });
  });
});
