/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#27521 row 13 — a horizontal `page:tabs` strip with more tabs
 * than fit scrolls sideways and says which edge hides tabs (`data-overflow`,
 * which the strip's edge fade reads), re-read on scroll. jsdom lays nothing
 * out, so the strip's widths are set on the element, as a browser would
 * measure them.
 *
 * Module-scope registration import, not a hook (AGENTS.md §测试纪律).
 */

import { describe, it, expect } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import '../renderers';

const TABS = ['Details', 'Positions', 'Permission Sets', 'Sessions'].map((label) => ({
  label,
  value: label.toLowerCase().replace(/\s+/g, '_'),
  children: [],
}));

function strip(position?: 'left') {
  const { container } = render(
    <SchemaRenderer schema={{ type: 'page:tabs', items: TABS, ...(position ? { position } : {}) } as never} />,
  );
  return container.querySelector('[role="tablist"]') as HTMLElement;
}

/** Give the strip a layout: `scrollWidth` of content in a `clientWidth` box. */
function layOut(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
}

function scrollTo(el: HTMLElement, left: number) {
  el.scrollLeft = left;
  fireEvent.scroll(el);
}

describe('page:tabs — the strip scrolls and cues its hidden edge (objectstack#27521)', () => {
  it('a strip wider than its box reads end, then both, then start as it scrolls', () => {
    const el = strip();
    expect(el.className).toContain('overflow-x-auto');
    layOut(el, 1269, 1088);
    act(() => scrollTo(el, 0));
    expect(el.dataset.overflow).toBe('end');
    act(() => scrollTo(el, 80));
    expect(el.dataset.overflow).toBe('both');
    act(() => scrollTo(el, 181));
    expect(el.dataset.overflow).toBe('start');
  });

  it('CONTROL: a strip that fits reads none', () => {
    const el = strip();
    layOut(el, 600, 1088);
    act(() => scrollTo(el, 0));
    expect(el.dataset.overflow).toBe('none');
  });

  it('CONTROL: a vertical strip is a sidebar and carries no cue', () => {
    const el = strip('left');
    expect(el.dataset.overflow).toBeUndefined();
    expect(el.className).not.toContain('overflow-x-auto');
  });
});

/** The strip rendered inside a scroll container with the given top padding. */
function stripInScroller(paddingTop: string, position?: 'left') {
  const { container } = render(
    <div data-testid="scroller" style={{ overflowY: 'auto', paddingTop }}>
      <SchemaRenderer schema={{ type: 'page:tabs', items: TABS, ...(position ? { position } : {}) } as never} />
    </div>,
  );
  return {
    scroller: container.querySelector('[data-testid="scroller"]') as HTMLElement,
    el: container.querySelector('[role="tablist"]') as HTMLElement,
  };
}

describe('page:tabs — the stuck strip is a solid bar flush with its scroller top (objectstack#35414)', () => {
  it('the horizontal strip sticks with the solid page-background token: no transparency, no blur', () => {
    const el = strip();
    const classes = el.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['sticky', 'top-0', 'z-20', 'bg-background']));
    // Neither an alpha-suffixed fill nor a blur may come back: either lets the
    // content scrolling under the stuck strip show through its labels.
    expect(classes.filter((c) => c.includes('bg-background/'))).toEqual([]);
    expect(classes.filter((c) => c.includes('backdrop'))).toEqual([]);
    // The bottom rule stays.
    expect(el.className).toContain('shadow-[inset_0_-1px_0_var(--color-border)]');
  });

  it("a padded scroller: the strip stops its padding above top-0, so no strip of content shows above it", () => {
    const { el } = stripInScroller('24px');
    expect(el.style.top).toBe('-24px');
  });

  it('the inset is re-read when the scroller resizes (its padding changes at breakpoints)', () => {
    const { el, scroller } = stripInScroller('24px');
    scroller.style.paddingTop = '12px';
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(el.style.top).toBe('-12px');
  });

  it('CONTROL: an unpadded scroller leaves the strip at top-0', () => {
    const { el } = stripInScroller('0px');
    expect(el.style.top).toBe('');
  });

  it('CONTROL: a vertical strip is a sidebar, never sticky and never offset', () => {
    const { el } = stripInScroller('24px', 'left');
    expect(el.className).not.toContain('sticky');
    expect(el.style.top).toBe('');
  });
});
