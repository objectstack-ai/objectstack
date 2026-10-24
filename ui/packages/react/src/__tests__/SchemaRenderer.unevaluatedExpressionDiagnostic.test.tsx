/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4795 (Direction 3) — a loud dev-build diagnostic when an
 * UNEVALUATED `${…}` expression reaches the DOM.
 *
 * The defect it names, measured on this baseline with `dataSource: { n: 99 }`:
 * `{ type: 'ui:statistic', value: '${data.n}' }` renders the literal text
 * `${data.n}`, silently — SchemaRenderer evaluates `content`, the
 * `properties` / `props` bags and the predicate keys, and passes every other
 * top-level key through untouched. The maintainer's ruling (2026-08-17) took
 * Direction 3 (name the failure) and DEFERRED Direction 1 (evaluate a declared
 * set of text keys), so these pins assert the SHOUT, never a changed value.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { BaseSchema } from '@object-ui/types';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import {
  collectUnevaluatedExpressions,
  findExpressionSources,
  formatUnevaluatedExpressionMessage,
  UNEVALUATED_EXPRESSION_PREFIX,
} from '../utils/unevaluatedExpression';

/**
 * This file's registered `TextKeyProbe` (namespace `test`), declared to
 * `@object-ui/types` the way an application declares a type it registers
 * (objectui#11466): a node slot and the `schema` prop take the declared node
 * types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'test:probe-4795': TextKeyProbeNode;
  }
}

const DATA = { n: 99, total: 99, label: 'Widgets' };

/**
 * Stands in for a `ui:*` renderer: reads its text out of `schema.<key>`, which
 * is what `statistic` / `card` / `button` all do
 * (`packages/components/src/renderers/data-display/statistic.tsx` reads
 * `schema.value`). Not imported from `@object-ui/components` — this package
 * deliberately does not depend on it; the end-to-end reading through the real
 * renderers is recorded in the PR.
 */
const TextKeyProbe = ({ schema }: any) => (
  <div data-testid="probe">{String(schema.value ?? schema.title ?? '')}</div>
);

/**
 * The node a `TextKeyProbe` case authors directly as a `schema` prop
 * (objectui#11349): `BaseSchema` plus the two text keys the probe reads. The
 * literal is checked against this node rather than against the `BaseSchema`
 * the prop accepts, so its keys stay checked now that objectui#8347 has removed
 * `BaseSchema`'s index signature.
 */
type TextKeyProbeNode = BaseSchema & { type: 'test:probe-4795'; value?: string; title?: string };
const textKeyProbeNode = (schema: TextKeyProbeNode): TextKeyProbeNode => schema;

/** Reads only what it is spread, like a plain component. */
const SpreadProbe = (props: any) => (
  <div data-testid="spread">{String(props.content ?? '')}</div>
);

const renderWithData = (schema: any) =>
  render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as any}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
  );

/** Only the diagnostic's own lines — never the whole console.error traffic. */
const shouts = (spy: { mock: { calls: any[][] } }): string[] =>
  spy.mock.calls
    .map(c => String(c[0]))
    .filter(m => m.includes(UNEVALUATED_EXPRESSION_PREFIX));

