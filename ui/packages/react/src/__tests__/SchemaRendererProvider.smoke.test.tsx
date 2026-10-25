/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Smoke tests for SchemaRendererProvider.
 *
 * These tests ensure that every registered plugin component that calls
 * useSchemaContext() can render without throwing when wrapped in a
 * SchemaRendererProvider. This catches the class of errors reported in
 * Storybook ("useSchemaContext must be used within a SchemaRendererProvider").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererProvider, useSchemaContext } from '../context/SchemaRendererContext';
import type { BaseSchema, DataSource } from '@object-ui/types';
import { undeclaredNode } from '@object-ui/test-support';

/**
 * This file's registered context consumer, declared to `@object-ui/types` the
 * way an application declares a type it registers (objectui#11466): a node
 * slot and the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'test-ctx-consumer': BaseSchema;
  }
}

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are placeholders for a provider that merely has to EXIST, and one probe
 * that pins the empty-object case by name.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

// Suppress console.error from React error boundary during tests
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

// Helper: a component that calls useSchemaContext (mimics plugin pattern)
const ContextConsumer: React.FC<any> = () => {
  const { dataSource } = useSchemaContext();
  return <div data-testid="ctx-consumer">dataSource: {JSON.stringify(dataSource)}</div>;
};

describe('useSchemaContext provider requirement', () => {
  it('should throw when used outside SchemaRendererProvider', () => {
    expect(() => render(<ContextConsumer schema={{}} />)).toThrow(
      'useSchemaContext must be used within a SchemaRendererProvider'
    );
  });

  it('should not throw when used inside SchemaRendererProvider', () => {
    render(
      <SchemaRendererProvider dataSource={{ test: true } as unknown as DataSource}>
        <ContextConsumer schema={{}} />
      </SchemaRendererProvider>
    );
    expect(screen.getByTestId('ctx-consumer')).toHaveTextContent('dataSource: {"test":true}');
  });

  it('should fall back to empty dataSource when provider has empty object', () => {
    render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
        <ContextConsumer schema={{}} />
      </SchemaRendererProvider>
    );
    expect(screen.getByTestId('ctx-consumer')).toHaveTextContent('dataSource: {}');
  });
});

describe('SchemaRendererProvider apiFetch inheritance (#2725)', () => {
  const ApiFetchProbe: React.FC = () => {
    const { apiFetch } = useSchemaContext();
    return <div data-testid="api-fetch-probe">{(apiFetch as any)?.__name ?? 'none'}</div>;
  };

  const namedFetch = (name: string) => {
    const fn = (async () => new Response('{}')) as any;
    fn.__name = name;
    return fn;
  };

  it('nested provider without apiFetch inherits the parent host fetch', () => {
    render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource} apiFetch={namedFetch('host')}>
        <SchemaRendererProvider dataSource={{ inner: true } as unknown as DataSource}>
          <ApiFetchProbe />
        </SchemaRendererProvider>
      </SchemaRendererProvider>
    );
    expect(screen.getByTestId('api-fetch-probe')).toHaveTextContent('host');
  });

  it('nested provider with its own apiFetch overrides the parent', () => {
    render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource} apiFetch={namedFetch('host')}>
        <SchemaRendererProvider dataSource={{} as unknown as DataSource} apiFetch={namedFetch('inner')}>
          <ApiFetchProbe />
        </SchemaRendererProvider>
      </SchemaRendererProvider>
    );
    expect(screen.getByTestId('api-fetch-probe')).toHaveTextContent('inner');
  });

  it('apiFetch stays undefined when no provider supplies one', () => {
    render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
        <ApiFetchProbe />
      </SchemaRendererProvider>
    );
    expect(screen.getByTestId('api-fetch-probe')).toHaveTextContent('none');
  });
});

describe('SchemaRenderer + SchemaRendererProvider integration', () => {
  beforeEach(() => {
    ComponentRegistry.register('test-ctx-consumer', ContextConsumer);
  });

  afterEach(() => {
    ComponentRegistry.unregister?.('test-ctx-consumer');
  });

  it('should render a component that calls useSchemaContext without error when provider wraps the tree', () => {
    render(
      <SchemaRendererProvider dataSource={{ foo: 'bar' } as unknown as DataSource}>
        <SchemaRenderer schema={{ type: 'test-ctx-consumer' }} />
      </SchemaRendererProvider>
    );
    expect(screen.getByTestId('ctx-consumer')).toHaveTextContent('dataSource: {"foo":"bar"}');
  });

  it('should show error boundary fallback (not crash) when provider is missing', () => {
    // Without a provider, the SchemaErrorBoundary catches the throw
    render(
      <SchemaRenderer schema={{ type: 'test-ctx-consumer' }} />
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/failed to render/i)).toBeInTheDocument();
  });
});

describe('Plugin component types render inside provider', () => {
  // This test ensures all registered plugin types that use useSchemaContext
  // can at least mount without throwing inside a SchemaRendererProvider.
  const pluginTypes = [
    'kanban',
    'object-kanban',
    'timeline',
    'object-timeline',
    'object-grid',
    'object-calendar',
    'object-map',
    'chart',
    'object-gantt',
  ];

  for (const type of pluginTypes) {
    it(`type="${type}" should not throw inside SchemaRendererProvider`, () => {
      const component = ComponentRegistry.get(type);
      if (!component) {
        // Component not registered in test environment — skip
        return;
      }

      // Render via SchemaRenderer inside provider. A bare `{ type }` on purpose:
      // the node carries none of its type's required props, so it crosses
      // through the one test helper for undeclared input (objectui#11466).
      const { container } = render(
        <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
          <SchemaRenderer schema={undeclaredNode({ type })} />
        </SchemaRendererProvider>
      );

      // Should NOT show the error boundary alert
      const alerts = container.querySelectorAll('[role="alert"]');
      const providerErrors = Array.from(alerts).filter((el) =>
        el.textContent?.includes('useSchemaContext must be used within')
      );
      expect(providerErrors).toHaveLength(0);
    });
  }
});
