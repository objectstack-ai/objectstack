/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9218 — `DetailSection`'s COLLAPSIBLE branch honours
 * `section.showBorder`.
 *
 * ## What was broken, measured rather than read
 *
 * `DetailSection` ends in three returns and `showBorder` appeared in exactly
 * two of them on `a9d97be63`:
 *
 *  1. the flat branch — `!section.title && !section.collapsible &&
 *     section.showBorder === false` — reads it;
 *  2. the non-collapsible `Card` branch — `section.showBorder === false ?
 *     'border-none shadow-none' : ''` — reads it;
 *  3. the collapsible branch — a `Collapsible` wrapping a BARE `Card` — never
 *     mentioned it, so the key was structurally unreachable there.
 *
 * `showBorder` is declared on three surfaces at once (`DetailViewSection` in
 * `@object-ui/types`, its Zod mirror, and the `detail-section` registration's
 * `inputs`), so `sdui-parser`'s `validateTree` told an author the node was
 * correct and complete — and then the border stayed. Declared clean,
 * published clean, rendered wrong: ADR-0049 enforce-or-remove shape.
 *
 * ## Why every row here is a RENDERING verdict
 *
 * Each row reads the class list of the real `Card` element, and each carries
 * its own negative (`showBorder: true` on the same branch, same shape). A row
 * asserting only "the prop arrived" would pass on the broken tree, which is
 * precisely the defect.
 *
 * ## The control, and why it can fire
 *
 * The `collapsible: false` rows are the same authored node with ONE key
 * flipped, and they were GREEN on the unmodified tree — branch 2 already read
 * the key. They are what makes the collapsible rows a statement about the
 * branch rather than about `showBorder` in general. Each side additionally
 * asserts WHICH branch it landed on (`[aria-expanded]` present / absent), so
 * a future change that quietly routes the collapsible node through branch 2
 * reds here instead of passing silently.
 *
 * ## Measured legs
 *
 * - PIN-FIRST. This file was written before `DetailSection.tsx` was touched
 *   and run against the unmodified base tree `a9d97be63`: `2 failed | 4
 *   passed`. The two rows that failed are the collapsible `showBorder: false`
 *   verdicts; both `collapsible: false` control rows, the collapsible
 *   `showBorder: true` negative and the drift guard passed.
 * - ABLATION. With the fix committed, deleting the new decision from the
 *   collapsible branch's `<Card>` reddens exactly those same two rows and
 *   nothing else. Both legs are recorded in the pull request.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';

import { DetailSection } from '../DetailSection';

// Module scope, not a hook (AGENTS.md test discipline): importing the package
// index executes its registration side-effects, so the `detail-section` entry
// resolved below is the very one production resolves.
import '../index';

const RECORD = { street: '1 Market St', city: 'San Francisco' };

/**
 * The node an author writes. A `title` is present on purpose: without one, a
 * `collapsible: false` + `showBorder: false` node takes the FLAT branch and
 * renders no `Card` at all, and the control would then be measuring a third
 * branch instead of branch 2.
 */
const authoredNode = (overrides: Record<string, unknown>) =>
  ({
    type: 'detail-section',
    title: 'Billing Address',
    fields: [
      { name: 'street', label: 'Street' },
      { name: 'city', label: 'City' },
    ],
    ...overrides,
  }) as never;

/** The same section, reached the way `DetailView` / `SectionGroup` reach it. */
const directSection = (overrides: Record<string, unknown>) =>
  ({
    title: 'Billing Address',
    fields: [
      { name: 'street', label: 'Street' },
      { name: 'city', label: 'City' },
    ],
    ...overrides,
  }) as unknown as DetailViewSection;

/**
 * The `Card` element itself, not "somewhere in the subtree". `Card`'s own base
 * classes are `rounded-lg border bg-card text-card-foreground shadow-sm`, so
 * `.bg-card` identifies it and survives any `className` the branch adds.
 * Asserted unique, so the reading cannot silently become about a second card.
 */
const cardOf = (container: HTMLElement): HTMLElement => {
  const cards = container.querySelectorAll<HTMLElement>('.bg-card');
  expect(cards).toHaveLength(1);
  return cards[0];
};

