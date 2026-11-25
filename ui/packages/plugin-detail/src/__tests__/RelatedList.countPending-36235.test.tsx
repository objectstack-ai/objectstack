/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36235 — a related list's count is drawn once it is known, never
 * as the 0 its empty first read holds. On a slow network the header used to
 * read 「Contacts 0」 until the rows landed, a false "no related records".
 *
 * Pinned here: while the first read is in flight and no count answers for it,
 * the list's header (and a compact card's header) draws no count; once the
 * read lands it draws the real one, and a list that really holds no rows
 * still draws its 0.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';
import { RelatedCardCountContext, RelatedListCompactContext } from '../relatedListCompact';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS = [
  { id: 'c1', name: 'Ada' },
  { id: 'c2', name: 'Grace' },
];

/** A `find` that answers only when `answer()` is called. */
function deferredFind() {
  let answer: (rows: unknown[]) => void = () => {};
  const find = vi.fn(
    () => new Promise((resolve) => {
      answer = (rows) => resolve({ data: rows, total: rows.length });
    }),
  );
  return { find, answer: (rows: unknown[]) => act(async () => { answer(rows); }) };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** The list header's count badge (the only `N records` label in the head). */
const headBadge = () =>
  document.querySelector('[data-related-list-head] [aria-label$=" records"]')?.textContent ?? null;
const cardCount = () => document.querySelector('[data-related-card-count]')?.textContent ?? null;

function renderList(find: ReturnType<typeof vi.fn>) {
  render(
    <RelatedList
      title="Contacts"
      type="table"
      api="contact"
      objectName="contact"
      referenceField="account"
      parentId="ACC-1"
      columns={[{ accessorKey: 'name', header: 'Name' }]}
      dataSource={{ find } as any}
    />,
  );
}

class InView {
  constructor(private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}

function renderCard(find: ReturnType<typeof vi.fn>) {
  render(
    <RelatedListCompactContext.Provider value>
      <RelatedCardCountContext.Provider value={null}>
        <RelatedList
          title="Contacts"
          type="table"
          api="contact"
          objectName="contact"
          referenceField="account"
          parentId="ACC-1"
          columns={[{ accessorKey: 'name', header: 'Name' }]}
          dataSource={{ find } as any}
        />
      </RelatedCardCountContext.Provider>
    </RelatedListCompactContext.Provider>,
  );
}

describe('a related list\'s count before it is known (objectstack#36235)', () => {
  it('the list header draws no count while the first read is in flight, then the real one', async () => {
    const read = deferredFind();
    renderList(read.find);
    await waitFor(() => expect(read.find).toHaveBeenCalled());
    await flush();
    expect(document.querySelector('[data-related-list-head]')).not.toBeNull();
    expect(headBadge()).toBeNull();
    await read.answer(ROWS);
    await waitFor(() => expect(headBadge()).toBe('2'));
  });

  it('CONTROL — a list whose read lands with no rows still draws its 0', async () => {
    const read = deferredFind();
    renderList(read.find);
    await waitFor(() => expect(read.find).toHaveBeenCalled());
    await read.answer([]);
    await waitFor(() => expect(headBadge()).toBe('0'));
  });

  it('a compact card no count answers for draws no count while its rows are read', async () => {
    vi.stubGlobal('IntersectionObserver', InView);
    const read = deferredFind();
    renderCard(read.find);
    await waitFor(() => expect(read.find).toHaveBeenCalled());
    await flush();
    expect(document.querySelector('[data-related-card]')).not.toBeNull();
    expect(cardCount()).toBeNull();
    await read.answer(ROWS);
    await waitFor(() => expect(cardCount()).toBe('2'));
  });
});

/**
 * objectstack#36822 — a refetch over a list whose count is already known keeps
 * drawing that count. A list that answered 0 used to blank its badge for the
 * length of the refetch, because an empty list in flight read as a first read.
 */
describe('a related list\'s count across a refetch (objectstack#36822)', () => {
  /** Every badge reading the DOM goes through, from now until `stop()`. */
  function watchBadge() {
    const seen: Array<string | null> = [headBadge()];
    const observer = new MutationObserver(() => seen.push(headBadge()));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    return { seen, stop: () => observer.disconnect() };
  }

  const refetch = () =>
    act(async () => {
      window.dispatchEvent(new CustomEvent('objectui:related-changed', { detail: { objectName: 'contact' } }));
    });

  it('a list that answered 0 keeps drawing 0 through a refetch that answers no rows', async () => {
    const read = deferredFind();
    renderList(read.find);
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(1));
    await read.answer([]);
    await waitFor(() => expect(headBadge()).toBe('0'));

    const watch = watchBadge();
    await refetch();
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(2));
    await flush();
    // The refetch is held in flight here: the badge still reads 0.
    expect(headBadge()).toBe('0');
    await read.answer([]);
    await flush();
    watch.stop();
    expect(headBadge()).toBe('0');
    expect(watch.seen.length).toBeGreaterThan(1);
    expect(watch.seen.filter((v) => v !== '0')).toEqual([]);
  });

  it('a list that answered rows draws their count through a refetch, then the 0 it answers', async () => {
    const read = deferredFind();
    renderList(read.find);
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(1));
    await read.answer(ROWS);
    await waitFor(() => expect(headBadge()).toBe('2'));

    const watch = watchBadge();
    await refetch();
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(2));
    await flush();
    expect(headBadge()).toBe('2');
    await read.answer([]);
    await waitFor(() => expect(headBadge()).toBe('0'));
    watch.stop();
    expect(watch.seen.filter((v) => v !== '2' && v !== '0')).toEqual([]);
  });

  /** A `find` whose current read is answered or refused by hand. */
  function heldFind() {
    let settle = { resolve: (_: unknown) => {}, reject: (_: unknown) => {} };
    const find = vi.fn(
      () => new Promise((resolve, reject) => {
        settle = { resolve, reject };
      }),
    );
    return {
      find,
      answer: (rows: unknown[]) => act(async () => { settle.resolve({ data: rows, total: rows.length }); }),
      fail: () => act(async () => { settle.reject(new Error('network down')); }),
    };
  }

  it('a read that fails after rows were known draws no count while Retry reads, never a false 0', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = heldFind();
    renderList(read.find);
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(1));
    await read.answer(ROWS);
    await waitFor(() => expect(headBadge()).toBe('2'));

    await refetch();
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(2));
    await read.fail();
    const retry = await waitFor(() => {
      const button = document.querySelector('[data-testid="related-list-load-failed-retry"]');
      expect(button).not.toBeNull();
      return button as HTMLElement;
    });
    await act(async () => { retry.click(); });
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(3));
    await flush();
    // Retry's read is held in flight: the failed read emptied the rows, so
    // their count is not known and the badge waits.
    expect(document.querySelector('[data-related-list-head]')).not.toBeNull();
    expect(headBadge()).toBeNull();
    await read.answer([]);
    await waitFor(() => expect(headBadge()).toBe('0'));
    quiet.mockRestore();
  });

  it('a list with no scope on its first render draws no count during its first real read', async () => {
    const read = heldFind();
    const list = (parentId: string | null) => (
      <RelatedList
        title="Contacts"
        type="table"
        api="contact"
        objectName="contact"
        referenceField="account"
        parentId={parentId as any}
        columns={[{ accessorKey: 'name', header: 'Name' }]}
        dataSource={{ find: read.find } as any}
      />
    );
    // The parent is still loading: no scope, so nothing is read.
    const view = render(list(null));
    await flush();
    expect(read.find).not.toHaveBeenCalled();
    // The parent lands: the first real read is held in flight.
    view.rerender(list('ACC-1'));
    await waitFor(() => expect(read.find).toHaveBeenCalledTimes(1));
    await flush();
    expect(document.querySelector('[data-related-list-head]')).not.toBeNull();
    expect(headBadge()).toBeNull();
    await read.answer(ROWS);
    await waitFor(() => expect(headBadge()).toBe('2'));
  });
});
