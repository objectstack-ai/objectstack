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
import type { BaseSchema } from '@object-ui/types';
import type { AriaProps } from '@objectstack/spec/ui';
import { SchemaRenderer } from '../SchemaRenderer';
// The keyed-`ariaLabel` fixture below needs no cast: objectui#4581 declared the
// vocabulary the renderer resolves on `BaseSchema` itself. `BaseSchema` is
// imported for the probe node type below, not for a cast.

/**
 * The node the flat-ARIA cases author (objectui#11349): a registered
 * `test-widget` carrying the two flat ARIA keys `resolveAriaProps` reads off the
 * node but `BaseSchema` does not declare. They are typed by reference to
 * `@objectstack/spec`'s `AriaProps`, the vocabulary that reader documents. The
 * node also carries the `content` that `TestWidget` renders.
 *
 * Each literal is checked against this node, so its keys stay checked now that
 * objectui#8347 has removed `BaseSchema`'s index signature. It is declared to
 * `@object-ui/types` through `CustomNodeRegistry` below, the way an
 * application declares a type it registers (objectui#11466): the `schema`
 * prop takes the declared node types only.
 */
type FlatAriaProbe = BaseSchema &
  Pick<AriaProps, 'ariaDescribedBy' | 'role'> & { type: 'test-widget'; content?: string };
const flatAriaProbe = (schema: FlatAriaProbe): FlatAriaProbe => schema;

declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    /** This file's registered `TestWidget`. */
    'test-widget': FlatAriaProbe;
  }
}

// A simple test component that forwards ARIA attributes
const TestWidget: React.FC<any> = (props) => (
  <div
    data-testid="test-widget"
    aria-label={props['aria-label']}
    aria-describedby={props['aria-describedby']}
    role={props['role']}
  >
    {props.content || 'Test'}
  </div>
);

describe('SchemaRenderer AriaProps injection', () => {
  beforeEach(() => {
    ComponentRegistry.register('test-widget', TestWidget);
  });

  afterEach(() => {
    ComponentRegistry.unregister?.('test-widget');
  });

  it('should inject aria-label from ariaLabel string', () => {
    render(
      <SchemaRenderer
        schema={{
          type: 'test-widget',
          ariaLabel: 'Close dialog',
        }}
      />
    );
    const el = screen.getByTestId('test-widget');
    expect(el).toHaveAttribute('aria-label', 'Close dialog');
  });

  it('should resolve ariaLabel from a KeyedI18nLabel object', () => {
    render(
      <SchemaRenderer
        schema={{
          type: 'test-widget',
          // No cast: `BaseSchema.ariaLabel` declares `string | KeyedI18nLabel`
          // (objectui#4581), which is the vocabulary the renderer actually
          // resolves — `resolveAriaProps` in `SchemaRenderer.tsx` calls `resolveKeyedI18nLabel`.
          // This fixture carried `as unknown as BaseSchema` while the
          // declaration said the narrower `string` (objectui#4548).
          ariaLabel: { key: 'dialog.close', defaultValue: 'Close dialog' },
        }}
      />
    );
    const el = screen.getByTestId('test-widget');
    expect(el).toHaveAttribute('aria-label', 'Close dialog');
  });

  it('should resolve a KeyedI18nLabel carrying params', () => {
    render(
      <SchemaRenderer
        schema={{
          type: 'test-widget',
          // `params` is the limb the withdrawn `string | I18nLabel` spelling
          // REJECTED outright (PR #4593's probe, #4580 ruling Q2-B). Without a
          // `t`, this package's resolver falls back to `defaultValue` — the
          // point here is that the shape is authorable at all.
          ariaLabel: {
            key: 'greeting.hello',
            defaultValue: 'Hello, Ada',
            params: { name: 'Ada' },
          },
        }}
      />
    );
    const el = screen.getByTestId('test-widget');
    expect(el).toHaveAttribute('aria-label', 'Hello, Ada');
  });

  it('should inject aria-describedby from ariaDescribedBy', () => {
    render(
      <SchemaRenderer
        schema={flatAriaProbe({
          type: 'test-widget',
          ariaDescribedBy: 'help-text-1',
        })}
      />
    );
    const el = screen.getByTestId('test-widget');
    expect(el).toHaveAttribute('aria-describedby', 'help-text-1');
  });

  it('should inject role from schema', () => {
    render(
      <SchemaRenderer
        schema={flatAriaProbe({
          type: 'test-widget',
          role: 'navigation',
        })}
      />
    );
    const el = screen.getByTestId('test-widget');
    expect(el).toHaveAttribute('role', 'navigation');
  });

  it('should inject all ARIA props together', () => {
    render(
      <SchemaRenderer
        schema={flatAriaProbe({
          type: 'test-widget',
          ariaLabel: 'Main nav',
          ariaDescribedBy: 'nav-desc',
          role: 'navigation',
        })}
      />
    );
    const el = screen.getByTestId('test-widget');
    expect(el).toHaveAttribute('aria-label', 'Main nav');
    expect(el).toHaveAttribute('aria-describedby', 'nav-desc');
    expect(el).toHaveAttribute('role', 'navigation');
  });

  it('should not inject ARIA attrs when not in schema', () => {
    render(
      <SchemaRenderer
        schema={flatAriaProbe({
          type: 'test-widget',
          content: 'Hello',
        })}
      />
    );
    const el = screen.getByTestId('test-widget');
    expect(el).not.toHaveAttribute('aria-label');
    expect(el).not.toHaveAttribute('aria-describedby');
  });
});