/** The disclosure affordance `CollapsibleTrigger` puts on the card header. */
const isCollapsibleBranch = (container: HTMLElement) =>
  container.querySelector('[aria-expanded]') !== null;

afterEach(() => {
  cleanup();
});

describe('objectui#9218 — the collapsible branch honours showBorder', () => {
  it('drops border and shadow on an authored collapsible node with `showBorder: false`', () => {
    const { container } = render(
      <SchemaRenderer
        schema={authoredNode({ collapsible: true, showBorder: false })}
        data={RECORD}
      />,
    );

    // The block rendered at all — not `SchemaErrorBoundary`'s banner.
    expect(screen.queryByText(/failed to render/i)).toBeNull();
    // This really is branch 3, so the row below is about the collapsible card.
    expect(isCollapsibleBranch(container)).toBe(true);

    const card = cardOf(container);
    expect(card.classList.contains('border-none')).toBe(true);
    expect(card.classList.contains('shadow-none')).toBe(true);
    // `cn()` is tailwind-merge: the base `shadow-sm` is displaced, not stacked.
    expect(card.classList.contains('shadow-sm')).toBe(false);
  });

  it('keeps border and shadow on the same collapsible node with `showBorder: true`', () => {
    const { container } = render(
      <SchemaRenderer
        schema={authoredNode({ collapsible: true, showBorder: true })}
        data={RECORD}
      />,
    );

    expect(isCollapsibleBranch(container)).toBe(true);

    const card = cardOf(container);
    expect(card.classList.contains('border-none')).toBe(false);
    expect(card.classList.contains('shadow-none')).toBe(false);
    expect(card.classList.contains('shadow-sm')).toBe(true);
  });

  it('reaches the same verdict through the direct `section` prop `DetailView` uses', () => {
    const { container } = render(
      <DetailSection
        section={directSection({ collapsible: true, showBorder: false })}
        data={RECORD}
      />,
    );

    expect(isCollapsibleBranch(container)).toBe(true);
    expect(cardOf(container).classList.contains('border-none')).toBe(true);
  });

  /**
   * THE CONTROL — the same authored node with `collapsible` flipped, i.e.
   * branch 2. Green on the unmodified tree, which is what makes the rows above
   * a reading about the collapsible branch and not about `showBorder` at all.
   */
  it('control: the non-collapsible branch already dropped the border, and is a different branch', () => {
    const { container } = render(
      <SchemaRenderer
        schema={authoredNode({ collapsible: false, showBorder: false })}
        data={RECORD}
      />,
    );

    // The control must be able to tell the two branches apart; if this ever
    // reads `true` the control has stopped being a control.
    expect(isCollapsibleBranch(container)).toBe(false);

    const card = cardOf(container);
    expect(card.classList.contains('border-none')).toBe(true);
    expect(card.classList.contains('shadow-none')).toBe(true);
  });

  it('control negative: the non-collapsible branch keeps its border with `showBorder: true`', () => {
    const { container } = render(
      <SchemaRenderer
        schema={authoredNode({ collapsible: false, showBorder: true })}
        data={RECORD}
      />,
    );

    expect(isCollapsibleBranch(container)).toBe(false);
    expect(cardOf(container).classList.contains('border-none')).toBe(false);
  });

  /**
   * DRIFT GUARD, not the pin. objectui#9218 adds two classes to the
   * collapsible branch's `<Card>` and deliberately leaves the author's
   * `className` on the OUTER `Collapsible` — moving it is a different
   * behaviour that this card did not measure. This row reds if a later change
   * relocates it.
   */
  it('leaves the authored className on the outer Collapsible wrapper', () => {
    const { container } = render(
      <DetailSection
        section={directSection({ collapsible: true, showBorder: false })}
        data={RECORD}
        className="os-9218-probe"
      />,
    );

    const marked = container.querySelector('.os-9218-probe');
    expect(marked).not.toBeNull();
    // The wrapper, not the card: the card is a descendant of it.
    expect(marked!.classList.contains('bg-card')).toBe(false);
    expect(marked!.querySelector('.bg-card')).not.toBeNull();
  });
});
