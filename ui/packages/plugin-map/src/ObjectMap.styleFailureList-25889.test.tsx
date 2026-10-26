/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25889 — a style or tile load failure swaps the map for the record
 * list, with a notice that says what happened and who can fix it.
 *
 * A deployment whose network cannot reach the tile host (an intranet, a
 * proxy, a policy that forbids third-party hosts) used to keep a grey canvas
 * with the markers floating over nothing, under an English alert that sent the
 * reader to a "search box" listing that did not exist and to a "custom map
 * style for production use" setting that does not exist either.
 *
 * The map here is a stub that stands in for react-map-gl: it mounts like the
 * real one (an effect whose cleanup is the real one's `map.remove()`), and it
 * fires `onError` the way MapLibre's `error` event reaches react-map-gl. The
 * cleanup counter is what makes the unmount path readable: swapping the map out
 * must remove it exactly once, and unmounting the view afterwards must not
 * reach into a map that is already gone.
 */

import React, { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ObjectMapSchema } from '@object-ui/types';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

type Slot = { children?: React.ReactNode };

const lifecycle = { mounts: 0, removes: 0 };

vi.mock('react-map-gl/maplibre', () => ({
  default: function StubMap(
    props: Slot & { mapStyle?: string; onError?: (e: { error?: Error }) => void },
  ) {
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => {
        lifecycle.removes += 1;
      };
    }, []);
    return (
      <div aria-label="Map" data-map-style={props.mapStyle}>
        <button
          type="button"
          data-testid="simulate-style-error"
          onClick={() =>
            props.onError?.({
              error: new Error(`AJAXError: Failed to fetch (0): ${props.mapStyle}`),
            })
          }
        />
        <button type="button" data-testid="simulate-bare-error" onClick={() => props.onError?.({})} />
        {props.children}
      </div>
    );
  },
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: Slot) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: Slot) => <div data-testid="map-popup">{children}</div>,
}));

/** Stands in for the page's error boundary: what it catches is the crash card. */
class CrashCard extends React.Component<
  { onCatch: (error: Error) => void; children: React.ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onCatch(error);
  }
  render() {
    return this.state.crashed ? <div data-testid="crash-card" /> : this.props.children;
  }
}

const records = [
  { id: 't1', title: 'Install rooftop unit', notes: 'North wing', location: { lat: 47.6062, lng: -122.3321 } },
  { id: 't2', title: 'Replace boiler', notes: 'Basement', location: { lat: 45.5152, lng: -122.6784 } },
];

const MAP = { locationField: 'location', titleField: 'title', descriptionField: 'notes' };
const schema: ObjectMapSchema = { type: 'object-map', map: MAP };

let caught: Error[];

beforeEach(() => {
  lifecycle.mounts = 0;
  lifecycle.removes = 0;
  caught = [];
});

function mount(props: Partial<React.ComponentProps<typeof ObjectMap>> = {}) {
  return render(
    <CrashCard onCatch={(error) => caught.push(error)}>
      <ObjectMap schema={schema} data={records} {...props} />
    </CrashCard>,
  );
}

async function failStyle(testId = 'simulate-style-error') {
  await screen.findByLabelText('Map');
  fireEvent.click(screen.getByTestId(testId));
  return screen.findByTestId('map-style-fallback');
}

describe('ObjectMap — a style or tile failure degrades to the record list (objectstack#25889)', () => {
  it('replaces the map with the record list, removing the map exactly once', async () => {
    mount();
    const list = await failStyle();

    expect(screen.queryByLabelText('Map')).toBeNull();
    expect(screen.queryAllByTestId('map-marker')).toHaveLength(0);
    expect(lifecycle).toEqual({ mounts: 1, removes: 1 });
    expect(list).toHaveTextContent('Install rooftop unit');
    expect(screen.getByRole('button', { name: /Replace boiler/ })).toHaveTextContent('Basement');
    // Not the WebGL2 case: that one has its own notice and no retry.
    expect(screen.queryByTestId('map-webgl2-fallback')).toBeNull();
    expect(caught).toEqual([]);
  });

  it('the notice keeps MapLibre’s reason and sends the default-style reader to an administrator', async () => {
    mount();
    await failStyle();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Map failed to load (AJAXError: Failed to fetch (0): https://demotiles.maplibre.org/style.json).',
    );
    expect(alert).toHaveTextContent('The records are listed below');
    expect(alert).toHaveTextContent('ask your administrator to set a map style for this view');
    // The two claims the old alert made and nothing delivered.
    expect(alert.textContent).not.toMatch(/search box/);
    expect(alert.textContent).not.toMatch(/production/);
  });

  it('a view with its own style is told to check that style', async () => {
    mount({ schema: { ...schema, map: { ...MAP, style: 'https://tiles.example.com/style.json' } } });
    await failStyle();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('(AJAXError: Failed to fetch (0): https://tiles.example.com/style.json)');
    expect(alert).toHaveTextContent('check the map style URL set on this view');
    expect(alert.textContent).not.toMatch(/administrator/);
  });

  it('an error event with no message still names a reason', async () => {
    mount();
    await failStyle('simulate-bare-error');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Map failed to load (the map style or tiles could not be loaded).',
    );
  });

  it('keeps the listed records searchable', async () => {
    mount();
    await failStyle();

    fireEvent.change(screen.getByPlaceholderText('Search locations…'), { target: { value: 'boiler' } });

    expect(screen.getByRole('button', { name: /Replace boiler/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Install rooftop unit/ })).toBeNull();
  });

  it('a listed record takes the marker click path', async () => {
    const onMarkerClick = vi.fn();
    const onRowClick = vi.fn();
    mount({ onMarkerClick, onRowClick });
    await failStyle();

    fireEvent.click(screen.getByRole('button', { name: /Install rooftop unit/ }));

    expect(onMarkerClick).toHaveBeenCalledWith(records[0]);
    expect(onRowClick).toHaveBeenCalledWith(records[0], undefined);
  });

  it('“Try the map again” mounts a fresh map with its markers', async () => {
    mount();
    await failStyle();

    fireEvent.click(screen.getByTestId('map-style-retry'));

    expect(await screen.findByLabelText('Map')).toBeInTheDocument();
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
    expect(screen.queryByTestId('map-style-fallback')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(lifecycle).toEqual({ mounts: 2, removes: 1 });
  });

  it('unmounts cleanly after degrading: the removed map is not removed again', async () => {
    const { unmount } = mount();
    await failStyle();

    expect(() => unmount()).not.toThrow();
    expect(lifecycle).toEqual({ mounts: 1, removes: 1 });
    expect(caught).toEqual([]);
  });

  it('the excluded-records notice reads the bundle’s English default', async () => {
    mount({ data: [...records, { id: 't3', title: 'No coordinates' }] });
    await screen.findByLabelText('Map');

    await waitFor(() =>
      expect(
        screen.getByText('Records excluded from the map for missing or invalid coordinates: 1'),
      ).toBeInTheDocument(),
    );
  });
});
