/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

/**
 * objectui#6178 — `headerColor` reached the DOM as a template-literal Tailwind
 * class, which the v4 source scan never sees as a complete token, so the class
 * had no rule behind it unless another file happened to author the same class
 * literally.
 *
 * WHAT THIS FILE CAN AND CANNOT SHOW. It renders the real `DetailSection` and
 * inspects the class list the header receives. That proves which class string
 * reaches the DOM; it proves NOTHING about whether Tailwind emitted a rule for
 * it — asserting a `className` is exactly the blind instrument this defect
 * hides behind. The CSS-generation half is `headerColor.test.ts`, which asks
 * the Tailwind design system for the rule and reads this module's source text
 * the way the scanner does. Neither file alone is the evidence.
 */

const TITLE = 'Billing';

const baseSection = (extra: Partial<DetailViewSection>): DetailViewSection =>
  ({ title: TITLE, fields: [{ name: 'amount', label: 'Amount' }], ...extra }) as DetailViewSection;

/**
 * A `headerColor` value the CONTRACT does not declare, handed to the renderer
 * anyway.
 *
 * ⚠️ The cast is the POINT of the three tests that use it, not a workaround for
 * them. objectui#6594 narrowed `DetailViewSection.headerColor` to the six ruled
 * tokens, so an off-vocabulary value is a compile error at every authoring site
 * — which is the guarantee that card bought, and `headerColor.contractPin-6594
 * .test.ts` is where it is pinned. The renderer still has to behave sanely when
 * one reaches it anyway, because metadata arrives as JSON over the wire where
 * no compiler was ever involved, and because the pass-through for a value that
 * is already a complete `bg-*` class is a deliberate UNDECLARED affordance
 * (objectstack#12126 ruling A rejected declaring it: whether the class renders
 * depends on the host app's Tailwind build, so declaring it would promise a
 * capability the contract cannot keep).
 *
 * ⛔ Do not widen the declaration to make these three compile without the cast.
 * That deletes the distinction the ruling drew.
 */
const offContract = (value: string): DetailViewSection['headerColor'] =>
  value as DetailViewSection['headerColor'];

/**
 * The header element, located by the two padding classes `DetailSection`
 * passes to `CardHeader` on both render branches. `getBy`-style: it throws
 * when the header did not render at all, so a negative assertion below cannot
 * pass vacuously against a header that is not on screen.
 */
function headerOf(container: HTMLElement): HTMLElement {
  const matches = Array.from(container.querySelectorAll<HTMLElement>('.py-3.px-4'));
  expect(matches, 'exactly one section header should render').toHaveLength(1);
  return matches[0];
}

const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);

describe('DetailSection headerColor -> a class the stylesheet can carry (objectui#6178)', () => {
  // ---- the instrument, before anything is asserted with it ----------------
  it('control: the header renders, carries its base classes, and shows the title', () => {
    const { container, getByText } = render(
      <DetailSection section={baseSection({})} data={{ amount: 1 }} />,
    );
    const header = headerOf(container);
    expect(getByText(TITLE)).toBeTruthy();
    expect(classesOf(header)).toEqual(expect.arrayContaining(['py-3', 'px-4', 'sm:px-6']));
    // No headerColor authored -> no background utility at all.
    expect(classesOf(header).filter((c) => c.startsWith('bg-'))).toEqual([]);
  });

  describe.each([
    ['non-collapsible (titled Card)', {}],
    ['collapsible (CollapsibleTrigger header)', { collapsible: true }],
  ])('%s', (_label, extra) => {
    it('a mapped token renders its literal class', () => {
      const { container, getByText } = render(
        <DetailSection section={baseSection({ ...extra, headerColor: 'muted' })} data={{ amount: 1 }} />,
      );
      const header = headerOf(container);
      expect(getByText(TITLE)).toBeTruthy(); // positive probe: the header is real
      expect(classesOf(header)).toContain('bg-muted');
    });

    it('the second documented example (`primary/10`) renders its literal class', () => {
      const { container } = render(
        <DetailSection
          section={baseSection({ ...extra, headerColor: 'primary/10' })}
          data={{ amount: 1 }}
        />,
      );
      expect(classesOf(headerOf(container))).toContain('bg-primary/10');
    });

    it('a value that is already a `bg-*` class passes through, not doubled', () => {
      const { container } = render(
        <DetailSection
          section={baseSection({ ...extra, headerColor: offContract('bg-accent') })}
          data={{ amount: 1 }}
        />,
      );
      const classes = classesOf(headerOf(container));
      expect(classes).toContain('bg-accent');
      // The old concatenation produced `bg-bg-accent` for this input.
      expect(classes).not.toContain('bg-bg-accent');
    });

    it('an unmapped value contributes no class at all — never a fabricated one', () => {
      const { container, getByText } = render(
        <DetailSection
          section={baseSection({ ...extra, headerColor: offContract('not-a-token') })}
          data={{ amount: 1 }}
        />,
      );
      const header = headerOf(container);
      // Positive probe first: the header IS rendered, so the two negative
      // assertions below are about a real element.
      expect(getByText(TITLE)).toBeTruthy();
      const classes = classesOf(header);
      expect(classes).toContain('py-3');
      expect(classes).not.toContain('bg-not-a-token');
      expect(classes.filter((c) => c.startsWith('bg-'))).toEqual([]);
    });

    it('an inherited Object.prototype key is not a vocabulary entry', () => {
      const { container } = render(
        <DetailSection
          section={baseSection({ ...extra, headerColor: offContract('constructor') })}
          data={{ amount: 1 }}
        />,
      );
      const classes = classesOf(headerOf(container));
      expect(classes.filter((c) => c.startsWith('bg-'))).toEqual([]);
      expect(classes.some((c) => c.includes('Object'))).toBe(false);
    });
  });
});
