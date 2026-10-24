/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7867 (ruling A) - the `params` rule at the `SchemaRenderer` seat:
 * every string leaf of a `params` bag is template-evaluated, at any depth, on
 * each of its three carriers, and nothing else about the memo moves.
 *
 * The end-to-end pins (real `action:button`, real runner, the handler's
 * `ActionDef`) live in `@object-ui/components`
 * (`action-params-templates-7867.test.tsx`), because this package does not
 * depend on that one. These pins cover what the end-to-end ones cannot reach
 * cheaply: the carriers a renderer does not read, the shapes the walk must NOT
 * look inside, and the diagnostic's radius.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { RecordContextProvider } from '../context/RecordContext';
import { mapParamsLeaves, isParamsBag } from '../utils/paramsBag';
import {
  collectUnevaluatedExpressions,
  UNEVALUATED_EXPRESSION_PREFIX,
} from '../utils/unevaluatedExpression';

const ROW = { id: 'rec_1', name: 'Acme' };

/**
 * The last `schema` / spread props the probe received. Recorded from an effect,
 * not during render (a render-phase write to module scope is an impurity), and
 * settled by the time `render()` returns.
 */
const seen: { schema: any; props: any } = { schema: undefined, props: undefined };

const ParamsProbe = ({ schema, ...props }: any) => {
  React.useEffect(() => {
    seen.schema = schema;
    seen.props = props;
  });
  return <div data-testid="probe" />;
};

const renderOnRecordPage = (schema: Record<string, unknown>) =>
  render(
    <RecordContextProvider objectName="account" recordId={ROW.id} data={ROW}>
      <SchemaRenderer schema={schema as any} />
    </RecordContextProvider>,
  );

/** Only the unevaluated-expression diagnostic's own lines. */
const shouts = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls
    .map((c) => String(c[0]))
    .filter((m) => m.includes(UNEVALUATED_EXPRESSION_PREFIX));

describe('SchemaRenderer - `params` string leaves are templates (objectui#7867)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seen.schema = undefined;
    seen.props = undefined;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    ComponentRegistry.register('params-probe-7867', ParamsProbe, { namespace: 'test' });
  });

  afterEach(() => {
    consoleError.mockRestore();
    ComponentRegistry.unregister?.('params-probe-7867', 'test');
  });

  describe('the three carriers', () => {
    it('node-level `params`: leaves at any depth, in objects and arrays', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        params: {
          objectName: 'account',
          recordId: '${record.id}',
          deep: { deeper: { id: '${record.id}' } },
          list: [{ id: '${record.id}' }, '${record.name}', 7],
        },
      });
      expect(seen.schema.params).toEqual({
        objectName: 'account',
        recordId: 'rec_1',
        deep: { deeper: { id: 'rec_1' } },
        list: [{ id: 'rec_1' }, 'Acme', 7],
      });
    });

    it('`properties.params`: evaluated before the hoist, so the bag and the hoisted copy agree', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        properties: { params: { recordId: '${record.id}', deep: { id: '${record.id}' } } },
      });
      expect(seen.schema.params).toEqual({ recordId: 'rec_1', deep: { id: 'rec_1' } });
      expect(seen.schema.properties.params).toEqual({ recordId: 'rec_1', deep: { id: 'rec_1' } });
    });

    it('`properties.params` still wins the hoist over a node-level `params`', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        params: { recordId: 'node-level' },
        properties: { params: { recordId: '${record.id}' } },
      });
      expect(seen.schema.params).toEqual({ recordId: 'rec_1' });
    });

    it('`props.params`: the legacy alias follows its canonical bag', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        props: { params: { deep: { id: '${record.id}' } } },
      });
      expect(seen.props.params).toEqual({ deep: { id: 'rec_1' } });
    });
  });

  describe('what the walk does not touch', () => {
    it('an ARRAY `params` - the ActionParam[] definition list - is left exactly as authored', () => {
      const definitions = [{ name: 'reason', type: 'text', label: 'Reason for ${record.name}' }];
      renderOnRecordPage({ type: 'test:params-probe-7867', params: definitions });
      expect(seen.schema.params).toBe(definitions);
      expect(seen.schema.params[0].label).toBe('Reason for ${record.name}');
    });

    it('keys are never evaluated, only values', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        params: { '${record.id}': '${record.id}' },
      });
      expect(seen.schema.params).toEqual({ '${record.id}': 'rec_1' });
    });

    it('non-plain objects and functions pass through by identity, unwalked', () => {
      class Carrier {
        label = '${record.id}';
      }
      const when = new Date(0);
      const carrier = new Carrier();
      const lookup = new Map([['k', '${record.id}']]);
      const fn = () => '${record.id}';
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        params: { when, carrier, lookup, fn, id: '${record.id}' },
      });
      expect(seen.schema.params.when).toBe(when);
      expect(seen.schema.params.carrier).toBe(carrier);
      expect(seen.schema.params.carrier.label).toBe('${record.id}');
      expect(seen.schema.params.lookup).toBe(lookup);
      expect(seen.schema.params.fn).toBe(fn);
      expect(seen.schema.params.id).toBe('rec_1');
    });

    it('a bag carrying a `source` key is walked, not collapsed the way a bare config value is', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        properties: {
          params: { source: 'web', id: '${record.id}', gate: { dialect: 'cel', source: 'record.x > 1' } },
        },
      });
      expect(seen.schema.params).toEqual({
        source: 'web',
        id: 'rec_1',
        gate: { dialect: 'cel', source: 'record.x > 1' },
      });
    });

    it('a cycle in a host-built bag ends the walk instead of the render', () => {
      const bag: Record<string, unknown> = { id: '${record.id}' };
      bag.self = bag;
      renderOnRecordPage({ type: 'test:params-probe-7867', params: bag });
      expect(seen.schema.params.id).toBe('rec_1');
      // The back-reference is handed over as the authored object, unwalked.
      expect(seen.schema.params.self).toBe(bag);
    });

    it('the authored bag is never mutated', () => {
      const authored = { recordId: '${record.id}', deep: { id: '${record.id}' } };
      renderOnRecordPage({ type: 'test:params-probe-7867', params: authored });
      expect(seen.schema.params.recordId).toBe('rec_1');
      expect(authored).toEqual({ recordId: '${record.id}', deep: { id: '${record.id}' } });
    });

    it('every other nested key keeps the shallow reading', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        properties: { aria: { label: '${record.id}' } },
        options: { id: '${record.id}' },
      });
      expect(seen.schema.properties.aria.label).toBe('${record.id}');
      expect(seen.schema.options.id).toBe('${record.id}');
    });
  });

  describe('an unresolvable template stays loud', () => {
    it('keeps its source text and is reported by its path', () => {
      renderOnRecordPage({
        type: 'test:params-probe-7867',
        properties: { params: { target: { id: '${nope.id}' } } },
      });
      expect(seen.schema.params.target.id).toBe('${nope.id}');
      const lines = shouts(consoleError);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('properties.params.target.id');
      // Reported once, under the authored spelling - not a second time for the
      // copy the hoist puts on the node.
      expect(lines[0]).not.toMatch(/^\s+- params\.target\.id/m);
    });
  });
});

