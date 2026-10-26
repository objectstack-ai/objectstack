/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression: a failed MapLibre style/tile load used to render a blank map
 * with no indication anything went wrong. `onError` now surfaces a banner,
 * and a schema-configured `style` overrides the public demo default.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
          onClick={() => props.onError?.({ error: new Error('Failed to fetch') })}
        />
        {props.children}
      </div>
    );
  },
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

const mockData = [{ id: '1', name: 'Loc 1', latitude: 40, longitude: -74 }];

describe('ObjectMap — style/load-failure fallback', () => {
  // Spelled `mapStyle`, not `style`: this case pre-dates the naming and used the
  // top-level `style` leg, which objectui#5017 deleted (it is `BaseSchema.style`,
  // inline CSS). The behaviour under test — a configured style beats the public
  // demo default — is unchanged and its assertion is untouched; only the key it
  // is configured with moved to the declared name. The deleted leg's own verdict
  // is pinned in `ObjectMap.topLevelStyle.test.tsx`.
  it('uses the configured style over the public demo default', async () => {
    const schema: any = {
      type: 'map',
      mapStyle: 'https://tiles.example.com/style.json',
      map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
      data: { provider: 'value', items: mockData },
    };
    render(<ObjectMap schema={schema} />);
    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    expect(capturedProps.mapStyle).toBe('https://tiles.example.com/style.json');
  });

  it('falls back to the public demo style when none is configured', async () => {
    const schema: any = {
      type: 'map',
      map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
      data: { provider: 'value', items: mockData },
    };
    render(<ObjectMap schema={schema} />);
    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    expect(capturedProps.mapStyle).toBe('https://demotiles.maplibre.org/style.json');
  });

  it('shows a degraded-state banner when the style/tiles fail to load', async () => {
    const schema: any = {
      type: 'map',
      map: { latitudeField: 'latitude', longitudeField: 'longitude', titleField: 'name' },
      data: { provider: 'value', items: mockData },
    };
    render(<ObjectMap schema={schema} />);
    await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByTestId('simulate-map-error'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Map failed to load/);
  });
});
