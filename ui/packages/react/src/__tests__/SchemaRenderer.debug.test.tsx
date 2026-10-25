/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererProvider } from '../context/SchemaRendererContext';
import type { BaseSchema, DataSource } from '@object-ui/types';

/**
 * This file's registered `TestDiv`, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'test-debug-div': BaseSchema;
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

// Suppress console.warn from deprecated namespace registration
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = vi.fn();
});
afterEach(() => {
  console.warn = originalWarn;
});

// A simple test component that passes all props through to a div
const TestDiv: React.FC<any> = (props) => {
  const { schema, ...rest } = props;
  return <div data-testid="test-div" {...rest} />;
};

describe('SchemaRenderer debug attributes', () => {
  beforeEach(() => {
    ComponentRegistry.register('test-debug-div', TestDiv);
  });

  it('should NOT inject data-debug-* attributes when debug is off', () => {
    const { getByTestId } = render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource}>
        <SchemaRenderer schema={{ type: 'test-debug-div', id: 'myBtn' }} />
      </SchemaRendererProvider>,
    );
    const el = getByTestId('test-div');
    expect(el.getAttribute('data-debug-type')).toBeNull();
    expect(el.getAttribute('data-debug-id')).toBeNull();
  });

  it('should inject data-debug-type when debug is enabled', () => {
    const { getByTestId } = render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource} debug={true}>
        <SchemaRenderer schema={{ type: 'test-debug-div', id: 'myBtn' }} />
      </SchemaRendererProvider>,
    );
    const el = getByTestId('test-div');
    expect(el.getAttribute('data-debug-type')).toBe('test-debug-div');
    expect(el.getAttribute('data-debug-id')).toBe('myBtn');
  });

  it('should inject data-debug-type when debugFlags.enabled is true', () => {
    const { getByTestId } = render(
      <SchemaRendererProvider dataSource={{} as unknown as DataSource} debugFlags={{ enabled: true }}>
        <SchemaRenderer schema={{ type: 'test-debug-div' }} />
      </SchemaRendererProvider>,
    );
    const el = getByTestId('test-div');
    expect(el.getAttribute('data-debug-type')).toBe('test-debug-div');
    // No id on schema, so data-debug-id should not be present
    expect(el.getAttribute('data-debug-id')).toBeNull();
  });
});
