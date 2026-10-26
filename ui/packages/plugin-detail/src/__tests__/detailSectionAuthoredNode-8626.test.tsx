/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8626 — an authored `detail-section` node RENDERS the eight inputs
 * its registration declares.
 *
 * ## What was broken, measured rather than read
 *
 * The registration declares eight FLAT inputs; `DetailSection` declares a
 * single `section` OBJECT prop and reads `section.*` only. `SchemaRenderer`
 * spreads a node's non-metadata keys as React props, so `section` arrived
 * `undefined`.
 *
 * Rendering an authored node through the real `SchemaRenderer` and the real
 * registry on `b775500af` produced, verbatim:
 *
 *   Component "detail-section" failed to render
 *   Cannot read properties of undefined (reading 'defaultCollapsed')
 *
 * i.e. `SchemaErrorBoundary`'s banner in place of the block — worse than
 * inert, and the half the card flagged as "a reading and not an execution".
 * `errorBannerAbsent()` below is that exact face, asserted absent.
 *
 * ## Why each row is a RENDERING verdict
 *
 * Every declared input is measured by a consequence in the DOM — the text an
 * author sees, the column track the grid gets, the tint class the header
 * carries. Deliberately NOT "the prop was passed" and NOT "the registration
 * declares eight inputs": both pass on a component that reads none of them,
 * which is precisely the defect. Each class-shaped row carries its own
 * negative (`grid-cols-1` without `md:grid-cols-2`, `bg-muted` without
 * `bg-accent`) so it is a verdict and not a substring that was always there.
 *
 * ## The two guards beside the rendering rows
 *
 * - FOLD PARITY. The fold set and the registration's declared input names are
 *   compared in BOTH directions. A ninth input declared without a fold is the
 *   original defect in miniature — inert, silent — and reds here instead.
 * - THE DECLARED SURFACE DID NOT MOVE. The flat eight still draw ZERO
 *   diagnostics from a manifest built the way `page.tsx` builds the JSX-page
 *   compiler's, and the nested `section` shape is still REFUSED by it. That is
 *   the control on the repair NOT taken: this card folds at the seam, and does
 *   not re-declare the surface authors already write.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { DETAIL_SECTION_NODE_INPUTS } from '../DetailSectionNode';

// Module scope, not a hook (AGENTS.md 测试纪律): importing the package index
// executes its registration side-effects, so the entry under test is the very
// one production resolves.
import '../index';

const TAG = 'detail-section';
const NAMESPACE = 'plugin-detail';

/** The node an author writes, carrying all eight declared inputs, flat. */
const authoredNode = (overrides: Record<string, unknown> = {}) =>
  ({
    type: TAG,
    title: 'Billing Address',
    description: 'Where invoices go',
    collapsible: true,
    defaultCollapsed: false,
    columns: 2,
    showBorder: true,
    headerColor: 'muted',
    fields: [
      { name: 'street', label: 'Street' },
      { name: 'city', label: 'City' },
    ],
    ...overrides,
  }) as never;

const RECORD = { street: '1 Market St', city: 'San Francisco' };

const renderAuthored = (overrides: Record<string, unknown> = {}) =>
  render(<SchemaRenderer schema={authoredNode(overrides)} data={RECORD} />);

/**
 * `SchemaErrorBoundary`'s face, asserted absent. Its copy is
 * `Component "<type>" failed to render`, so a future refactor that reintroduces
 * the throw lands here rather than on a subtler row.
 */
const errorBannerAbsent = () => {
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(/failed to render/i)).toBeNull();
};

afterEach(() => {
  cleanup();
});

