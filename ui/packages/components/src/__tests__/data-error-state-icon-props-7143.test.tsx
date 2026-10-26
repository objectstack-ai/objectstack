/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7143 — `DataErrorState` gains `icon` / `showIcon` /
 * `iconWrapperClassName`, MIRRORED from `DataEmptyState` rather than spelled a
 * second way.
 *
 * `DataErrorState` hardcoded its glyph, which is why `plugin-list` rendered its
 * load FAILURE through the component named for the *empty* case: the panel had
 * to draw a network outage differently from a permission denial, and only the
 * wrong component could take an icon. objectui#7132 fixed the accessibility half
 * of that collision (`role`) and left the structural half; the maintainer ruling
 * of 2026-09-01 approved the migration and pinned the shape to the empty state's.
 *
 * "Mirrored" is a claim about SEMANTICS, not just about three identifiers, so
 * every arm below runs twice — once on each component — and the pairs assert the
 * same thing. The semantics that can silently diverge is
 * `iconWrapperClassName`: `DataEmptyState` resolves it with `??`, so it REPLACES
 * the default wrapper class rather than merging with it, and `""` is therefore a
 * meaningful value that strips the styling. A `cn(default, override)` reading
 * would type-check, look right, and quietly keep `bg-destructive/10` under every
 * override — including `plugin-list`'s `mb-3`, which exists to remove the box.
 *
 * SUITE DIRECTION, MEASURED by reverting both source files to the base commit
 * and re-running: every `DataErrorState` arm here is RED against `origin/main`.
 * The three props do not exist there — they fall into the `...props` spread and
 * land on the div as unknown attributes while the hardcoded wrapper renders
 * regardless — and that wrapper carries no `data-slot` to select it by. The
 * DEFAULTS arm is red for the selector alone, which is the point of keeping it:
 * what it pins is that after the change a call site passing none of the three
 * still gets the same square and the same glyph it always got.
 *
 * ⚠️ The `showIcon={false}` arm was written asserting only that the named
 * wrapper is ABSENT, and that arm passed on the base — the selector it looks
 * for does not exist there either, so "no wrapper" and "no such name" were the
 * same reading and the arm could not fail. It now names the glyph as well.
 * The same trap is why the DataEmptyState mirror below does both.
 *
 * GREEN in both worlds, deliberately: the three `DataEmptyState` halves — the
 * control that makes "same semantics" a measurement rather than a restatement of
 * the new code — and the last arm, which pins that title / message / retry were
 * not disturbed by growing the component.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataEmptyState, DataErrorState } from '../custom/view-states';

const errorBox = (c: HTMLElement) => c.querySelector('[data-slot="data-error-state"]')!;
const errorIcon = (c: HTMLElement) => c.querySelector('[data-slot="data-error-state-icon"]');
const emptyIcon = (c: HTMLElement) => c.querySelector('[data-slot="data-empty-state-icon"]');

const ERROR_WRAPPER_DEFAULT = 'flex size-10 items-center justify-center rounded-lg bg-destructive/10';
const EMPTY_WRAPPER_DEFAULT = 'flex size-10 items-center justify-center rounded-lg bg-muted';

