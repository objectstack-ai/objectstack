/**
 * The sign-out tier keeps the list layout; the change-of-user tier does not
 * (objectstack#36110, maintainer ruling on objectstack#35955 point 1).
 *
 * What may live under the kept prefixes is pinned here as a SHAPE: an entry is
 * kept only while it holds widths, a row height, a tab order and (for the
 * grid's copy) a column order, and nothing more. A writer that starts storing
 * a filter, a search term or record data under one of these keys loses the
 * exception for that entry. The real writers are run against this purge in
 * `@object-ui/app-shell`'s `context/__tests__/signOutPurge.test.tsx`; this
 * file pins the purge's own half.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionUserScope,
  purgePreviousUserClientState,
  purgeSignedOutUserClientState,
} from '../ActiveOrganizationStorage';

const LIST_KEY = 'list-layout:u_alice:account';
const GRID_KEY = 'grid-columns-account-account.all';
const GRID_KEY_NO_VIEW = 'grid-columns-account';

const LIST_LAYOUT = {
  viewOrder: ['account.all', 'account.mine'],
  perView: { 'account.all': { widths: { name: 240, amount: 120 }, rowHeight: 'compact' } },
};
const GRID_COLUMNS = { order: ['amount', 'name'], widths: { name: 160 } };

function put(key: string, value: unknown, store: Storage = localStorage) {
  store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  SessionUserScope._resetForTests();
});

describe('purgeSignedOutUserClientState keeps the list layout (objectstack#36110)', () => {
  it('keeps a list-layout and a grid-columns entry that hold layout only, byte for byte', () => {
    SessionUserScope.adopt('u_alice');
    put(LIST_KEY, LIST_LAYOUT);
    put(GRID_KEY, GRID_COLUMNS);
    put(GRID_KEY_NO_VIEW, { widths: { name: 90 } });
    put('list-filters:u_alice:account:all', { search: 'term' });

    purgeSignedOutUserClientState();

    expect(localStorage.getItem(LIST_KEY)).toBe(JSON.stringify(LIST_LAYOUT));
    expect(localStorage.getItem(GRID_KEY)).toBe(JSON.stringify(GRID_COLUMNS));
    expect(localStorage.getItem(GRID_KEY_NO_VIEW)).toBe(JSON.stringify({ widths: { name: 90 } }));
    expect(localStorage.getItem('list-filters:u_alice:account:all')).toBeNull();
  });

  it('keeps every row height the list offers', () => {
    for (const rowHeight of ['compact', 'short', 'medium', 'tall', 'extra_tall']) {
      const key = `list-layout:u_alice:obj_${rowHeight}`;
      put(key, { perView: { v: { rowHeight } } });
    }
    purgeSignedOutUserClientState();
    expect(Object.keys(localStorage).filter((k) => k.startsWith('list-layout:')).length).toBe(5);
  });

  // Each entry carries one part that is not layout. Each must go.
  const notOnlyLayout: Array<[string, string, unknown]> = [
    ['a filter beside the tab order', LIST_KEY, { viewOrder: ['a'], filters: [['status', '=', 'open']] }],
    ['a search term in a view', LIST_KEY, { perView: { a: { widths: { name: 1 }, search: 'acme' } } }],
    ['record data in a view', LIST_KEY, { perView: { a: { rows: [{ id: '1', name: 'Acme' }] } } }],
    ['a sort in a view', LIST_KEY, { perView: { a: { sort: [{ field: 'name', order: 'asc' }] } } }],
    ['a row height the list does not offer', LIST_KEY, { perView: { a: { rowHeight: 'Acme Corp, 555-0100' } } }],
    ['a width that is not a number', LIST_KEY, { perView: { a: { widths: { name: 'Acme' } } } }],
    ['a tab order holding objects', LIST_KEY, { viewOrder: [{ id: '1', name: 'Acme' }] }],
    ['a filter in the grid copy', GRID_KEY, { widths: { name: 1 }, filter: 'x' }],
    ['records in the grid copy', GRID_KEY, { order: ['name'], rows: [{ id: '1' }] }],
    ['a grid order holding objects', GRID_KEY, { order: [{ name: 'Acme' }] }],
    ['an array', GRID_KEY, [1, 2]],
    ['a bare string', LIST_KEY, '"Acme"'],
    ['text that is not JSON', GRID_KEY, 'not json'],
  ];
  it.each(notOnlyLayout)('removes an entry holding %s', (_label, key, value) => {
    put(key, value);
    purgeSignedOutUserClientState();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps the prefixes in localStorage only: the same keys in sessionStorage go', () => {
    put(LIST_KEY, LIST_LAYOUT, sessionStorage);
    put(GRID_KEY, GRID_COLUMNS, sessionStorage);
    purgeSignedOutUserClientState();
    expect(sessionStorage.getItem(LIST_KEY)).toBeNull();
    expect(sessionStorage.getItem(GRID_KEY)).toBeNull();
  });

  it('matches the families by prefix, not by a look-alike name', () => {
    put('list-layout-legacy:account', LIST_LAYOUT);
    put('grid-columns:account', GRID_COLUMNS);
    put('list-layouts:u_alice:account', LIST_LAYOUT);
    purgeSignedOutUserClientState();
    expect(localStorage.getItem('list-layout-legacy:account')).toBeNull();
    expect(localStorage.getItem('grid-columns:account')).toBeNull();
    expect(localStorage.getItem('list-layouts:u_alice:account')).toBeNull();
  });
});

describe('purgePreviousUserClientState keeps none of it (objectstack#36110)', () => {
  it('removes the list-layout and grid-columns entries on a change of user', () => {
    SessionUserScope.adopt('u_alice');
    put(LIST_KEY, LIST_LAYOUT);
    put(GRID_KEY, GRID_COLUMNS);

    purgeSignedOutUserClientState();
    expect(localStorage.getItem(LIST_KEY)).not.toBeNull();

    expect(SessionUserScope.adopt('u_bob')).toBe(true);
    expect(localStorage.getItem(LIST_KEY)).toBeNull();
    expect(localStorage.getItem(GRID_KEY)).toBeNull();
  });

  it('removes them when called directly', () => {
    put(LIST_KEY, LIST_LAYOUT);
    put(GRID_KEY, GRID_COLUMNS);
    purgePreviousUserClientState();
    expect(Object.keys(localStorage).filter((k) => /^(list-layout:|grid-columns-)/.test(k))).toEqual([]);
  });

  it('a re-adoption of the same person removes nothing', () => {
    SessionUserScope.adopt('u_alice');
    put(LIST_KEY, LIST_LAYOUT);
    purgeSignedOutUserClientState();
    SessionUserScope._resetForTests();
    expect(SessionUserScope.adopt('u_alice')).toBe(false);
    expect(localStorage.getItem(LIST_KEY)).toBe(JSON.stringify(LIST_LAYOUT));
  });
});
