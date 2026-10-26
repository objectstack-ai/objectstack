// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12897 — on a narrow title row the actions slot no longer takes the
 * title's whole width: a chip that folds by `useStudioTabRowFold` folds to its
 * icon when the title would otherwise be cut, and a cut title says its whole
 * text in its tooltip, before the tooltip the pillar gives it.
 *
 * jsdom has no layout, so the widths are measured in Chromium by
 * `e2e/studio-item-header-title-width.spec.ts` (the Interfaces leaf's 422 px
 * row). Here the row's geometry is stubbed, as the objectui#12707 pin stubs
 * the tab row's: the row's width is the case's, the icon, the kind chip and
 * the other actions are fixed, the chip is as wide as its form, and the
 * title's box is the room the row leaves it, capped at its text. Gaps read 0
 * (no stylesheet).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Workflow } from 'lucide-react';
import { StudioItemHeader, useStudioTabRowFold } from './StudioItemHeader';
import { STUDIO_KIND_CHIP } from './studio-tokens';

const TITLE = 'Task board (kanban view)';
const INTERNAL_ID = 'Internal id: object · showcase_task';

/** Stubbed widths, in px. */
const ICON = 32;
const KIND_CHIP = 38;
const OPEN_IN_DATA = 137;
const CHIP_FULL = 132;
const CHIP_FOLDED = 28;
const TITLE_TEXT = 178;
const layout = { row: 632 };

const resizeCallbacks = new Set<() => void>();
const spies: Array<{ mockRestore: () => void }> = [];
const realRect = HTMLElement.prototype.getBoundingClientRect;
const rect = (width: number) =>
  ({ left: 0, right: width, width, top: 0, bottom: 32, height: 32, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

const isRow = (el: Element) => el.classList.contains('@container');
const chipWidth = () => {
  const chip = screen.queryByTestId('probe-chip');
  return chip ? (chip.hasAttribute('data-folded') ? CHIP_FOLDED : CHIP_FULL) : 0;
};
const actionsWidth = () => chipWidth() + OPEN_IN_DATA;
/** The title's box: what the row leaves it, capped at its text. */
const titleBox = () => Math.max(0, Math.min(TITLE_TEXT, layout.row - ICON - KIND_CHIP - actionsWidth()));

beforeEach(() => {
  layout.row = 632;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        resizeCallbacks.add(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.cb);
      }
    },
  );
  spies.push(
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (isRow(this)) return rect(layout.row);
      if (this.dataset.testid === 'probe-chip') return rect(chipWidth());
      if (this.dataset.testid === 'hdr-kind-chip') return rect(KIND_CHIP);
      if (this.dataset.testid === 'hdr-title') return rect(titleBox());
      if (this.parentElement && isRow(this.parentElement)) {
        if (this.tagName === 'SPAN') return rect(ICON);
        if (this.tagName === 'DIV') return rect(actionsWidth());
      }
      return realRect.call(this);
    }),
  );
  spies.push(
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (isRow(this)) return layout.row;
      if (this.dataset.testid === 'hdr-title') return titleBox();
      return 0;
    }),
  );
  spies.push(
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'hdr-title' ? TITLE_TEXT : 0;
    }),
  );
});

afterEach(() => {
  cleanup();
  resizeCallbacks.clear();
  for (const spy of spies.splice(0)) spy.mockRestore();
  vi.unstubAllGlobals();
});

/** A chip that folds by the shared rule, as the read-only link does. */
function Probe() {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const folded = useStudioTabRowFold(ref, 'Read-only');
  return (
    <span ref={ref} data-testid="probe-chip" data-folded={folded || undefined}>
      Read-only
    </span>
  );
}

function Leaf({ withProbe = true }: { withProbe?: boolean }) {
  return (
    <StudioItemHeader
      icon={Workflow}
      title={TITLE}
      titleProps={{ 'data-testid': 'hdr-title', title: INTERNAL_ID }}
      chips={
        <span className={STUDIO_KIND_CHIP} data-testid="hdr-kind-chip">
          View
        </span>
      }
      actions={
        <>
          {withProbe && <Probe />}
          <button type="button">Open in Data</button>
        </>
      }
    />
  );
}

function resizeRow(width: number) {
  layout.row = width;
  act(() => {
    for (const cb of resizeCallbacks) cb();
  });
}

describe('a foldable chip in the title row gives way before the title (objectui#12897)', () => {
  it('at a 422 px row the chip folds, and the title gets the room it frees', () => {
    layout.row = 422;
    render(<Leaf />);
    // With the chip whole the title would get 422 − 32 − 38 − 132 − 137 = 83 px
    // of its 178: the chip folds, and the 187 px left hold the title whole.
    expect(screen.getByTestId('probe-chip')).toHaveAttribute('data-folded', 'true');
    expect(titleBox()).toBe(TITLE_TEXT);
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', INTERNAL_ID);
  });

  it('a cut title says its whole text in its tooltip, then the pillar’s own tooltip', () => {
    layout.row = 360;
    render(<Leaf />);
    expect(screen.getByTestId('probe-chip')).toHaveAttribute('data-folded', 'true');
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', `${TITLE}\n${INTERNAL_ID}`);
  });

  it('CONTROL: at a 632 px row the title fits beside the whole chip: nothing folds, the tooltip is the pillar’s', () => {
    render(<Leaf />);
    expect(screen.getByTestId('probe-chip')).not.toHaveAttribute('data-folded');
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', INTERNAL_ID);
  });

  it('it follows the row: folds when the row narrows, unfolds when it widens again', () => {
    render(<Leaf />);
    expect(screen.getByTestId('probe-chip')).not.toHaveAttribute('data-folded');
    resizeRow(422);
    expect(screen.getByTestId('probe-chip')).toHaveAttribute('data-folded', 'true');
    resizeRow(632);
    expect(screen.getByTestId('probe-chip')).not.toHaveAttribute('data-folded');
  });

  it('CONTROL: without a foldable chip the title is cut and its tooltip still says it whole', () => {
    layout.row = 300;
    render(<Leaf withProbe={false} />);
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', `${TITLE}\n${INTERNAL_ID}`);
  });
});
