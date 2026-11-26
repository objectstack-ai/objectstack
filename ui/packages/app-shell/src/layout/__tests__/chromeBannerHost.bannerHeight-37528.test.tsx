// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The banners drawn in place, above the console's routes, publish their
 * height as `--os-chrome-banners` so a full-height page can give it back
 * (objectstack#37528). Drawn into an app layout's host they publish nothing:
 * the host sits inside the content area the page already sizes.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as React from 'react';
import {
  CHROME_BANNERS_HEIGHT_VAR,
  CONSOLE_FULL_HEIGHT,
  ChromeBannerHost,
  ChromeBannerSlot,
} from '../chromeBannerHost';

const observers: Array<{ callback: () => void }> = [];

class FakeResizeObserver {
  callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Every element with `data-h` reports that many pixels of height. */
function stubHeights() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = Number(this.getAttribute('data-h') ?? 0);
    return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

const published = () => document.documentElement.style.getPropertyValue(CHROME_BANNERS_HEIGHT_VAR);

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  document.documentElement.style.removeProperty(CHROME_BANNERS_HEIGHT_VAR);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChromeBannerSlot — the in-place banners publish their height (objectstack#37528)', () => {
  it('in place: the summed height of the drawn banners, cleared on unmount', () => {
    stubHeights();
    const { unmount } = render(
      <ChromeBannerSlot>
        <div data-h="53">impersonating</div>
        <div data-h="24">read rate</div>
      </ChromeBannerSlot>,
    );
    expect(published()).toBe('77px');

    unmount();
    expect(published(), 'nothing drawn, nothing given back').toBe('');
  });

  it('in place with no banner drawn (an ordinary session): nothing is published', () => {
    stubHeights();
    render(<ChromeBannerSlot>{null}</ChromeBannerSlot>);
    expect(published()).toBe('');
  });

  it('follows a banner that grows (it wraps on a narrow screen) or goes away', () => {
    stubHeights();
    const Banners = ({ show, height }: { show: boolean; height: number }) => (
      <ChromeBannerSlot>{show ? <div data-h={String(height)}>impersonating</div> : null}</ChromeBannerSlot>
    );
    const { rerender, container } = render(<Banners show height={41} />);
    expect(published()).toBe('41px');

    container.querySelector('[data-h]')!.setAttribute('data-h', '77');
    act(() => observers.forEach((o) => o.callback()));
    expect(published(), 'a resize republishes').toBe('77px');

    rerender(<Banners show={false} height={77} />);
    act(() => observers.forEach((o) => o.callback()));
    expect(published(), 'the banner ended').toBe('');
  });

  it("drawn into an app layout's host: nothing is published", () => {
    stubHeights();
    render(
      <>
        <ChromeBannerHost />
        <ChromeBannerSlot>
          <div data-h="53">impersonating</div>
        </ChromeBannerSlot>
      </>,
    );
    expect(document.querySelector('[data-testid="console-chrome-banners"]')?.textContent).toContain('impersonating');
    expect(published()).toBe('');
  });

  it('the full-height classes take the viewport less the published height, 0 when unset', () => {
    for (const cls of Object.values(CONSOLE_FULL_HEIGHT)) {
      expect(cls).toContain(`var(${CHROME_BANNERS_HEIGHT_VAR},0px)`);
    }
  });
});
