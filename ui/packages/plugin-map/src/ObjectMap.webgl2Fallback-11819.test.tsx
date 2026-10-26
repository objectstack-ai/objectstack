/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11819 — a browser without WebGL2 gets the map's own fallback, not a
 * crash card.
 *
 * ⛔ No stub of `react-map-gl/maplibre` here, deliberately. This file runs the
 * REAL react-map-gl over the REAL MapLibre, with the canvas answering `null`
 * for `webgl2` — a browser without WebGL2 — so a map that is mounted anyway
 * fails exactly as the card measured it: MapLibre's `GPUInitializationError`
 * from `_setupPainter`, the `Marker` children's `map.project` throwing on the
 * painter-less map, and the unmount's `map.remove()` throwing
 * `(reading 'destroy')`. A stubbed map cannot crash that way, so it could not
 * show that the guard is what stops the crash.
 */

import React from 'react';
// MapLibre, loaded at module scope under the specifier react-map-gl's own
// `import()` resolves — so a regression that mounts the real map crashes
// inside this file's waits, not after them (AGENTS.md, test discipline: a
// module load never runs inside a bounded window).
import 'maplibre-gl';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { ObjectMapSchema } from '@object-ui/types';
import { ObjectMap } from './ObjectMap';

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

const schema: ObjectMapSchema = {
  type: 'object-map',
  map: { locationField: 'location', titleField: 'title', descriptionField: 'notes' },
};

let caught: Error[];
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  caught = [];
  // No WebGL2 — stated here rather than left to happy-dom's canvas, which
  // answers `null` for every context type today. Other types keep its answer.
  const happyDomGetContext = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ) {
    return contextId === 'webgl2'
      ? null
      : (happyDomGetContext as (id: string, opts?: unknown) => RenderingContext | null).call(this, contextId, options);
  } as typeof HTMLCanvasElement.prototype.getContext);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(props: Partial<React.ComponentProps<typeof ObjectMap>> = {}) {
  return render(
    <CrashCard onCatch={(error) => caught.push(error)}>
      <ObjectMap schema={schema} data={records} {...props} />
    </CrashCard>,
  );
}

/** The errors MapLibre printed: a map was constructed without a painter. */
const gpuErrorsPrinted = () =>
  consoleError.mock.calls.filter(([first]: unknown[]) => (first as Error | undefined)?.name === 'GPUInitializationError');

describe('ObjectMap without WebGL2 (objectui#11819)', () => {
  it('shows the "Map failed to load" alert naming WebGL2 and lists the records, constructing no map', async () => {
    const { container } = mount();

    // Settled into one of the two outcomes; the crash, if that is the one, is
    // read first so a failure here names what was thrown.
    await waitFor(() => expect(screen.queryByRole('alert') ?? screen.queryByTestId('crash-card')).not.toBeNull());
    expect(caught.map((error) => error.message)).toEqual([]);
    expect(gpuErrorsPrinted()).toEqual([]);
    expect(container.querySelector('.maplibregl-map')).toBeNull();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Map failed to load');
    expect(alert).toHaveTextContent('WebGL2');
    expect(screen.getByRole('button', { name: /Install rooftop unit/ })).toHaveTextContent('North wing');
    expect(screen.getByRole('button', { name: /Replace boiler/ })).toHaveTextContent('Basement');
  });

  it('keeps the records searchable: the search box narrows the list', async () => {
    mount();
    await screen.findByRole('alert');

    fireEvent.change(screen.getByPlaceholderText('Search locations…'), { target: { value: 'boiler' } });

    expect(screen.getByRole('button', { name: /Replace boiler/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Install rooftop unit/ })).toBeNull();
  });

  it('a listed record takes the marker click path', async () => {
    const onMarkerClick = vi.fn();
    const onRowClick = vi.fn();
    mount({ onMarkerClick, onRowClick });
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: /Install rooftop unit/ }));

    expect(onMarkerClick).toHaveBeenCalledWith(records[0]);
    expect(onRowClick).toHaveBeenCalledWith(records[0], undefined);
  });

  it('unmounts cleanly: nothing calls into a map that never started', async () => {
    const { unmount } = mount();
    await screen.findByRole('alert');

    expect(() => unmount()).not.toThrow();
    expect(caught).toEqual([]);
    expect(gpuErrorsPrinted()).toEqual([]);
  });
});
