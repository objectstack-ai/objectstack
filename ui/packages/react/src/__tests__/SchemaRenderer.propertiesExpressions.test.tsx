/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4799 — `properties` is the SPEC spelling of a node's config bag and
 * `props` is the legacy alias, but only `props` used to be evaluated in the
 * SchemaRenderer memo. Renderers in the `element:*` namespace read
 * `schema.properties` FIRST, so writing the canonical spelling put the raw
 * `${…}` source on screen while the alias evaluated — the inverse of
 * contract-first (AGENTS.md #0.1).
 *
 * The stand-in below reproduces `readProps()` from
 * `packages/components/src/renderers/basic/elements.tsx` verbatim
 * (`{ ...schema.props, ...schema.properties }`) — that merge, not the specific
 * element renderer, is what makes the defect visible. The real `element:text`
 * end-to-end reading is recorded in the PR; it cannot be pinned from this
 * package, which by design does not depend on `@object-ui/components`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

const DATA = { total: 99, label: 'Widgets' };

/** Mirrors `readProps()` in `@object-ui/components` — `properties` wins. */
function readProps(schema: any): Record<string, any> {
  return { ...(schema?.props ?? {}), ...(schema?.properties ?? {}) };
}

/**
 * Last `schema` / React props an element render received, for structural pins.
 * Recorded from an effect, not during render: a render-phase write to a
 * module-scope binding is an impurity (`react-hooks/globals`), and RTL's
 * `render()` flushes effects inside `act()`, so this is settled by the time any
 * assertion below reads it.
 */
const seen: { schema: any; props: any } = { schema: undefined, props: undefined };

const ElementProbe = ({ schema, ...props }: any) => {
  React.useEffect(() => {
    seen.schema = schema;
    seen.props = props;
  });
  const merged = readProps(schema);
  return (
    <p data-testid="element" data-variant={merged.variant}>
      {String(merged.content)}
    </p>
  );
};

/** A plain (non-`element:*`) component: reads only what it is spread. */
const PlainProbe = (props: any) => (
  <div data-testid="plain">{String(props.content)}</div>
);

const renderWithData = (schema: any) =>
  render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as any}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
  );

