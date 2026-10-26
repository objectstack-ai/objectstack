/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4548 — what `SchemaRenderer` does with a NON-OBJECT schema.
 *
 * ## Why this suite exists
 *
 * The evaluation memo used to guard only `!schema || typeof schema === 'string'`.
 * A `number` or a `boolean` therefore fell through to the shallow copy
 * `{ ...schema }`, which spreads a primitive to an EMPTY object — losing the
 * `type` the renderer then looked up, so the node surfaced as the red
 * "Unknown component type: undefined" box. That was an accident of the spread,
 * not a decision, and it was invisible because the props type had collapsed to
 * an index signature and `schema` resolved to `any`.
 *
 * The declared props type now excludes `number` / `boolean` outright, so typed
 * callers cannot reach this at all. The runtime handling below is
 * defence-in-depth for untyped callers and stored metadata, and the rendering it
 * produces is the DECLARED behaviour change of objectui#4548: a stray primitive
 * renders as its own text.
 *
 * The string and nullish paths are pinned byte-identical alongside it — those
 * were correct before and must not move.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { undeclaredNode } from '@object-ui/test-support';
import type { BaseSchema } from '@object-ui/types';

/**
 * This file's registered probe, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'test-4548-div': BaseSchema;
  }
}

const originalWarn = console.warn;
beforeEach(() => {
  console.warn = vi.fn();
});
afterEach(() => {
  console.warn = originalWarn;
});

describe('objectui#4548 — non-object schema values', () => {
  describe('the declared change: a stray primitive renders as its text', () => {
    it('renders a number as text, not as an "Unknown component type" box', () => {
      // Untyped caller — the declared props type does not admit `number`.
      const { container } = render(<SchemaRenderer schema={42 as never} />);
      expect(container.textContent).toBe('42');
      // The old behaviour, explicitly: the empty spread lost `type`, so this
      // rendered the unknown-component error box. It must not come back.
      expect(container.textContent).not.toContain('Unknown component type');
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('renders a boolean as text', () => {
      const { container } = render(<SchemaRenderer schema={true as never} />);
      expect(container.textContent).toBe('true');
      expect(container.textContent).not.toContain('Unknown component type');
    });
  });

  describe('unchanged paths (pinned byte-identical)', () => {
    it('renders a string schema as its own text', () => {
      const { container } = render(<SchemaRenderer schema="just some text" />);
      expect(container.textContent).toBe('just some text');
    });

    it('renders nothing for null / undefined / empty string', () => {
      for (const value of [null, undefined, ''] as const) {
        const { container } = render(<SchemaRenderer schema={value} />);
        expect(container.innerHTML).toBe('');
      }
    });

    it('renders nothing for the falsy primitives that never reached the spread', () => {
      // `0` and `false` were caught by the pre-existing `!schema` leg and
      // returned null; they keep doing so rather than becoming "0" / "false".
      for (const value of [0, false] as const) {
        const { container } = render(<SchemaRenderer schema={value as never} />);
        expect(container.innerHTML).toBe('');
      }
    });

    it('still shows the error box for an OBJECT whose type is unregistered', () => {
      // The unknown-component box is correct HERE — an object that names a type
      // nothing implements. Only the primitive case stopped producing it.
      // Deliberately undeclared: the type is the point (objectui#11466).
      const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'no-such-component-4548' })} />);
      expect(container.textContent).toContain('Unknown component type');
      expect(container.textContent).toContain('no-such-component-4548');
    });

    it('still renders a registered component normally', () => {
      const Probe: React.FC<{ schema?: { type?: string } }> = props => (
        <div data-testid="ok">{props.schema?.type}</div>
      );
      ComponentRegistry.register('test-4548-div', Probe);
      const { getByTestId } = render(<SchemaRenderer schema={{ type: 'test-4548-div' }} />);
      expect(getByTestId('ok').textContent).toBe('test-4548-div');
    });
  });
});
