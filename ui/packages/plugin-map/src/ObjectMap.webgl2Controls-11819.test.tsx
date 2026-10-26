/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11819 — the controls for `ObjectMap.webgl2Fallback-11819.test.tsx`:
 * what the WebGL2 probe must NOT change.
 *
 *   - A browser that answers the probe mounts the map, markers and all, and
 *     shows no fallback list.
 *   - A style or tile failure is a different, non-fatal case: the map keeps
 *     running, so it keeps its markers and gains the alert over them.
 *   - The probe is asked once per mount and hands its context straight back.
 *
 * The map is the stub the sibling tests use; `./__tests__/webgl2Available`
 * supplies the WebGL2 context that stub stands for.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ObjectMapSchema } from '@object-ui/types';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

type Slot = { children?: React.ReactNode };

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: Slot & { onError?: (e: { error: Error }) => void }) => (
    <div aria-label="Map">
      <button
        type="button"
        data-testid="simulate-style-error"
        onClick={() => props.onError?.({ error: new Error('Failed to fetch') })}
      />
      {props.children}
    </div>
  ),
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: Slot) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: Slot) => <div data-testid="map-popup">{children}</div>,
}));

const records = [
  { id: 't1', title: 'Install rooftop unit', location: { lat: 47.6062, lng: -122.3321 } },
  { id: 't2', title: 'Replace boiler', location: { lat: 45.5152, lng: -122.6784 } },
];

const schema: ObjectMapSchema = { type: 'object-map', map: { locationField: 'location', titleField: 'title' } };

describe('ObjectMap with WebGL2 — what the probe leaves alone (objectui#11819)', () => {
  it('mounts the map with its markers and no fallback list', async () => {
    render(<ObjectMap schema={schema} data={records} />);

    expect(await screen.findByLabelText('Map')).toBeInTheDocument();
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
    expect(screen.queryByTestId('map-webgl2-fallback')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a style or tile failure keeps the map and its markers, with the alert over them', async () => {
    render(<ObjectMap schema={schema} data={records} />);
    await screen.findByLabelText('Map');

    fireEvent.click(screen.getByTestId('simulate-style-error'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Map failed to load (Failed to fetch)');
    expect(screen.getByLabelText('Map')).toBeInTheDocument();
    expect(screen.getAllByTestId('map-marker')).toHaveLength(2);
    expect(screen.queryByTestId('map-webgl2-fallback')).toBeNull();
  });

  it('asks for WebGL2 once per mount and releases the probe context', async () => {
    const loseContext = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((contextId: string) =>
        contextId === 'webgl2'
          ? ({ getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null) } as unknown)
          : null) as typeof HTMLCanvasElement.prototype.getContext);
    const webgl2Asks = () => getContext.mock.calls.filter(([contextId]) => contextId === 'webgl2').length;

    render(<ObjectMap schema={schema} data={records} />);
    await screen.findByLabelText('Map');
    // A re-render of the mounted map (search typing re-renders it) asks nothing new.
    fireEvent.change(screen.getByPlaceholderText('Search locations…'), { target: { value: 'boiler' } });
    expect(screen.getAllByTestId('map-marker')).toHaveLength(1);

    expect(webgl2Asks()).toBe(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
