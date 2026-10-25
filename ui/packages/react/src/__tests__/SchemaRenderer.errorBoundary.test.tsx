/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { BaseSchema } from '@object-ui/types';
import { SchemaRenderer, SchemaErrorBoundary } from '../SchemaRenderer';

/**
 * This file's registered widgets, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'crashing-widget': BaseSchema;
    'stable-widget': StableWidgetNode;
  }
}

// Suppress console.error from React error boundary during tests
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

const CrashingWidget: React.FC = () => {
  throw new Error('Widget exploded!');
};

const StableWidget: React.FC<any> = (props) => (
  <div data-testid="stable-widget">{props.content || 'Stable'}</div>
);

/**
 * The node a `stable-widget` case authors (objectui#11349): `BaseSchema` plus
 * the `content` that `StableWidget` renders. Each literal is checked against
 * this node rather than against the `BaseSchema` the `schema` prop accepts, so
 * `content` stays checked now that objectui#8347 has removed `BaseSchema`'s
 * index signature.
 */
type StableWidgetNode = BaseSchema & { type: 'stable-widget'; content?: string };
const stableWidget = (schema: StableWidgetNode): StableWidgetNode => schema;

describe('SchemaErrorBoundary', () => {
  it('should render children normally when no error', () => {
    render(
      <SchemaErrorBoundary>
        <div data-testid="child">OK</div>
      </SchemaErrorBoundary>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('should catch render errors and display fallback', () => {
    render(
      <SchemaErrorBoundary componentType="crashing-widget">
        <CrashingWidget />
      </SchemaErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/failed to render/i)).toBeInTheDocument();
    expect(screen.getByText(/"crashing-widget"/)).toBeInTheDocument();
    expect(screen.getByText('Widget exploded!')).toBeInTheDocument();
  });

  it('should display retry button that resets the error', () => {
    render(
      <SchemaErrorBoundary>
        <CrashingWidget />
      </SchemaErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retryButton = screen.getByText('Retry');
    expect(retryButton).toBeInTheDocument();
  });

  it('should work without componentType prop', () => {
    render(
      <SchemaErrorBoundary>
        <CrashingWidget />
      </SchemaErrorBoundary>
    );
    expect(screen.getByText(/failed to render/i)).toBeInTheDocument();
  });

  it('auto-resets when componentType changes', () => {
    const { rerender } = render(
      <SchemaErrorBoundary componentType="broken">
        <CrashingWidget />
      </SchemaErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <SchemaErrorBoundary componentType="healthy">
        <StableWidget content="recovered" />
      </SchemaErrorBoundary>
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('stable-widget')).toHaveTextContent('recovered');
  });

  it('auto-resets when resetKey changes', () => {
    const { rerender } = render(
      <SchemaErrorBoundary componentType="widget" resetKey="v1">
        <CrashingWidget />
      </SchemaErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <SchemaErrorBoundary componentType="widget" resetKey="v2">
        <StableWidget content="ok" />
      </SchemaErrorBoundary>
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('stable-widget')).toBeInTheDocument();
  });
});

describe('SchemaRenderer error boundary integration', () => {
  beforeEach(() => {
    ComponentRegistry.register('crashing-widget', CrashingWidget);
    ComponentRegistry.register('stable-widget', StableWidget);
  });

  afterEach(() => {
    ComponentRegistry.unregister?.('crashing-widget');
    ComponentRegistry.unregister?.('stable-widget');
  });

  it('should catch errors from a crashing component', () => {
    render(
      <SchemaRenderer schema={{ type: 'crashing-widget' }} />
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Widget exploded!')).toBeInTheDocument();
  });

  it('should not affect stable components', () => {
    render(
      <SchemaRenderer schema={stableWidget({ type: 'stable-widget', content: 'Hello' })} />
    );
    expect(screen.getByTestId('stable-widget')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('should isolate crashes between multiple renderers', () => {
    render(
      <div>
        <SchemaRenderer schema={{ type: 'crashing-widget' }} />
        <SchemaRenderer schema={stableWidget({ type: 'stable-widget', content: 'Still works' })} />
      </div>
    );
    // Crashing one should not affect the other
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('stable-widget')).toBeInTheDocument();
    expect(screen.getByText('Still works')).toBeInTheDocument();
  });
});
