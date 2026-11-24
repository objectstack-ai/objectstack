// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36896 — the metadata list's scroll position comes back after a
 * trip to a detail. Pinned, each with its control:
 *
 *  - a list scrolled, left (unmounted, as opening a detail does) and mounted
 *    again at the same address lands where it was, once its rows are drawn;
 *  - a list at another address (other filters) starts at the top;
 *  - the scroll a loading page leaves behind (the box clamping while the rows
 *    are not drawn yet) never overwrites the kept position.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { forgetListScrolls, keptListScroll, scrollParentOf, useListScrollRestore } from './useListScrollRestore';

function List({ listKey, ready }: { listKey: string; ready: boolean }) {
  const ref = useListScrollRestore<HTMLDivElement>(listKey, ready);
  return <div ref={ref} data-testid="list" />;
}

/** The list inside a box that scrolls, as the Setup page and the Studio area hold it. */
function Host({ show, listKey, ready }: { show: boolean; listKey: string; ready: boolean }) {
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto', height: 100 }}>
      {show ? <List listKey={listKey} ready={ready} /> : <div data-testid="detail" />}
    </div>
  );
}

const KEY = '/apps/setup/metadata/flow?package=crm&q=lead';

afterEach(() => {
  cleanup();
  forgetListScrolls();
});

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

describe('the metadata list keeps its scroll across a detail (objectstack#36896)', () => {
  it('finds the box that scrolls, else the page', () => {
    const { getByTestId } = render(<Host show listKey={KEY} ready />);
    expect(scrollParentOf(getByTestId('list'))).toBe(getByTestId('scroller'));
    // Control: outside any scrolling box, the page scrolls.
    const loose = document.createElement('span');
    document.body.appendChild(loose);
    expect(scrollParentOf(loose)).toBe(document.scrollingElement ?? document.documentElement);
    loose.remove();
  });

  it('comes back where it was, at the same address, once the rows are drawn', () => {
    const view = render(<Host show listKey={KEY} ready />);
    const scroller = view.getByTestId('scroller');
    scrollTo(scroller, 640);
    expect(keptListScroll(KEY)).toBe(640);

    // Open a detail: the list leaves; the detail scrolls the same box.
    view.rerender(<Host show={false} listKey={KEY} ready />);
    scrollTo(scroller, 20);
    expect(keptListScroll(KEY)).toBe(640);

    // Back: the list mounts loading, the box clamps to the top meanwhile.
    view.rerender(<Host show listKey={KEY} ready={false} />);
    scrollTo(scroller, 0);
    expect(keptListScroll(KEY)).toBe(640);
    expect(scroller.scrollTop).toBe(0);

    // The rows are drawn: the position comes back.
    view.rerender(<Host show listKey={KEY} ready />);
    expect(scroller.scrollTop).toBe(640);
  });

  it('a list at another address starts at the top (control)', () => {
    const view = render(<Host show listKey={KEY} ready />);
    const scroller = view.getByTestId('scroller');
    scrollTo(scroller, 640);
    view.rerender(<Host show={false} listKey={KEY} ready />);
    scrollTo(scroller, 0);

    const other = '/apps/setup/metadata/flow?package=crm&q=account';
    view.rerender(<Host show listKey={other} ready />);
    expect(scroller.scrollTop).toBe(0);
    expect(keptListScroll(KEY)).toBe(640);
  });
});
