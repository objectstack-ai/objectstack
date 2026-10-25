import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';
import * as ObjectGridModule from './ObjectGrid';
import { ObjectGridRenderer } from './index';

describe('Plugin Grid Registration', () => {
  it('renderer passes dataSource from context', async () => {
    // Spy and mock implementation
    vi.spyOn(ObjectGridModule, 'ObjectGrid').mockImplementation(
      (({ dataSource }: any) => (
        <div data-testid="grid-mock">
            {dataSource ? `DataSource: ${dataSource.type}` : 'No DataSource'}
        </div>
      )) as any
    );

    render(
      <SchemaRendererProvider dataSource={{ type: 'mock-datasource' } as any}>
        <ObjectGridRenderer schema={{ type: 'object-grid' }} />
      </SchemaRendererProvider>
    );
    
    // Use findByTestId for async safety
    const element = await screen.findByTestId('grid-mock', {}, { timeout: 5000 });
    expect(element).toHaveTextContent('DataSource: mock-datasource');
  });
});