describe('SchemaRenderer — unevaluated `${…}` diagnostic (objectui#4795)', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ComponentRegistry.register('probe-4795', TextKeyProbe, { namespace: 'test' });
    ComponentRegistry.register('spread-4795', SpreadProbe, { namespace: 'test' });
  });

  afterEach(() => {
    spy.mockRestore();
    ComponentRegistry.unregister?.('probe-4795', 'test');
    ComponentRegistry.unregister?.('spread-4795', 'test');
  });

  // (a) the defect: a top-level text key is never evaluated, so the literal
  //     source text goes on screen — and now says so.
  describe('a top-level text key carrying a literal expression', () => {
    it('shouts, and the value still renders literally (read-only diagnostic)', () => {
      const { getByTestId } = renderWithData({
        type: 'test:probe-4795',
        id: 'stat-1',
        value: '${data.n}',
      });

      // The behaviour is UNCHANGED — Direction 1 stays deferred.
      expect(getByTestId('probe')).toHaveTextContent('${data.n}');

      const messages = shouts(spy);
      expect(messages).toHaveLength(1);
      // Names the node, the landing key, and the expression source verbatim.
      expect(messages[0]).toContain('test:probe-4795');
      expect(messages[0]).toContain('stat-1');
      expect(messages[0]).toContain('value');
      expect(messages[0]).toContain('${data.n}');
      // ...and points at the channels that actually work today.
      expect(messages[0]).toContain('content');
    });

    it('shouts for `title` / `label` / `description` alike', () => {
      for (const key of ['title', 'label', 'description']) {
        spy.mockClear();
        renderWithData({ type: 'test:probe-4795', [key]: '${data.total}' });
        expect(shouts(spy)[0]).toContain(key);
      }
    });

    it('reports once per schema object, however many times it re-renders', () => {
      const schema: TextKeyProbeNode = { type: 'test:probe-4795', value: '${data.n}' };
      const { rerender } = renderWithData(schema);
      rerender(
        <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as any}>
          <SchemaRenderer schema={schema} />
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>
      );
      expect(shouts(spy)).toHaveLength(1);
    });
  });

  // (b) every channel that DOES evaluate must stay silent.
  describe('correctly-authored nodes stay silent', () => {
    it('says nothing for a top-level `content`', () => {
      const { getByTestId } = renderWithData({
        type: 'test:spread-4795',
        content: 'Total: ${data.total}',
      });
      expect(getByTestId('spread')).toHaveTextContent('Total: 99');
      expect(shouts(spy)).toEqual([]);
    });

    it('says nothing for a `props` bag', () => {
      renderWithData({ type: 'test:spread-4795', props: { content: '${data.total}' } });
      expect(shouts(spy)).toEqual([]);
    });

    it('says nothing for a `properties` bag (evaluated since objectui#4799)', () => {
      const { getByTestId } = renderWithData({
        type: 'test:probe-4795',
        properties: { value: '${data.n}' },
      });
      expect(getByTestId('probe')).toHaveTextContent('99');
      expect(shouts(spy)).toEqual([]);
    });

    it('says nothing for a static schema with no expressions at all', () => {
      renderWithData({ type: 'test:probe-4795', value: 'plain text' });
      expect(shouts(spy)).toEqual([]);
    });

    it('says nothing when an expression resolves to nothing (missing data is not this defect)', () => {
      // `${data.missing}` evaluates to undefined / '' — no source text survives,
      // so there is nothing placed verbatim and nothing to report.
      renderWithData({ type: 'test:spread-4795', content: 'x ${data.missing} y' });
      expect(shouts(spy)).toEqual([]);
    });
  });

  /**
   * The predicate keys are the diagnostic's biggest false-positive risk: they
   * hold raw `${…}` SOURCE by design and are evaluated as conditions, never
   * placed. The metadata destructure in SchemaRenderer strips them before the
   * scan, which is what makes this silent — pinned so a future edit to that
   * destructure cannot quietly turn every correctly-authored predicate in the
   * repo into a shout.
   */
  describe('predicate keys are never reported', () => {
    it.each([
      ['visible', '${data.n > 0}'],
      ['visibleWhen', '${data.n > 0}'],
      ['visibleOn', '${data.n > 0}'],
      ['hiddenOn', '${data.n < 0}'],
      ['disabled', '${data.n < 0}'],
      ['disabledOn', '${data.n < 0}'],
    ])('stays silent for a declared `%s`', (key, expr) => {
      renderWithData({ type: 'test:probe-4795', value: 'ok', [key]: expr });
      expect(shouts(spy)).toEqual([]);
    });
  });

  // The second class the ruling named: evaluation ran, but THREW, and the
  // evaluator returns the source verbatim — indistinguishable on screen from a
  // key that was never evaluated.
  describe('evaluation-failure residue', () => {
    it('shouts when an expression throws and its source survives evaluation', () => {
      renderWithData({ type: 'test:spread-4795', content: 'Total: ${1 +}' });
      const messages = shouts(spy);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('${1 +}');
      expect(messages[0]).toContain('content');
    });
  });

  /**
   * The scan is as deep as evaluation is, and no deeper. A nested
   * `aria: { label: '${…}' }` keeps its raw source today BY DECISION
   * (objectui#4799 pinned the shallowness on both bags), so reporting it would
   * make the diagnostic louder than the contract it speaks for.
   */
  describe('depth matches the evaluator exactly', () => {
    it('does not report a nested value under `properties`', () => {
      renderWithData({
        type: 'test:probe-4795',
        properties: { value: 1, aria: { label: '${data.total}' } },
      });
      expect(shouts(spy)).toEqual([]);
    });

    it('does not report a nested value under `props`', () => {
      renderWithData({
        type: 'test:spread-4795',
        props: { content: 'x', aria: { label: '${data.total}' } },
      });
      expect(shouts(spy)).toEqual([]);
    });
  });

  // (c) production build: no work, no output.
  describe('production build', () => {
    it('emits nothing when NODE_ENV is production', async () => {
      // `__DEV__` in SchemaRenderer is a MODULE-LOAD constant (so a bundler can
      // constant-fold the branch and drop the diagnostic from the production
      // bundle entirely). Flipping the env therefore needs a fresh module graph
      // — the deliberate `vi.resetModules()` re-import that AGENTS.md §测试纪律
      // exempts, done in the test body rather than a hook.
      vi.resetModules();
      vi.stubEnv('NODE_ENV', 'production');
      try {
        const prodSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { SchemaRenderer: ProdRenderer } = await import('../SchemaRenderer');
        const { SchemaRendererContext: ProdContext } = await import(
          '../context/SchemaRendererContext'
        );
        const { ComponentRegistry: ProdRegistry } = await import('@object-ui/core');
        ProdRegistry.register('probe-4795', TextKeyProbe, { namespace: 'test' });

        const { getByTestId } = render(
          <ProdContext.Provider value={{ dataSource: DATA } as any}>
            <ProdRenderer schema={textKeyProbeNode({ type: 'test:probe-4795', value: '${data.n}' })} />
          </ProdContext.Provider>
        );

        // The defect is still there — the diagnostic is a dev affordance only.
        expect(getByTestId('probe')).toHaveTextContent('${data.n}');
        expect(shouts(prodSpy)).toEqual([]);
        prodSpy.mockRestore();
        ProdRegistry.unregister?.('probe-4795', 'test');
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    });
  });
});

