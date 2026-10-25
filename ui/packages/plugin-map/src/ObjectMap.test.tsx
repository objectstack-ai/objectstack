import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectMap } from './ObjectMap';
import { DataSource } from '@object-ui/types';
import './__tests__/webgl2Available';

// Mock react-map-gl/maplibre components to check they are receiving the right props/children
// without relying on real WebGL canvas rendering.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: any) => <div aria-label="Map">{children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude, onClick }: any) => (
      <div 
        data-testid="map-marker" 
        data-lat={latitude} 
        data-lng={longitude}
        onClick={onClick}
      >
        {children}
      </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

const mockData = [
  { id: '1', name: 'Loc 1', latitude: 40, longitude: -74 },
  { id: '2', name: 'Loc 2', latitude: 41, longitude: -75 },
];

const mockDataSource: DataSource = {
  find: vi.fn(),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(),
};

describe('ObjectMap', () => {
    it('renders with static value provider', async () => {
        const schema: any = {
            type: 'map',
            map: {
                latitudeField: 'latitude',
                longitudeField: 'longitude',
                titleField: 'name'
            },
            data: {
                provider: 'value',
                items: mockData
            }
        };

        render(<ObjectMap schema={schema} />);
        
        // Wait for loading to finish
        await waitFor(() => {
            expect(screen.queryByText('Loading map...')).toBeNull();
        });

        // Check if map is rendered
        expect(screen.getByLabelText('Map')).toBeDefined();
        
        // Check if markers are rendered using testid from our mock
        await waitFor(() => {
            const markers = screen.getAllByTestId('map-marker');
            expect(markers).toHaveLength(2);
            // Verify coordinates of first marker
            expect(markers[0]).toHaveAttribute('data-lat', '40');
            expect(markers[0]).toHaveAttribute('data-lng', '-74');
        });

        // Check content inside marker (the emoji)
        expect(screen.getAllByText('📍')).toHaveLength(2);
    });

    it('fetches data with object provider', async () => {
        (mockDataSource.find as any).mockResolvedValue({ data: mockData });
        
        const schema: any = {
            type: 'map',
            map: {
                latitudeField: 'latitude',
                longitudeField: 'longitude',
                titleField: 'name'
            },
            data: {
                provider: 'object',
                object: 'locations'
            }
        };

        render(<ObjectMap schema={schema} dataSource={mockDataSource} />);

        // Wait for loading to finish
        await waitFor(() => {
            expect(screen.queryByText('Loading map...')).toBeNull();
        });
        
        // Verify dataSource.find was called
        expect(mockDataSource.find).toHaveBeenCalledWith('locations', expect.anything());

        // Check markers
        await waitFor(() => {
            const markers = screen.getAllByTestId('map-marker');
            expect(markers).toHaveLength(2);
        });
    });
});
