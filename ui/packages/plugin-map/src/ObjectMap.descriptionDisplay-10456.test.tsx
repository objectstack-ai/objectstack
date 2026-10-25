/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10456 — a marker's `descriptionField` value reaches the popup, the
 * mobile record sheet and the search box as a display STRING.
 *
 * `ListMapConfigSchema.descriptionField` names any field, and a lookup is a
 * field like any other. `ObjectMap`'s own object fetch expands every declared
 * relation, so a lookup-typed description arrives as `{ id, name }`. The marker
 * transform used to copy that raw value onto the marker, and three readers
 * then treated it as text it never was:
 *
 *   - the popup and the mobile sheet put it in JSX as a React child, which
 *     throws `Objects are not valid as a React child` on the first click;
 *   - the search filter called `.toLowerCase()` on it, which throws for an
 *     object, a number or a boolean as soon as anyone types.
 *
 * The transform now derives the description once, through `@object-ui/core`'s
 * `recordDisplayValueAt`: the same resolver the marker TITLE already uses for
 * an authored `titleField` (step 0 of `getRecordDisplayName`). All three
 * readers read that one string.
 *
 * The bare-id arm is the control. An unexpanded lookup is a plain string and
 * rendered as text before the fix, so it must stay green when the fix is
 * removed, while the expanded arm goes red.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude, onClick }: any) => (
    <div
      data-testid="map-marker"
      data-lng={longitude}
      data-lat={latitude}
      onClick={() => onClick?.({ originalEvent: { stopPropagation() {} } })}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

/** The `map` block every arm declares: the description is bound to `owner`. */
const MAP = {
  latitudeField: 'latitude',
  longitudeField: 'longitude',
  titleField: 'site_name',
  descriptionField: 'owner',
};

/** An expanded lookup, as a server `$expand` returns the related record. */
const ACME = { id: 'a1', name: 'Acme' };
const GLOBEX = { id: 'g7', name: 'Globex' };

/**
 * One row per `owner` value. The titles share no substring with any owner, so
 * a search hit on an owner's name can only come from the description.
 */
const SITES = [
  { site_name: 'Harbour Depot', latitude: 47.6062, longitude: -122.3321 },
  { site_name: 'Ridge Yard', latitude: 37.7749, longitude: -122.4194 },
];
function rowsOwnedBy(owners: unknown[]) {
  return owners.map((owner, i) => ({ id: String(i + 1), ...SITES[i], owner }));
}

function mount(schema: Record<string, unknown>, dataSource?: unknown) {
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ObjectMap schema={schema as never} dataSource={dataSource as never} />
    </SchemaRendererProvider>,
  );
}

/** Mount over inline rows, which never fetch an object definition. */
async function mountInline(owners: unknown[]) {
  mount({ type: 'object-map', map: MAP, data: { provider: 'value', items: rowsOwnedBy(owners) } });
  await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(owners.length));
}

/** Click marker `index` and return the desktop popup. */
async function openPopup(index = 0) {
  fireEvent.click(screen.getAllByTestId('map-marker')[index]);
  await waitFor(() => expect(screen.queryByTestId('map-popup')).not.toBeNull());
  return screen.getByTestId('map-popup');
}

/** The popup's description line: the one paragraph under its title. */
function descriptionLine(container: HTMLElement): string | null {
  return container.querySelector('p')?.textContent ?? null;
}

function search(query: string) {
  fireEvent.change(screen.getByPlaceholderText('Search locations…'), { target: { value: query } });
}

describe('marker descriptions render as a display string (objectui#10456)', () => {
  const innerWidth = window.innerWidth;
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: innerWidth });
  });

  // ── THE CARD'S DEFECT ─────────────────────────────────────────────────────
  it('an expanded `{ id, name }` description renders its name, and the popup does not throw', async () => {
    await mountInline([ACME]);
    const popup = await openPopup();

    expect(within(popup).getByRole('heading').textContent).toBe('Harbour Depot');
    expect(descriptionLine(popup)).toBe('Acme');
  });

  // The route the card names: no host rows and no list, only `ObjectMap`'s
  // own object fetch, which expands every declared relation. The `$expand`
  // assertion proves the lookup really is requested expanded on this path.
  it("the reach path: the map's own fetch expands a lookup-typed description, and the popup shows its name", async () => {
    const dataSource = {
      find: vi.fn().mockResolvedValue(rowsOwnedBy([ACME])),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'site',
        fields: {
          site_name: { type: 'text' },
          owner: { type: 'lookup', reference: 'account' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
        },
      }),
    };

    mount({ type: 'object-map', map: MAP, data: { provider: 'object', object: 'site' } }, dataSource);
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));

    const params = dataSource.find.mock.calls.at(-1)?.[1];
    expect(params?.$expand).toContain('owner');

    const popup = await openPopup();
    expect(descriptionLine(popup)).toBe('Acme');
  });

  // ── THE CONTROL ───────────────────────────────────────────────────────────
  // An unexpanded lookup is its id, a plain string. It rendered before the fix
  // and must render the same after it.
  it('a bare id renders as text', async () => {
    await mountInline(['a1']);
    const popup = await openPopup();

    expect(descriptionLine(popup)).toBe('a1');
  });

  // The resolver's own definition of "no value": an expanded record none of
  // whose keys is a display name (a bare `{ id }` payload is not a name), and
  // a whitespace-only string. Each renders no description line, and neither
  // throws. This arm records the choice; the card's "(its display name, or
  // its id)" is met by the bare-id arm above.
  it('an expanded record with no display name, and a blank value, render no description line', async () => {
    await mountInline([{ id: 'a1' }, '   ']);

    const first = await openPopup(0);
    expect(within(first).getByRole('heading').textContent).toBe('Harbour Depot');
    expect(descriptionLine(first)).toBeNull();

    const second = await openPopup(1);
    expect(within(second).getByRole('heading').textContent).toBe('Ridge Yard');
    expect(descriptionLine(second)).toBeNull();
  });

  // ── THE SECOND READER ─────────────────────────────────────────────────────
  it('the mobile record sheet renders the same display name', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 500 });
    await mountInline([ACME]);

    fireEvent.click(screen.getAllByTestId('map-marker')[0]);
    const sheet = await screen.findByTestId('map-mobile-record-sheet');

    expect(screen.queryByTestId('map-popup')).toBeNull();
    expect(descriptionLine(sheet)).toBe('Acme');
  });

  // ── THE THIRD READER ──────────────────────────────────────────────────────
  it('the search matches on the displayed string of an expanded lookup', async () => {
    await mountInline([ACME, GLOBEX]);

    search('globex');
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(within(await openPopup()).getByRole('heading').textContent).toBe('Ridge Yard');

    search('ACME');
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(within(await openPopup()).getByRole('heading').textContent).toBe('Harbour Depot');
  });

  // A number and a boolean are values, not blanks, so each renders as its
  // string. `false` is the case the old `description && …` gate dropped.
  it('a number or a boolean description renders as its string', async () => {
    await mountInline([42, false]);

    expect(descriptionLine(await openPopup(0))).toBe('42');
    expect(descriptionLine(await openPopup(1))).toBe('false');
  });

  // The search reads the same string, instead of calling a string method on a
  // number or a boolean.
  it('the search over a number or a boolean description does not throw', async () => {
    await mountInline([42, false]);

    search('42');
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(within(await openPopup()).getByRole('heading').textContent).toBe('Harbour Depot');

    search('fals');
    await waitFor(() => expect(screen.getAllByTestId('map-marker')).toHaveLength(1));
    expect(within(await openPopup()).getByRole('heading').textContent).toBe('Ridge Yard');
  });
});