/**
 * (d) The diagnostic's own positive guard.
 *
 * objectui#5092's lesson: a diagnostic whose only coverage is "a spy was
 * called" goes green the moment someone no-ops the assertion. The scan and the
 * message are pure functions for exactly this reason — these assert the
 * RETURNED findings and the RENDERED words, so stubbing either one out is red.
 */
describe('the diagnostic itself (objectui#4795)', () => {
  it('finds expression sources using the evaluator\'s own definition', () => {
    expect(findExpressionSources('${data.n}')).toEqual(['${data.n}']);
    expect(findExpressionSources('a ${x} b ${y}')).toEqual(['${x}', '${y}']);
    // The evaluator's interpolation regex requires at least one character, so
    // `${}` is not an expression to it — measured: it is returned verbatim and
    // is not a defect to report.
    expect(findExpressionSources('a ${} b')).toEqual([]);
    // An unterminated `${` is not an expression either — this is what keeps
    // prose and code samples out of the diagnostic.
    expect(findExpressionSources('write ${ like so')).toEqual([]);
    expect(findExpressionSources('no expressions here')).toEqual([]);
  });

  it('is not stateful across calls (the /g regex is reset per value)', () => {
    // A module-scope /g literal keeps `lastIndex` between calls; without the
    // reset the SECOND identical call returns nothing and the diagnostic goes
    // quiet exactly when it is used most.
    expect(findExpressionSources('${a}')).toEqual(['${a}']);
    expect(findExpressionSources('${a}')).toEqual(['${a}']);
  });

  it('collects findings per channel, naming the authored spelling', () => {
    expect(collectUnevaluatedExpressions({ value: '${data.n}' })).toEqual([
      { key: 'value', channel: 'schema', value: '${data.n}', expressions: ['${data.n}'] },
    ]);
    expect(collectUnevaluatedExpressions(undefined, undefined, { c: '${x}' })).toEqual([
      { key: 'c', channel: 'props', value: '${x}', expressions: ['${x}'] },
    ]);
  });

  it('reports a hoisted `properties` value once, at the key the author wrote', () => {
    // SchemaRenderer copies every `properties.*` onto the node's top level, so
    // the same residue is visible twice. One finding, spelled `properties.x`.
    const findings = collectUnevaluatedExpressions({ x: '${bad(}' }, { x: '${bad(}' });
    expect(findings).toHaveLength(1);
    expect(findings[0].channel).toBe('properties');
    expect(formatUnevaluatedExpressionMessage('ui:card', undefined, findings)).toContain(
      'properties.x'
    );
  });

  it('ignores non-string values and degenerate bags', () => {
    expect(collectUnevaluatedExpressions({ n: 7, ok: true, nested: { a: '${x}' } })).toEqual([]);
    expect(collectUnevaluatedExpressions(undefined, ['${x}'] as any, null)).toEqual([]);
    expect(collectUnevaluatedExpressions(null, null, null)).toEqual([]);
  });

  it('renders a message that names node, site, source and the way out', () => {
    const message = formatUnevaluatedExpressionMessage('ui:statistic', 'stat-1', [
      { key: 'value', channel: 'schema', value: '${data.n}', expressions: ['${data.n}'] },
    ]);
    expect(message).toContain(UNEVALUATED_EXPRESSION_PREFIX);
    expect(message).toContain('ui:statistic');
    expect(message).toContain('stat-1');
    expect(message).toContain('value');
    expect(message).toContain('${data.n}');
    expect(message).toContain('content');
    expect(message).toContain('host');
  });
});
