/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
// `BaseSchema.visible` AND `.disabled` now both declare `boolean | string`
// (objectui#4581), so every predicate-string case below states its expression
// directly — no casts left in this file.
//
// The header that stood here said the `disabled` casts were "what remains of
// the gap — drop them when that lands". This is that landing: #4580's ruling
// Q3-A widened `disabled` on the same evidence as `visible` (the renderer
// evaluates it through the same `evaluateCondition`, in the evaluation memo of
// `SchemaRenderer.tsx`, and the `disabledOn?: string` sibling exists for
// the same reason), and the two casts are gone. The `BaseSchema` import went
// with them. It is back only to type the retired-`visibility` probe node
// below (objectui#11349, objectui#12654), not for a cast.
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import type { BaseSchema, DataSource } from '@object-ui/types';

/**
 * A RAW node still carrying the page component's `visibility` key, the old
 * spelling of `visibleWhen` (objectui#11349). `@objectstack/spec` 18 retires
 * it as a `retiredKey` tombstone (objectstack#23543 F4), so it is no longer
 * typed by reference to `PageComponent` — its type there is `never` — and the
 * probe declares the key itself, as raw data that bypassed every parsing door
 * would carry it. The case below pins that the renderer does NOT read it
 * (objectui#12654). Declared on this test's own registered node type, not on
 * `BaseSchema`, which has no index signature (objectui#8347).
 */
type RetiredVisibilityNode = BaseSchema & { type: 'test-component'; visibility?: string };
const retiredVisibilityNode = (schema: RetiredVisibilityNode): RetiredVisibilityNode => schema;
import { PredicateScopeProvider } from '../hooks/useExpression';

/**
 * This file's registered `TestComponent`, typed by its probe node, declared to
 * `@object-ui/types` the way an application declares a type it registers
 * (objectui#11466): a node slot and the `schema` prop take the declared node
 * types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'test-component': RetiredVisibilityNode;
  }
}

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

// Simple test component
const TestComponent = (props: any) => (
  <div data-testid="test-component" data-disabled={props.disabled || undefined}>
    {props.content || props.label || 'Test'}
  </div>
);

describe('SchemaRenderer Expression Integration', () => {
  beforeEach(() => {
    ComponentRegistry.register('test-component', TestComponent);
  });

  afterEach(() => {
    ComponentRegistry.unregister?.('test-component');
  });

  describe('visible / hidden expressions', () => {
    it('renders when visible is true', () => {
      render(<SchemaRenderer schema={{ type: 'test-component', visible: true }} />);
      expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });

    it('does not render when visible is false', () => {
      const { container } = render(<SchemaRenderer schema={{ type: 'test-component', visible: false }} />);
      expect(container.innerHTML).toBe('');
    });

    it('evaluates visible expression string', () => {
      render(
        <PredicateScopeProvider scope={{ data: { role: 'admin' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { role: 'admin' } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', visible: '${data.role === "admin"}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });

    it('hides when visible expression evaluates to false', () => {
      const { container } = render(
        <PredicateScopeProvider scope={{ data: { role: 'viewer' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { role: 'viewer' } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', visible: '${data.role === "admin"}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(container.innerHTML).toBe('');
    });

    it('hides when hidden is true', () => {
      const { container } = render(<SchemaRenderer schema={{ type: 'test-component', hidden: true }} />);
      expect(container.innerHTML).toBe('');
    });

    it('shows when hidden is false', () => {
      render(<SchemaRenderer schema={{ type: 'test-component', hidden: false }} />);
      expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });

    it('hides with hiddenOn expression', () => {
      const { container } = render(
        <PredicateScopeProvider scope={{ data: { status: 'draft' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { status: 'draft' } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', hiddenOn: '${data.status === "draft"}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(container.innerHTML).toBe('');
    });

    it('visible takes precedence over hidden', () => {
      render(<SchemaRenderer schema={{ type: 'test-component', visible: true, hidden: true }} />);
      expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });
  });

  // ADR-0089 — `visibleWhen` is the canonical conditional-visibility predicate.
  // The page component's `visibility` spelling is retired (objectui#12654).
  // `BaseSchema`'s own deprecated `visibleOn` is a different key, not covered here.
  describe('visibleWhen (ADR-0089 canonical)', () => {
    it('shows when the visibleWhen predicate is truthy', () => {
      render(
        <PredicateScopeProvider scope={{ data: { role: 'admin' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { role: 'admin' } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', visibleWhen: '${data.role === "admin"}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });

    it('hides when the visibleWhen predicate is falsy', () => {
      const { container } = render(
        <PredicateScopeProvider scope={{ data: { role: 'viewer' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { role: 'viewer' } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', visibleWhen: '${data.role === "admin"}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(container.innerHTML).toBe('');
    });

    // The narrowing (objectui#12654): the predicate that hides the node under
    // `visibleWhen` (the case above) gates NOTHING under the retired key.
    it('does not read the retired `visibility` key — the node stays on screen', () => {
      render(
        <PredicateScopeProvider scope={{ data: { role: 'viewer' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { role: 'viewer' } as unknown as DataSource }}>
          <SchemaRenderer schema={retiredVisibilityNode({ type: 'test-component', visibility: '${data.role === "admin"}' })} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });
  });

  describe('disabled expressions', () => {
    it('passes disabled=true when disabled expression is true', () => {
      render(<SchemaRenderer schema={{ type: 'test-component', disabled: true }} />);
      expect(screen.getByTestId('test-component')).toHaveAttribute('data-disabled', 'true');
    });

    it('evaluates disabled expression string', () => {
      render(
        <PredicateScopeProvider scope={{ data: { status: 'locked' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { status: 'locked' } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', disabled: '${data.status === "locked"}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(screen.getByTestId('test-component')).toHaveAttribute('data-disabled', 'true');
    });

    it('does not set disabled when expression is false', () => {
      render(
        <PredicateScopeProvider scope={{ data: { status: 'active' } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { status: 'active' } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', disabled: '${data.status === "locked"}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(screen.getByTestId('test-component')).not.toHaveAttribute('data-disabled');
    });

    it('evaluates disabledOn expression', () => {
      render(
        <PredicateScopeProvider scope={{ data: { readOnly: true } }}>
        <SchemaRendererContext.Provider value={{ dataSource: { readOnly: true } as unknown as DataSource }}>
          <SchemaRenderer schema={{ type: 'test-component', disabledOn: '${data.readOnly}' }} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(screen.getByTestId('test-component')).toHaveAttribute('data-disabled', 'true');
    });
  });

  describe('defaults', () => {
    it('renders by default when no visibility props are set', () => {
      render(<SchemaRenderer schema={{ type: 'test-component' }} />);
      expect(screen.getByTestId('test-component')).toBeInTheDocument();
    });

    it('is not disabled by default', () => {
      render(<SchemaRenderer schema={{ type: 'test-component' }} />);
      expect(screen.getByTestId('test-component')).not.toHaveAttribute('data-disabled');
    });
  });
});