describe('SchemaRenderer — expression evaluation of `properties` (objectui#4799)', () => {
  beforeEach(() => {
    seen.schema = undefined;
    seen.props = undefined;
    ComponentRegistry.register('probe', ElementProbe, {
      namespace: 'element',
      skipFallback: true,
    });
    ComponentRegistry.register('plain-probe', PlainProbe, { namespace: 'test' });
  });

  afterEach(() => {
    ComponentRegistry.unregister?.('probe', 'element');
    ComponentRegistry.unregister?.('plain-probe', 'test');
  });

  // (a) the defect itself
  describe('the canonical spelling evaluates', () => {
    it('evaluates an expression written under `properties`', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: '${data.total}' },
      });
      expect(screen.getByTestId('element')).toHaveTextContent('99');
    });

    it('leaves the evaluated value on `schema.properties`, which is what the renderer reads', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: '${data.total}' },
      });
      // The pre-fix bug was NOT that nothing was evaluated — the hoist put an
      // evaluated `content` at the top level — but that `schema.properties`
      // still pointed at the untouched original. Pin the object the renderer
      // actually reads.
      expect(seen.schema.properties.content).toBe(99);
    });

    it('evaluates an interpolated (multi-part) expression too', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: '${data.label}: ${data.total}' },
      });
      expect(screen.getByTestId('element')).toHaveTextContent('Widgets: 99');
    });

    it('evaluates every value in the bag, not just `content`', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: 'x', variant: '${data.label}' },
      });
      expect(seen.schema.properties.variant).toBe('Widgets');
    });
  });

  // (b) the alias must not regress
  describe('the legacy `props` alias keeps working', () => {
    it('still evaluates an expression written under `props`', () => {
      renderWithData({
        type: 'element:probe',
        props: { content: '${data.total}' },
      });
      expect(screen.getByTestId('element')).toHaveTextContent('99');
      expect(seen.schema.props.content).toBe(99);
    });
  });

  // (c) both keys present
  describe('both spellings on one node', () => {
    it('renders the `properties` value (it wins the merge) and evaluates both', () => {
      renderWithData({
        type: 'element:probe',
        props: { content: '${data.label}' },
        properties: { content: '${data.total}' },
      });
      expect(screen.getByTestId('element')).toHaveTextContent('99');
      expect(seen.schema.properties.content).toBe(99);
      expect(seen.schema.props.content).toBe('Widgets');
    });
  });

  // (d) static values, both sides
  describe('static values are untouched on both spellings', () => {
    it('passes a static `properties.content` through unchanged', () => {
      renderWithData({ type: 'element:probe', properties: { content: 'HELLO' } });
      expect(screen.getByTestId('element')).toHaveTextContent('HELLO');
    });

    it('passes a static `props.content` through unchanged', () => {
      renderWithData({ type: 'element:probe', props: { content: 'HELLO' } });
      expect(screen.getByTestId('element')).toHaveTextContent('HELLO');
    });

    it('leaves non-string values (numbers, booleans) as they are', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: 7, variant: 'body', flag: true },
      });
      expect(seen.schema.properties.content).toBe(7);
      expect(seen.schema.properties.flag).toBe(true);
    });
  });

  // (e) nothing outside the `element:*` shape changes
  describe('non-element namespaces are unaffected', () => {
    it('still evaluates `props` for a component that only reads spread props', () => {
      renderWithData({
        type: 'test:plain-probe',
        props: { content: '${data.total}' },
      });
      expect(screen.getByTestId('plain')).toHaveTextContent('99');
    });

    it('still evaluates the top-level `content` leg', () => {
      renderWithData({ type: 'test:plain-probe', content: '${data.total}' });
      expect(screen.getByTestId('plain')).toHaveTextContent('99');
    });
  });

  // Interaction with the pre-existing `properties` -> top-level hoist.
  describe('the properties-to-top-level hoist', () => {
    it('hoists the EVALUATED value, so `schema.x` and `schema.properties.x` agree', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: 'x', variant: '${data.label}' },
      });
      expect(seen.schema.variant).toBe('Widgets');
      expect(seen.schema.properties.variant).toBe('Widgets');
      // ...and the hoisted value is spread as a React prop, which must agree too.
      expect(seen.props.variant).toBe('Widgets');
    });

    it('still refuses to let inner `type` / `id` shadow the node descriptor', () => {
      renderWithData({
        type: 'element:probe',
        id: 'outer',
        properties: { type: 'body', id: 'inner', content: 'x' },
      });
      expect(seen.schema.type).toBe('element:probe');
      expect(seen.schema.id).toBe('outer');
      // Both remain readable through the bag, exactly as before.
      expect(seen.schema.properties.type).toBe('body');
      expect(seen.schema.properties.id).toBe('inner');
    });
  });

  /**
   * Evaluation is per-value and SHALLOW on BOTH spellings — measured, not
   * assumed: `ExpressionEvaluator.evaluate` returns every non-string untouched,
   * so a nested object/array is passed through rather than walked. This pins the
   * PARITY, not the depth: deepening one side without the other is the defect
   * this issue is about, in miniature.
   */
  describe('shallow, and equally shallow on both spellings', () => {
    it('does not walk into a nested object under `properties`', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: 'x', aria: { label: '${data.total}' } },
      });
      expect(seen.schema.properties.aria.label).toBe('${data.total}');
    });

    it('does not walk into a nested object under `props` either', () => {
      renderWithData({
        type: 'element:probe',
        props: { content: 'x', aria: { label: '${data.total}' } },
      });
      expect(seen.schema.props.aria.label).toBe('${data.total}');
    });

    it('does not walk into an array under `properties`', () => {
      renderWithData({
        type: 'element:probe',
        properties: { content: 'x', items: ['${data.total}'] },
      });
      expect(seen.schema.properties.items[0]).toBe('${data.total}');
    });
  });

  /**
   * The evaluation guard is deliberately narrower than the `props` branch's bare
   * truthiness, because this value feeds the hoist: a degenerate `properties`
   * must reach it with its shape intact rather than re-spread into an object.
   */
  describe('degenerate `properties` values keep their existing behaviour', () => {
    it('does not turn an array `properties` into a plain object', () => {
      renderWithData({ type: 'element:probe', properties: ['a'] as any });
      expect(Array.isArray(seen.schema.properties)).toBe(true);
    });

    it('renders without throwing when `properties` is null', () => {
      renderWithData({ type: 'element:probe', properties: null as any });
      expect(screen.getByTestId('element')).toBeInTheDocument();
    });
  });
});