describe('DataErrorState — the icon props mirrored from DataEmptyState (#7143)', () => {
  it('DEFAULTS: no props renders the destructive square and its own glyph, unchanged', () => {
    const { container } = render(<DataErrorState title="Something went wrong" />);
    const box = errorBox(container);
    expect(box.getAttribute('role')).toBe('alert');
    const icon = errorIcon(container);
    expect(icon).not.toBeNull();
    expect(icon!.className).toBe(ERROR_WRAPPER_DEFAULT);
    // The component's own AlertCircle, not an absent glyph.
    expect(icon!.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('Something went wrong');
  });

  it('`icon` replaces the hardcoded glyph — the reason this migration needed props', () => {
    const { container } = render(
      <DataErrorState icon={<span data-testid="custom-glyph">!</span>} />,
    );
    const icon = errorIcon(container)!;
    expect(icon.querySelector('[data-testid="custom-glyph"]')).not.toBeNull();
    // Asserted by absence too: a `??` that fell through would render BOTH.
    expect(icon.querySelector('svg')).toBeNull();
  });

  it('MIRROR: `icon` behaves identically on DataEmptyState', () => {
    const { container } = render(
      <DataEmptyState icon={<span data-testid="custom-glyph">!</span>} />,
    );
    const icon = emptyIcon(container)!;
    expect(icon.querySelector('[data-testid="custom-glyph"]')).not.toBeNull();
    expect(icon.querySelector('svg')).toBeNull();
  });

  it('`showIcon={false}` omits the container entirely, without collapsing the render', () => {
    const { container } = render(<DataErrorState showIcon={false} title="Denied" message="No." />);
    expect(errorIcon(container)).toBeNull();
    // The absent-wrapper assertion ALONE cannot fail: measured against
    // `origin/main`, where the prop does not exist and the wrapper carries no
    // `data-slot`, the selector returns null while the hardcoded glyph is right
    // there on screen. So the glyph itself is named — no icon means no icon.
    expect(errorBox(container).querySelector('svg')).toBeNull();
    // Guard against the arm passing over a component that rendered nothing.
    expect(container.textContent).toContain('Denied');
    expect(container.textContent).toContain('No.');
  });

  it('MIRROR: `showIcon={false}` behaves identically on DataEmptyState', () => {
    const { container } = render(<DataEmptyState showIcon={false} title="Nothing here yet" />);
    expect(emptyIcon(container)).toBeNull();
    expect(container.querySelector('[data-slot="data-empty-state"]')!.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('Nothing here yet');
  });

  it('`iconWrapperClassName` REPLACES the default class, it does not merge with it', () => {
    const { container } = render(<DataErrorState iconWrapperClassName="mb-3" />);
    const icon = errorIcon(container)!;
    // Exact value, not `toContain`: merging would also satisfy "contains mb-3",
    // and merging is precisely what `plugin-list`'s call site must not get — its
    // `mb-3` is there to REMOVE the box, not to nudge it.
    expect(icon.className).toBe('mb-3');
    expect(icon.className).not.toContain('bg-destructive/10');
  });

  it('`iconWrapperClassName=""` strips the styling and renders the icon raw', () => {
    const { container } = render(<DataErrorState iconWrapperClassName="" />);
    const icon = errorIcon(container)!;
    expect(icon.className).toBe('');
    expect(icon.querySelector('svg')).not.toBeNull();
  });

  it('MIRROR: both override semantics are identical on DataEmptyState', () => {
    const { container: replaced } = render(<DataEmptyState iconWrapperClassName="mb-3" />);
    expect(emptyIcon(replaced)!.className).toBe('mb-3');
    expect(emptyIcon(replaced)!.className).not.toContain('bg-muted');
    const { container: stripped } = render(<DataEmptyState iconWrapperClassName="" />);
    expect(emptyIcon(stripped)!.className).toBe('');
    // And the empty state's own default is the one it always had, so the two
    // components differ by exactly the fallback colour and nothing else.
    const { container: bare } = render(<DataEmptyState />);
    expect(emptyIcon(bare)!.className).toBe(EMPTY_WRAPPER_DEFAULT);
  });

  it('the existing surface is untouched: title, message and the retry button', () => {
    let clicks = 0;
    const { container } = render(
      <DataErrorState
        title="Couldn’t load"
        message="Try again later."
        retryLabel="Retry now"
        onRetry={() => { clicks += 1; }}
      />,
    );
    expect(container.textContent).toContain('Couldn’t load');
    expect(container.textContent).toContain('Try again later.');
    const button = container.querySelector('button')!;
    expect(button.textContent).toContain('Retry now');
    button.click();
    expect(clicks).toBe(1);
  });
});