describe('the diagnostic walks exactly the leaves evaluation walks (objectui#7867)', () => {
  it('reports a `params` leaf on every channel, by path', () => {
    const findings = collectUnevaluatedExpressions(
      { params: { ids: ['${a.b}'] } },
      { params: { deep: { id: '${c.d}' } } },
      { params: { x: '${e.f}' } },
    );
    expect(findings.map((f) => [f.channel, f.key])).toEqual([
      ['properties', 'params.deep.id'],
      ['schema', 'params.ids[0]'],
      ['props', 'params.x'],
    ]);
  });

  it('does not walk an array `params`, a non-plain object, or any other nested key', () => {
    class Carrier {
      label = '${x.y}';
    }
    expect(
      collectUnevaluatedExpressions({
        params: [{ label: '${x.y}' }],
        other: { deep: '${x.y}' },
      }),
    ).toEqual([]);
    expect(collectUnevaluatedExpressions({ params: { carrier: new Carrier() } })).toEqual([]);
  });
});

describe('mapParamsLeaves - copy on write', () => {
  it('hands back the very bag when no leaf changes', () => {
    const bag = { a: 'x', b: { c: ['y'] } };
    expect(mapParamsLeaves(bag, (leaf) => leaf)).toBe(bag);
  });

  it('copies only the containers on the changed path', () => {
    const untouched = { keep: 'x' };
    const bag = { untouched, changed: { v: 'old' } };
    const out = mapParamsLeaves(bag, (leaf) => (leaf === 'old' ? 'new' : leaf));
    expect(out).not.toBe(bag);
    expect(out.untouched).toBe(untouched);
    expect(out.changed).toEqual({ v: 'new' });
    expect(bag.changed.v).toBe('old');
  });

  it('keeps an own `__proto__` key an own data property', () => {
    const bag = JSON.parse('{"__proto__": "${x}"}') as Record<string, unknown>;
    const out = mapParamsLeaves(bag, () => 'resolved');
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toBe('resolved');
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('treats only a plain object as a bag', () => {
    expect(isParamsBag({})).toBe(true);
    expect(isParamsBag(Object.create(null))).toBe(true);
    expect(isParamsBag([])).toBe(false);
    expect(isParamsBag(new Date(0))).toBe(false);
    expect(isParamsBag('x')).toBe(false);
    expect(isParamsBag(null)).toBe(false);
  });
});
