/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 12 — the gallery capability gate asked the `options` bag
 * for the LEGACY cover spelling only.
 *
 * `availableViews` resolved gallery from three rungs: `schema.gallery`'s two
 * spellings, and `schema.options.gallery.imageField`. There was no canonical
 * rung for the bag, so a bag binding its cover under the spec's `coverField`
 * rendered a gallery (`ObjectGallery` reads the nested `coverField` first) that
 * the switcher never offered. The same shape as objectui#8193 for kanban.
 *
 * It became reachable in the same round: app-shell's `galleryViewOptions` now
 * writes `coverField` alone (the legacy `imageField` is refused by name in the
 * bag `@object-ui/types` judges). Measured before the rung existed, on
 * objectui#6152 (report 6070437445): a `{ coverField }` bag was not offered, the
 * `{ imageField, coverField }` bag was, and a top-level `gallery.coverField` was.
 *
 * ⛔ NO ALIAS READ WAS REMOVED by round 12. Stored metadata written before the
 * view write door judged the bag may still carry `imageField`, and the readers'
 * retirement was its own round: objectui#6152 round 14 removed the alias rungs,
 * and the legacy-bag CONTROL below was re-judged into a refusal arm then.
 *
 * objectstack#25923 retired the bag: a stored `options.gallery` is folded onto
 * the view's `gallery` block by the server before the row is served, and the
 * gate reads the block alone. So the arms below are the same bindings written
 * where they live now, the top-level `gallery` block (renamed from
 * `ListView.galleryOptionsBagCanonical-6152`), plus one arm pinning that a bag
 * no longer resolves the capability.
 *
 * Both directions are pinned: the canonical arms answer YES, and the arms at
 * the bottom answer NO for a block with no cover binding, so the rung cannot
 * degrade into "offer the gallery whenever it is whitelisted".
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'deal', fields: {} }),
});

// `viewType: 'grid'` on purpose: the gate's "always allow switching back to the
// schema's own viewType" rung would otherwise resolve gallery for a reason that
// has nothing to do with the binding under test.
const BASE = {
  type: 'list-view',
  objectName: 'deal',
  viewType: 'grid',
  columns: ['name'],
} as const;

const renderSwitcher = (view: Record<string, unknown>) => {
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      {/* `as never`: some arms carry the legacy `imageField`, which the typed
          block refuses by name, or the retired `options` bag; this file pins
          how the gate answers for them. */}
      <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, ...view } as never} dataSource={dataSource} showViewSwitcher />
    </SchemaRendererProvider>,
  );
  const trigger = screen.queryByTestId('view-switcher-dropdown');
  if (trigger) fireEvent.click(trigger);
};

/** Mirrors the helper in `ListView.kanbanBlockCanonical-8193.test.tsx`. */
const queryViewOption = (name: string) =>
  screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

/** Is `gallery` offered for a view whitelisting exactly `['grid', 'gallery']`? */
const galleryOffered = (view: Record<string, unknown>) => {
  renderSwitcher({ appearance: { allowedVisualizations: ['grid', 'gallery'] }, ...view });
  return Boolean(queryViewOption('Gallery'));
};

describe('the capability gate resolves gallery from the CANONICAL key of the `gallery` block (objectui#6152 round 12, objectstack#25923)', () => {
  // THE DISCRIMINATING ARM of round 12, written where the binding lives now.
  it('offers Gallery for `gallery.coverField`', () => {
    expect(galleryOffered({ gallery: { coverField: 'logo' } })).toBe(true);
  });

  it('offers Gallery for the block app-shell\'s ObjectView now writes', () => {
    // ⛔ One `galleryOffered` per test: it renders into the shared screen.
    expect(galleryOffered({ gallery: { coverField: 'logo', titleField: 'name' } })).toBe(true);
  });

  it('does NOT offer Gallery for the retired LEGACY `gallery.imageField` (objectui#6152 round 14)', () => {
    // Round 12's CONTROL here proved its change ADDED a rung. Round 14 retired
    // the alias rung itself: a stored `imageField` binds no cover, so the gate
    // must not offer a gallery for it.
    expect(galleryOffered({ gallery: { imageField: 'logo' } })).toBe(false);
  });

  it('RETIRED (objectstack#25923): does NOT offer Gallery for a cover bound in the legacy `options.gallery` bag', () => {
    // The bag was this file's subject. It is folded onto `gallery` before a
    // stored row is served, so one that still reaches the gate binds nothing.
    expect(galleryOffered({ options: { gallery: { coverField: 'logo' } } })).toBe(false);
  });

  // THE OTHER HALF.
  it('does NOT offer Gallery with no gallery block anywhere', () => {
    expect(galleryOffered({})).toBe(false);
  });

  it('does NOT offer Gallery for a gallery block carrying no cover binding', () => {
    expect(galleryOffered({ gallery: { titleField: 'name' } })).toBe(false);
  });

  it('does NOT offer Gallery for an empty gallery block', () => {
    expect(galleryOffered({ gallery: {} })).toBe(false);
  });
});
