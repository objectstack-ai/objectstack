/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One concept, one key: the console `<PageHeader>`'s secondary line is
 * `subtitle` (objectui#4761).
 *
 * WHAT DIVERGED. This repo has two components named `PageHeader`.
 * `@object-ui/layout`'s is the renderer for the authored `page:header` /
 * `page-header` node and converged on `subtitle` in objectui#3789, because
 * `subtitle` is the key `@objectstack/spec/ui`'s `PageHeaderProps` declares.
 * This one — the console's own title row, used by `ObjectView` and
 * `ObjectDataPage` — spelled the very same concept `description` and had no
 * `subtitle` at all. Two dialects for one idea, one package apart, which is the
 * objectstack#4115 shape moved up a layer. Nothing rendered wrong on either
 * side; the defect was the divergence itself, and an author (especially an AI
 * one) reading one component to learn the other was being taught the wrong key.
 *
 * WHY A PLAIN RENAME AND NOT AN ALIAS. The alias route the layout side needed
 * was not needed here: this component is not part of `@object-ui/app-shell`'s
 * published API. Measured, not assumed — `src/index.ts` names 226 exports and
 * `PageHeader` is not among them (the package has no `export *` to propagate it
 * silently), and the `exports` map declares exactly `.` and `./styles.css`, so
 * Node refuses every deep subpath that could reach it with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. With no supported import path there was
 * nothing to keep compatible, and a renderer-side alias would have been exactly
 * the second dialect AGENTS.md #0.1 forbids. (That reading is of the rename.
 * objectui#12526 later exported the component from the package root as
 * `ConsolePageHeader`, spelled `subtitle` from its first published day.)
 *
 * WHAT THIS FILE PINS. Both directions of the convergence, so the next agent
 * finds an answer instead of re-opening the drift:
 *   1. `subtitle` renders, as the secondary line beneath the title, inside the
 *      header — asserted on the DOM a user gets, not on the props object.
 *   2. `description` is an ordinary unknown prop: rejected by the compiler and
 *      drawing nothing at runtime.
 *   3. This component and `@object-ui/layout`'s agree on the key, at compile
 *      time — the assertion that actually goes red if either side drifts again.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PageHeader } from '../PageHeader';
import type { ConsolePageHeaderProps } from '../PageHeader';
// The sibling component this card exists to agree with. A type-only import:
// nothing from `@object-ui/layout` is rendered here.
import type { PageHeaderComponentProps as LayoutPageHeaderProps } from '@object-ui/layout';

describe('the secondary line renders from `subtitle`', () => {
  it('draws it after the title, inside the header', () => {
    render(<PageHeader title="Accounts" subtitle="Everything your team owns" />);

    const header = screen.getByTestId('page-header');
    const h1 = header.querySelector('h1');
    const line = screen.getByText('Everything your team owns');

    expect(h1?.textContent).toBe('Accounts');
    // A `<p>`, in the same title row as the `<h1>`, positioned after it —
    // i.e. the line a reader sees beside the title (one row since
    // objectui#12423; it sat under the title before), not a stray node parked
    // elsewhere in the header that happens to carry the text.
    expect(line.tagName).toBe('P');
    expect(header.contains(line)).toBe(true);
    expect(line.parentElement).toBe(h1?.parentElement);
    expect(
      Boolean(h1!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it('renders no secondary line at all when `subtitle` is omitted', () => {
    const { container } = render(<PageHeader title="Accounts" />);
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(container.querySelector('p')).toBeNull();
  });

  it('keeps the line reachable from the `sm` breakpoint up', () => {
    // The class contract, pinned as a string because happy-dom evaluates no
    // Tailwind: `hidden sm:block` is "hidden on phones, shown from 640px up";
    // below `sm` the header draws its icon, title and actions only. Dropping
    // the `sm:block` half would leave a bare `hidden` — an element that passes
    // every DOM assertion above while being invisible at every width. That is
    // the failure this case exists to catch; it is not a claim about computed
    // style, which nothing in this environment can measure.
    render(<PageHeader title="Accounts" subtitle="Everything your team owns" />);
    const line = screen.getByText('Everything your team owns');
    expect(line.className).toContain('hidden');
    expect(line.className).toContain('sm:block');
  });
});

describe('`description` is not a second spelling of it', () => {
  it('draws nothing for the retired key', () => {
    render(
      // @ts-expect-error — `description` is not a prop of this component. Unlike
      // `@object-ui/layout`'s header, this one does not extend `HTMLAttributes`,
      // so the compiler rejects the key outright; the runtime assertion below
      // covers the JS caller the compiler never sees.
      <PageHeader title="Accounts" description="Everything your team owns" />,
    );
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.queryByText('Everything your team owns')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('both `PageHeader`s spell the secondary line the same way', () => {
  it('is pinned at compile time', () => {
    type _ConsoleHasSubtitle = Assert<HasKey<ConsolePageHeaderProps, 'subtitle'>>;
    type _LayoutHasSubtitle = Assert<HasKey<LayoutPageHeaderProps, 'subtitle'>>;

    // Only this side can be pinned negatively. `@object-ui/layout`'s props
    // extend `React.HTMLAttributes<HTMLDivElement>`, which declares `about`,
    // `color` and friends — so `keyof` over it is open enough that a
    // "`description` is absent" assertion there would be about the DOM
    // attribute surface, not about this component's contract. The layout side's
    // half of the retirement is pinned where it belongs, on rendered output, in
    // `packages/layout/src/__tests__/page-header-authorable-keys.test.tsx`.
    type _ConsoleHasNoDescription = Assert<
      HasKey<ConsolePageHeaderProps, 'description'> extends true ? false : true
    >;

    expect(true).toBe(true);
  });
});