describe('objectui#8626 — an authored detail-section node renders its declared inputs', () => {
  it('renders its authored TITLE, DESCRIPTION and FIELDS instead of an error banner', () => {
    const { container } = renderAuthored();

    errorBannerAbsent();
    expect(screen.getByText('Billing Address')).toBeInTheDocument();
    expect(screen.getByText('Where invoices go')).toBeInTheDocument();
    // `fields` — both labels AND both values off the bound record, so the
    // array reached the component as a section rather than as a lost prop.
    expect(screen.getByText('Street')).toBeInTheDocument();
    expect(screen.getByText('City')).toBeInTheDocument();
    expect(screen.getByText('1 Market St')).toBeInTheDocument();
    expect(screen.getByText('San Francisco')).toBeInTheDocument();
    // Non-vacuity: the block rendered real chrome, not an empty container.
    expect(container.innerHTML.length).toBeGreaterThan(500);
  });

  it('honours `columns` as the grid track count', () => {
    const { container } = renderAuthored({ columns: 2 });
    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain('md:grid-cols-2');
    // Control: a one-column authoring of the SAME node does not carry it.
    cleanup();
    const single = renderAuthored({ columns: 1 }).container.querySelector('.grid');
    expect(single).not.toBeNull();
    expect(single!.className).not.toContain('md:grid-cols-2');
  });

  it('honours `headerColor` as the header tint class', () => {
    const { container } = renderAuthored({ headerColor: 'muted' });
    const header = container.querySelector('.bg-muted');
    expect(header).not.toBeNull();
    // Control: the tint is the authored one, not any tint the chrome happens
    // to carry.
    expect(container.querySelector('.bg-accent')).toBeNull();
    cleanup();
    const accent = renderAuthored({ headerColor: 'accent' }).container;
    expect(accent.querySelector('.bg-accent')).not.toBeNull();
  });

  /**
   * Authored `collapsible: false` ON PURPOSE, so this row stays a reading
   * about the FOLD — that `showBorder` reaches `DetailSection` at all — and
   * not about which branch consumes it.
   *
   * It originally carried a second reason: `DetailSection`'s collapsible
   * branch rendered a bare `<Card>` and never read `section.showBorder`, so
   * only the non-collapsible branch honoured the key. That was a separate,
   * pre-existing bug in the component this card deliberately leaves
   * byte-identical; it was filed rather than repaired here, and objectui#9218
   * has since closed it. The branch axis now lives where it belongs, in
   * `DetailSection.collapsibleShowBorder-9218.test.tsx`.
   */
  it('honours `showBorder: false` by dropping the card border', () => {
    const bordered = renderAuthored({ collapsible: false, showBorder: true }).container;
    expect(bordered.querySelector('.border-none')).toBeNull();
    cleanup();
    const borderless = renderAuthored({ collapsible: false, showBorder: false }).container;
    expect(borderless.querySelector('.border-none')).not.toBeNull();
  });

  it('honours `collapsible` + `defaultCollapsed` as the initial disclosure state', () => {
    const open = renderAuthored({ collapsible: true, defaultCollapsed: false }).container;
    expect(open.querySelector('[aria-expanded="true"]')).not.toBeNull();
    cleanup();
    const collapsed = renderAuthored({ collapsible: true, defaultCollapsed: true }).container;
    expect(collapsed.querySelector('[aria-expanded="false"]')).not.toBeNull();
    // The value rows are not on screen while collapsed — the read that used to
    // THROW is now the one deciding this.
    expect(screen.queryByText('1 Market St')).toBeNull();
  });

  /**
   * DRIFT GUARD, not the pin. The rows above are the pin; this one keeps a
   * ninth declared input from arriving inert the way all eight once did.
   */
  it('folds exactly the inputs the registration declares, in both directions', () => {
    const declared = (
      (ComponentRegistry.getConfig(TAG, NAMESPACE) as unknown as {
        inputs?: Array<{ name: string }>;
      })?.inputs ?? []
    ).map((i) => i.name);
    // Non-vacuity: an empty read (wrong tag/namespace) must fail here.
    expect(declared.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...DETAIL_SECTION_NODE_INPUTS].sort());
  });

  /**
   * CONTROL on the repair NOT taken. Built the way
   * `packages/components/src/renderers/layout/page.tsx` builds the JSX-page
   * compiler's manifest — from the live registry — so these are the verdicts a
   * real author gets.
   */
  it('leaves the published authoring surface where authors already write it', () => {
    const manifest = manifestFromConfigs(
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

    // The flat eight: clean.
    expect(validateTree(authoredNode(), manifest).diagnostics).toEqual([]);

    // The nested shape: still refused, so this repair did not quietly open a
    // second dialect for the same block.
    const nested = validateTree(
      { type: TAG, section: { title: 'x', fields: [{ name: 'street' }] } } as never,
      manifest,
    ).diagnostics;
    expect(nested.map((d) => d.code).sort()).toEqual(['missing-required-prop', 'unknown-prop']);
  });
});
