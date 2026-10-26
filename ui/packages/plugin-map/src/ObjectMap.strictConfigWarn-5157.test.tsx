/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5157 — the RUNTIME face of `ObjectMapConfigSchema.strict()`.
 *
 * Ruled letter A on objectui#5157: the schema closes, so `safeValidateSchema`
 * refuses an undeclared `map` key (pinned in `@object-ui/types`'
 * `object-map-config-strict-5157.test.ts`), while the component itself keeps
 * the channel it already had — it RENDERS, and `getMapConfig`'s `safeParse`
 * of the block now fails and `console.warn`s the issue. Warn, not throw: a
 * document the validator refuses still draws on a running page.
 *
 * Before the strict schema the same block parsed clean with the key stripped,
 * so this warning never fired: the card's symptom was a quiet console: no
 * warning named the key. The pin therefore reads the warning's ARGUMENTS, not its first line —
 * the key arrives in the formatted issue passed after the prefix string.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ObjectMapSchema } from '@object-ui/types';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

type Slot = { children?: React.ReactNode };

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: Slot) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: Slot) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude }: Slot & { longitude: number; latitude: number }) => (
    <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: Slot) => <div data-testid="map-popup">{children}</div>,
}));

/** The card's own typo: `latitudeFieId`, capital i where the l belongs. */
const TYPO_KEY = 'latitudeFieId';

const ROWS = [{ id: '1', name: 'Ferry Building', location: { lat: 37.7955, lng: -122.3937 } }];

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

/** Every argument of every `[ObjectMap] Invalid map configuration` call, serialised. */
const invalidConfigWarnings = () =>
  warnSpy.mock.calls
    .filter((args: unknown[]) => String(args[0]).includes('[ObjectMap] Invalid map configuration'))
    .map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

const renderMap = async (map: Record<string, unknown>) => {
  const schema = { type: 'object-map', staticData: ROWS, map } as unknown as ObjectMapSchema;
  const utils = render(<ObjectMap schema={schema} />);
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  return utils;
};

describe('(i) an undeclared `map` key still renders, and the warning names it (objectui#5157)', () => {
  it('renders the map and places the marker the declared keys bind', async () => {
    await renderMap({ locationField: 'location', titleField: 'name', [TYPO_KEY]: 'lat' });

    expect(screen.getByLabelText('Map')).toBeTruthy();
    const markers = screen.getAllByTestId('map-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute('data-lat', '37.7955');
  });

  it('warns through the existing channel, naming the undeclared key', async () => {
    await renderMap({ locationField: 'location', titleField: 'name', [TYPO_KEY]: 'lat' });

    const warned = invalidConfigWarnings();
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.join('\n')).toContain(TYPO_KEY);
  });

  it('says nothing about the configuration when every key is declared (control)', async () => {
    await renderMap({ locationField: 'location', titleField: 'name' });

    expect(screen.getAllByTestId('map-marker')).toHaveLength(1);
    expect(invalidConfigWarnings()).toEqual([]);
  });
});
