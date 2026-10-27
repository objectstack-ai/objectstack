/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26163 — a map view with no style of its own draws the
 * deployment's default style before the public demo one.
 *
 * The operator names the deployment's style in `OS_CONSOLE_MAP_STYLE_URL`; the
 * runtime serves it as `mapStyleUrl` on `GET /api/v1/runtime/config`
 * (objectstack#26001), and the Console hands it to the renderer through
 * `HostMapStyleProvider` from `@object-ui/react`. The order is:
 *
 *   1. the view's own style (`mapStyle`, then `map.style`);
 *   2. the deployment's style, from the host;
 *   3. the public demo style.
 *
 * A host that provides nothing (no env set, an embedded renderer) keeps the
 * demo style, and a view's own style still wins over the deployment's. When the
 * deployment's style fails to load, the notice names that style as the one that
 * failed, never the public default tiles the map did not draw.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HostMapStyleProvider } from '@object-ui/react';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

let capturedProps: any = null;

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => {
    capturedProps = props;
    return (
      <div aria-label="Map">
        <button
          type="button"
          data-testid="simulate-map-error"
          onClick={() => props.onError?.({ error: new Error(`Failed to fetch ${props.mapStyle}`) })}
        />
        {props.children}
      </div>
    );
  },
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';
const DEPLOYMENT_STYLE = 'https://tiles.intranet.example/styles/basic/style.json';
const VIEW_STYLE = 'https://tiles.example.com/view-style.json';

const records = [{ id: '1', name: 'Loc 1', latitude: 40, longitude: -74 }];
const MAP = { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' };

function mount(schema: any, hostStyle?: string, withProvider = true) {
  const map = <ObjectMap schema={{ type: 'object-map', ...schema }} data={records} />;
  return render(withProvider ? <HostMapStyleProvider styleUrl={hostStyle}>{map}</HostMapStyleProvider> : map);
}

async function drawnStyle() {
  await screen.findByLabelText('Map');
  await waitFor(() => expect(capturedProps).not.toBeNull());
  return capturedProps.mapStyle;
}

beforeEach(() => {
  capturedProps = null;
});

describe('ObjectMap — the deployment default map style (objectstack#26163)', () => {
  it('env set, no view style: draws the deployment style', async () => {
    mount({ map: MAP }, DEPLOYMENT_STYLE);
    expect(await drawnStyle()).toBe(DEPLOYMENT_STYLE);
  });

  it('env set, no view style, flat-form config: draws the deployment style', async () => {
    mount({ latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' }, DEPLOYMENT_STYLE);
    expect(await drawnStyle()).toBe(DEPLOYMENT_STYLE);
  });

  it('env unset (the host provides no style): draws the public demo style', async () => {
    mount({ map: MAP }, undefined);
    expect(await drawnStyle()).toBe(DEMO_STYLE);
  });

  it('no host provider at all: draws the public demo style', async () => {
    mount({ map: MAP }, undefined, false);
    expect(await drawnStyle()).toBe(DEMO_STYLE);
  });

  it('a view’s own `mapStyle` wins over the deployment style', async () => {
    mount({ mapStyle: VIEW_STYLE, map: MAP }, DEPLOYMENT_STYLE);
    expect(await drawnStyle()).toBe(VIEW_STYLE);
  });

  it('a view’s own `map.style` wins over the deployment style', async () => {
    mount({ map: { ...MAP, style: VIEW_STYLE } }, DEPLOYMENT_STYLE);
    expect(await drawnStyle()).toBe(VIEW_STYLE);
  });

  it('a failed deployment style names the deployment style, not the public default tiles', async () => {
    mount({ map: MAP }, DEPLOYMENT_STYLE);
    await drawnStyle();
    fireEvent.click(screen.getByTestId('simulate-map-error'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Map failed to load (Failed to fetch ${DEPLOYMENT_STYLE}).`);
    expect(alert).toHaveTextContent('the default map style set for this deployment could not be loaded here');
    expect(alert).not.toHaveTextContent('public default map tiles');
    expect(alert).not.toHaveTextContent('check the map style URL set on this view');
  });

  it('a failed view style still sends the reader to the view, with a deployment style present', async () => {
    mount({ mapStyle: VIEW_STYLE, map: MAP }, DEPLOYMENT_STYLE);
    await drawnStyle();
    fireEvent.click(screen.getByTestId('simulate-map-error'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('check the map style URL set on this view');
  });
});
