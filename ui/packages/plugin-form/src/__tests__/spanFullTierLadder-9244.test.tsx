/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9244, the cross-layer leg: an AUTHORED `span: 'full'` all the way
 * to the class on the grid cell.
 *
 * ⭐ WHY THIS FILE EXISTS SEPARATELY FROM `autoLayout.test.ts`. That suite
 * already carries, verbatim:
 *
 *   it("span: 'full' spans the whole row at any grid width")
 *
 * and it passes — honestly, because `resolveColSpan` really does return the
 * full grid count. It is the layer BELOW the claim its name makes. The claim
 * is about what renders, `resolveColSpan` only produces a number, and until
 * objectui#9244 nothing joined the two. So this file asserts nothing about
 * return values: it runs the real layout helper, hands the result to the real
 * form renderer, and reads the rendered `className`.
 *
 * The narrow pin on the emission itself is
 * `components/src/renderers/form/__tests__/form-span-tier-ladder-9244.test.tsx`.
 * This one covers what that one structurally cannot: that the number
 * `resolveColSpan` chooses and the container class `containerGridColsFor`
 * chooses still describe the same grid by the time they meet.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { FormField } from '@object-ui/types';
import '@object-ui/components';
import { CONTAINER_GRID_COLS, sectionFormLayout } from '../autoLayout';

afterEach(() => cleanup());

/**
 * Author one `span: 'full'` field beside plain ones in a `columns`-wide
 * section, run it through the layout helper the section variants all use, and
 * return the span classes the renderer put on that field's grid cell.
 */
function renderAuthoredSection(columns: number): string[] {
  cleanup();
  const fields = [
    { name: 'summary', label: 'Summary', type: 'input', span: 'full' },
    { name: 'owner', label: 'Owner', type: 'input' },
    { name: 'stage', label: 'Stage', type: 'input' },
    { name: 'amount', label: 'Amount', type: 'input' },
  ] as unknown as FormField[];

  const laidOut = sectionFormLayout(fields, columns);
  const Form = ComponentRegistry.get('form')!;
  render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        fields: laidOut.fields,
        columns: laidOut.columns,
        ...(laidOut.fieldContainerClass
          ? { fieldContainerClass: laidOut.fieldContainerClass }
          : {}),
      }}
    />,
  );
  const cell = document.body.querySelector('[data-field="summary"]');
  if (!cell) throw new Error('field not rendered: summary');
  return (cell.getAttribute('class') || '')
    .split(/\s+/)
    .filter((t) => /(^|:)col-span-/.test(t));
}

describe("objectui#9244 — an authored `span: 'full'` reaches the DOM as a whole ladder", () => {
  it('3-column section: full row at the middle tier as well as the top', () => {
    // The middle tier is the whole card: `@md:grid-cols-2` is where the field
    // used to take 1 of 2 cells while the author had written `span: 'full'`.
    expect(renderAuthoredSection(3)).toEqual(['@md:col-span-2', '@2xl:col-span-3']);
  });

  it('4-column section: a class for each of the three multi-column tiers', () => {
    expect(renderAuthoredSection(4)).toEqual([
      '@md:col-span-2',
      '@2xl:col-span-3',
      '@4xl:col-span-4',
    ]);
  });

  it('2-column section: the one tier that exists', () => {
    expect(renderAuthoredSection(2)).toEqual(['@md:col-span-2']);
  });

  it('1-column section: no grid, and therefore no span class', () => {
    // `CONTAINER_GRID_COLS[1]` is `undefined` by design — the renderer falls
    // back to its `space-y-4` stack, where every field is already the row.
    expect(CONTAINER_GRID_COLS[1]).toBeUndefined();
    expect(renderAuthoredSection(1)).toEqual([]);
  });

  it('the tier ladder covers every tier the container class declares', () => {
    // The drift guard between the two halves of this card: the renderer
    // derives its tiers by parsing the container class, so a tier added to
    // `CONTAINER_GRID_COLS` and not to the renderer's literal class table
    // would silently emit nothing for that tier. Read the tiers out of the
    // container class itself and require one emitted class per INCREASE.
    for (const columns of [2, 3, 4]) {
      const container = CONTAINER_GRID_COLS[columns]!;
      const tiers = Array.from(container.matchAll(/@(\w+):grid-cols-(\d+)/g)).map((m) => ({
        bp: m[1],
        cols: Number(m[2]),
      }));
      const expected = tiers.map((t) => `@${t.bp}:col-span-${Math.min(t.cols, columns)}`);
      expect(renderAuthoredSection(columns), `columns=${columns}`).toEqual(expected);
    }
  });
});
