/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LegacyReportRenderer as ReportRenderer } from '../LegacyReportRenderer';
import { ComponentRegistry } from '@object-ui/core';

// Mock ComponentRegistry
vi.mock('@object-ui/core', async () => {
    const actual = await vi.importActual('@object-ui/core');
    // We only want to mock ComponentRegistry, preserve others if needed.
    // However, since we import ComponentRegistry directly in the component, mocking the module is needed.
    // Note: SchemaRenderer in the component might also rely on registry, but ReportRenderer uses it directly for chart.
    return {
        ...actual,
        ComponentRegistry: {
            get: vi.fn(),
            register: vi.fn(),
            // `@object-ui/components`' placeholder registrar asks this before it
            // registers, at module load (objectui#11680). No stub is pending
            // in this suite, so every key answers false.
            hasLazy: vi.fn(() => false),
        }
    };
});

describe('ReportRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve specific chart component if registered', () => {
    const MockPieChart = () => <div>Pie Chart Mock</div>;
    (ComponentRegistry.get as any).mockImplementation((type: string) => {
        if (type === 'pie-chart') return MockPieChart;
        return null;
    });

    const schema: any = {
        type: 'report',
        chart: { type: 'pie-chart' }
    };

    render(<ReportRenderer schema={schema} />);
    expect(screen.getByText('Pie Chart Mock')).toBeInTheDocument();
  });

  it('should fallback to generic chart component if specific type not registered', () => {
     const MockGenericChart = () => <div>Generic Chart Mock</div>;
     (ComponentRegistry.get as any).mockImplementation((type: string) => {
         if (type === 'chart') return MockGenericChart;
         return null;
     });
 
     const schema: any = {
         type: 'report',
         chart: { type: 'fancy-line-chart' } 
     };
 
     render(<ReportRenderer schema={schema} />);
     expect(screen.getByText('Generic Chart Mock')).toBeInTheDocument();
     // Should have tried to get fancy-line-chart first
     expect(ComponentRegistry.get).toHaveBeenCalledWith('fancy-line-chart');
     expect(ComponentRegistry.get).toHaveBeenCalledWith('chart');
  });

  it('should show error if neither specific nor generic chart component found', () => {
    (ComponentRegistry.get as any).mockReturnValue(null);

    const schema: any = {
        type: 'report',
        chart: { type: 'unknown-chart' }
    };

    render(<ReportRenderer schema={schema} />);
    expect(screen.getByText(/Unknown component type: unknown-chart/)).toBeInTheDocument();
  });
});
