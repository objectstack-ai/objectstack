/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6708 — a key authored under the `props` envelope never reaches a
 * renderer that reads `schema`, and until now nothing said so.
 *
 * The maintainer ruling (2026-08-29, verbatim 「同意」) took option 2: diagnose
 * it at the `SchemaRenderer` tier — one seam, every renderer family covered,
 * ZERO behaviour change. Option 1 (hoisting `props` to parity with
 * `properties`) was refused; option 3 (refusing the key at parse) stays blocked
 * on the `.passthrough()` ceiling (objectui#5155 / objectui#6269).
 *
 * ## The three describes, and why the first two exist at all
 *
 * 1. **The asymmetry, re-measured on this base.** The card was filed off a
 *    reading taken on `5967be095`. A defect that is only quoted ages silently,
 *    so legs 2 and 3 — the same key, the same value, one envelope apart — are
 *    re-run here through the real `SchemaRenderer` before anything is claimed
 *    about them.
 * 2. **What renderers receive, pinned against the PRE-diagnostic tree.** The
 *    ruling's whole reason for choosing this arm is that nothing renderers see
 *    moves. `BASE_READING` below is not a snapshot this file wrote for itself:
 *    it was captured by rendering these seven nodes on `faac0d935` with
 *    `SchemaRenderer.tsx` reverted to its committed state — the tree with no
 *    diagnostic in it — and pasted here verbatim. So this is a before/after
 *    comparison, not a self-fulfilling snapshot, and it fails the moment the
 *    diagnostic starts changing what it reports on.
 * 3. **The diagnostic itself**, in both directions the ruling pins.
 *
 * ## Why probes rather than the real `data-table`
 *
 * `@object-ui/components` depends on THIS package, so importing a real renderer
 * here would be a dependency cycle. The probes stand in for the two families
 * exactly where they differ: `SchemaReadingProbe` reads `schema.<key>` (what
 * `statistic`, `card`, `data-table` and every other component renderer do),
 * `BothBagsProbe` merges both bags the way the `element:*` family's
 * `readProps()` does. The end-to-end four-leg reading through the real
 * `data-table` lives in
 * `packages/components/src/__tests__/data-table-node-data-diagnostic.test.tsx`
 * (objectui#6665) and stays green unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import {
  DROPPED_PROPS_BAG_PREFIX,
  collectDroppedPropsKeys,
  formatDroppedPropsBagMessage,
  readsPropsBag,
  __resetDroppedPropsBagWarnings,
} from '../utils/propsBagDiagnostic';

/** The provider really does hold the path every expression below spells. */
const DATA = { customers: ['ada', 'grace'] };

const renderWithData = (schema: unknown) =>
  render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );

/**
 * Only this diagnostic's own lines. Filtered by its prefix rather than by call
 * count: these renders go through the REAL `SchemaRenderer`, and an unrelated
 * warning must not be able to satisfy — or break — an assertion about this one.
 */
const warnings = (): string[] =>
  ((console.warn as unknown as { mock?: { calls: unknown[][] } }).mock?.calls ?? [])
    .map(c => String(c[0]))
    .filter(m => m.startsWith(DROPPED_PROPS_BAG_PREFIX));

/* -------------------------------------------------------------------------- *
 * 1 + 2 — the asymmetry, and what renderers receive
 * -------------------------------------------------------------------------- */

/**
 * Captured on `faac0d935` with `packages/react/src/SchemaRenderer.tsx` reverted
 * to its committed blob (`57c0beb3f`), i.e. with no diagnostic in the tree, by
 * running exactly the cases below. Pasted verbatim — see this file's header for
 * why that provenance is the point.
 *
 * Read it as the mechanism written out: on `componentProps` the React prop
 * `data` holds the evaluated array while `schemaDotData` is `null`, and on
 * `propertiesOnly` the SAME key is on the node. That pair is the card.
 */
const BASE_READING: Record<string, unknown> = JSON.parse(`{
  "componentProps": {
    "propKeys": ["className","data","data-obj-id","data-obj-type","disabled","id","props","schema","title"],
    "restSnapshot": {
      "id": "n1",
      "props": {"data":["ada","grace"],"title":"T"},
      "data": ["ada","grace"],
      "title": "T",
      "data-obj-id": "n1",
      "data-obj-type": "test:cap"
    },
    "schemaSnapshot": {"type":"test:cap","id":"n1","props":{"data":["ada","grace"],"title":"T"}},
    "schemaDotData": null,
    "schemaDotTitle": null
  },
  "elementProps": {
    "propKeys": ["className","content","data-obj-id","data-obj-type","disabled","id","props","schema"],
    "restSnapshot": {
      "id": "n2",
      "props": {"content":"X"},
      "content": "X",
      "data-obj-id": "n2",
      "data-obj-type": "element:cap"
    },
    "schemaSnapshot": {"type":"element:cap","id":"n2","props":{"content":"X"}},
    "schemaDotData": null,
    "schemaDotTitle": null
  },
  "propertiesOnly": {
    "propKeys": ["className","data","data-obj-id","data-obj-type","disabled","id","properties","schema"],
    "restSnapshot": {
      "id": "n3",
      "properties": {"data":["ada","grace"]},
      "data": ["ada","grace"],
      "data-obj-id": "n3",
      "data-obj-type": "test:cap"
    },
    "schemaSnapshot": {"type":"test:cap","id":"n3","properties":{"data":["ada","grace"]},"data":["ada","grace"]},
    "schemaDotData": ["ada","grace"],
    "schemaDotTitle": null
  },
  "bothBags": {
    "propKeys": [
      "a",
      "b",
      "className",
      "data-obj-id",
      "data-obj-type",
      "disabled",
      "id",
      "properties",
      "props",
      "schema"
    ],
    "restSnapshot": {
      "id": "n4",
      "props": {"a":"fromProps","b":"onlyProps"},
      "properties": {"a":"fromProperties"},
      "a": "fromProperties",
      "b": "onlyProps",
      "data-obj-id": "n4",
      "data-obj-type": "test:cap"
    },
    "schemaSnapshot": {
      "type": "test:cap",
      "id": "n4",
      "props": {"a":"fromProps","b":"onlyProps"},
      "properties": {"a":"fromProperties"},
      "a": "fromProperties"
    },
    "schemaDotData": null,
    "schemaDotTitle": null
  },
  "emptyProps": {
    "propKeys": ["className","data-obj-id","data-obj-type","disabled","id","props","schema"],
    "restSnapshot": {"id":"n5","props":{},"data-obj-id":"n5","data-obj-type":"test:cap"},
    "schemaSnapshot": {"type":"test:cap","id":"n5","props":{}},
    "schemaDotData": null,
    "schemaDotTitle": null
  },
  "noBags": {
    "propKeys": ["className","data-obj-id","data-obj-type","disabled","id","schema","title"],
    "restSnapshot": {"id":"n6","title":"plain","data-obj-id":"n6","data-obj-type":"test:cap"},
    "schemaSnapshot": {"type":"test:cap","id":"n6","title":"plain"},
    "schemaDotData": null,
    "schemaDotTitle": "plain"
  },
  "viewSimple": {
    "propKeys": ["className","columns","data-obj-id","data-obj-type","disabled","id","props","schema"],
    "restSnapshot": {"id":"n7","props":{"columns":3},"columns":3,"data-obj-id":"n7","data-obj-type":"view:simple"},
    "schemaSnapshot": {"type":"view:simple","id":"n7","props":{"columns":3}},
    "schemaDotData": null,
    "schemaDotTitle": null
  }
}`);

/** Everything the component was handed, minus what cannot be compared. */
function snap(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'function') return '[fn]';
      if (v && typeof v === 'object' && (v as { $$typeof?: unknown }).$$typeof) return '[react]';
      return v;
    }) ?? 'null',
  );
}

const captured: Record<string, unknown> = {};

/** Reads its config from `schema` — the normal component-renderer shape. */
const makeCapturingProbe = (label: string) => (props: Record<string, unknown>) => {
  const { schema, children: _children, ...rest } = props as {
    schema?: Record<string, unknown>;
    children?: unknown;
  } & Record<string, unknown>;
  captured[label] = {
    propKeys: Object.keys(props).sort(),
    restSnapshot: snap(rest),
    schemaSnapshot: snap(schema),
    schemaDotData: snap(schema?.data ?? null),
    schemaDotTitle: snap(schema?.title ?? null),
  };
  return <div data-testid={label} />;
};

/**
 * The seven nodes, one per envelope shape. `test:cap` and `element:cap` are the
 * two families; `view:simple` is the one non-`element:` type measured to read
 * the raw bag (`plugin-view`'s `SimpleViewRenderer` reads `schema.props.columns`).
 */
const CAPTURE_CASES: ReadonlyArray<readonly [string, unknown]> = [
  ['componentProps', { type: 'test:cap', id: 'n1', props: { data: '${data.customers}', title: 'T' } }],
  ['elementProps', { type: 'element:cap', id: 'n2', props: { content: 'X' } }],
  ['propertiesOnly', { type: 'test:cap', id: 'n3', properties: { data: '${data.customers}' } }],
  [
    'bothBags',
    {
      type: 'test:cap',
      id: 'n4',
      props: { a: 'fromProps', b: 'onlyProps' },
      properties: { a: 'fromProperties' },
    },
  ],
  ['emptyProps', { type: 'test:cap', id: 'n5', props: {} }],
  ['noBags', { type: 'test:cap', id: 'n6', title: 'plain' }],
  ['viewSimple', { type: 'view:simple', id: 'n7', props: { columns: 3 } }],
];

describe('objectui#6708 — the `props` / `properties` asymmetry, re-measured on this base', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    __resetDroppedPropsBagWarnings();
    for (const key of Object.keys(captured)) delete captured[key];
    for (const [label] of CAPTURE_CASES) {
      ComponentRegistry.register('cap', makeCapturingProbe(label), {
        namespace: 'test',
        skipFallback: true,
      });
      ComponentRegistry.register('cap', makeCapturingProbe(label), {
        namespace: 'element',
        skipFallback: true,
      });
      // Registered under a namespace so the bare `view:simple` fallback key is
      // the one the node resolves through; registering with NO namespace would
      // trip the registry's own deprecation warning.
      ComponentRegistry.register('view:simple', makeCapturingProbe(label), {
        namespace: 'test-6708',
      });
      const { unmount } = renderWithData(CAPTURE_CASES.find(([l]) => l === label)![1]);
      unmount();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ComponentRegistry.unregister?.('cap', 'test');
    ComponentRegistry.unregister?.('cap', 'element');
    ComponentRegistry.unregister?.('view:simple', 'test-6708');
  });

  it('leg 2 — the key under `props` is EVALUATED and then not on the node', () => {
    const leg = captured.componentProps as Record<string, unknown>;
    // Evaluation happened: the React prop holds the resolved array, not the
    // `${...}` source. So this is not "the expression never ran".
    expect((leg.restSnapshot as Record<string, unknown>).data).toEqual(['ada', 'grace']);
    // And the renderer, which reads `schema`, sees nothing.
    expect(leg.schemaDotData).toBeNull();
  });

  it('leg 3 — the SAME key under `properties` IS on the node', () => {
    const leg = captured.propertiesOnly as Record<string, unknown>;
    expect(leg.schemaDotData).toEqual(['ada', 'grace']);
  });

  it('the two legs differ ONLY in the envelope — that pair is the card', () => {
    const two = captured.componentProps as Record<string, unknown>;
    const three = captured.propertiesOnly as Record<string, unknown>;
    // Same value reaches the element on both legs...
    expect((two.restSnapshot as Record<string, unknown>).data).toEqual(
      (three.restSnapshot as Record<string, unknown>).data,
    );
    // ...and only one of them reaches a `schema` reader.
    expect(two.schemaDotData).toBeNull();
    expect(three.schemaDotData).not.toBeNull();
  });

  it('changes NOTHING any renderer receives — every case, against the pre-diagnostic tree', () => {
    // Acceptance pin 4, measured rather than asserted. `BASE_READING` was taken
    // on the committed `SchemaRenderer.tsx`; this run has the diagnostic in it.
    expect(captured).toEqual(BASE_READING);
  });

  it('objectui#5123 precedence is untouched: `properties` still wins a shared key', () => {
    const both = (captured.bothBags as Record<string, unknown>).restSnapshot as Record<string, unknown>;
    expect(both.a).toBe('fromProperties');
    expect(both.b).toBe('onlyProps');
  });
});

/* -------------------------------------------------------------------------- *
 * 3 — the diagnostic
 * -------------------------------------------------------------------------- */

/** Reads `schema.<key>`, like `statistic` / `card` / `data-table`. */
const SchemaReadingProbe = ({ schema }: { schema: Record<string, unknown> }) => (
  <div data-testid="schema-probe">{String(schema.title ?? '')}</div>
);

/** Merges both bags, like the `element:*` family's `readProps()`. */
const BothBagsProbe = ({ schema }: { schema: Record<string, unknown> }) => {
  const merged = {
    ...((schema.props as Record<string, unknown>) ?? {}),
    ...((schema.properties as Record<string, unknown>) ?? {}),
  };
  return <div data-testid="element-probe">{String(merged.content ?? '')}</div>;
};

describe('objectui#6708 — the SchemaRenderer-tier diagnostic', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    __resetDroppedPropsBagWarnings();
    ComponentRegistry.register('probe', SchemaReadingProbe, {
      namespace: 'test-6708',
      skipFallback: true,
    });
    ComponentRegistry.register('probe', BothBagsProbe, {
      namespace: 'element',
      skipFallback: true,
    });
    ComponentRegistry.register('view:simple', SchemaReadingProbe, { namespace: 'test-6708' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ComponentRegistry.unregister?.('probe', 'test-6708');
    ComponentRegistry.unregister?.('probe', 'element');
    ComponentRegistry.unregister?.('view:simple', 'test-6708');
  });

  it('PIN 1 — fires on a component-renderer node, naming the node and pointing at `properties`', () => {
    renderWithData({
      type: 'test-6708:probe',
      id: 'customers-table',
      props: { data: '${data.customers}' },
    });

    const lines = warnings();
    expect(lines).toHaveLength(1);
    // The ADDRESS: which node, spelled the way the author wrote it.
    expect(lines[0]).toContain('`test-6708:probe`');
    expect(lines[0]).toContain("(id: 'customers-table')");
    // The KEY that was dropped.
    expect(lines[0]).toContain('`data`');
    // The MECHANISM, and the way out the ruling asked it to point at.
    expect(lines[0]).toContain('`props` is NOT hoisted onto the node');
    expect(lines[0]).toContain('Write it under `properties` instead');
    expect(lines[0]).toContain('objectui#6708');
  });

  it('PIN 2 — stays SILENT on an `element:*` node, where `props` is legitimate', () => {
    // That family's `readProps()` merges `{ ...schema.props, ...schema.properties }`,
    // so the key is not dropped and a warning here would be false. The ruling
    // pins this direction explicitly.
    renderWithData({ type: 'element:probe', id: 'blurb', props: { content: 'hello' } });
    expect(warnings()).toEqual([]);
  });

  it('PIN 3 — stays SILENT on a plain `properties` node', () => {
    renderWithData({ type: 'test-6708:probe', id: 'ok', properties: { title: 'hello' } });
    expect(warnings()).toEqual([]);
  });

  it('stays SILENT on a node that authored neither bag', () => {
    renderWithData({ type: 'test-6708:probe', id: 'plain', title: 'hello' });
    expect(warnings()).toEqual([]);
  });

  it('is not fooled by an EMPTY `props` bag — nothing was authored, nothing was lost', () => {
    renderWithData({ type: 'test-6708:probe', id: 'empty', props: {} });
    expect(warnings()).toEqual([]);
  });

  it('stays SILENT when `properties` already declares every `props` key', () => {
    // objectui#5123 subtracted those keys from the outgoing bag, so the author
    // is getting the canonical answer and nothing was silently dropped.
    renderWithData({
      type: 'test-6708:probe',
      id: 'shadowed',
      props: { title: 'fromProps' },
      properties: { title: 'fromProperties' },
    });
    expect(warnings()).toEqual([]);
  });

  it('names ONLY the key `properties` does not also declare', () => {
    renderWithData({
      type: 'test-6708:probe',
      id: 'mixed',
      props: { title: 'fromProps', subtitle: 'onlyProps' },
      properties: { title: 'fromProperties' },
    });
    const lines = warnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('`subtitle`');
    expect(lines[0]).not.toContain('`title`');
  });

  it('stays SILENT on `view:simple`, the one measured non-`element:` reader of the bag', () => {
    renderWithData({ type: 'view:simple', id: 'grid', props: { columns: 3 } });
    expect(warnings()).toEqual([]);
  });

  it('stays SILENT on a degenerate, non-object `props`', () => {
    // A different, shape-level defect with a different consequence, and there is
    // no config bag to point the author at.
    //
    // This one is load-bearing rather than defensive. The evaluation memo
    // rebuilds `props` with `{ ...newSchema.props }` under a bare truthiness
    // guard, so by the time the diagnostic runs a string has already become
    // `{ '0': 'n', '1': 'o', … }` — nine keys that ARE spread as React props and
    // genuinely do not reach `schema`. Reading only that bag made this test fail
    // with a message naming `schema.0`, which is why the AUTHORED bag is read
    // too. Deleting that guard turns this red again.
    renderWithData({ type: 'test-6708:probe', id: 'degenerate', props: 'not-a-bag' });
    expect(warnings()).toEqual([]);
  });

  it('stays SILENT on an array `props`, for the same reason', () => {
    renderWithData({ type: 'test-6708:probe', id: 'arrayish', props: ['a', 'b'] });
    expect(warnings()).toEqual([]);
  });

  it('says it ONCE for one authoring bug repeated across nodes', () => {
    // The census case the dedupe exists for: a generator emitting the same wrong
    // envelope on many nodes. Those are distinct schema objects, so an
    // object-keyed dedupe would print one line each.
    renderWithData({ type: 'test-6708:probe', props: { data: 1 } });
    renderWithData({ type: 'test-6708:probe', props: { data: 1 } });
    expect(warnings()).toHaveLength(1);
  });

  it('still gives two genuinely different nodes two lines', () => {
    renderWithData({ type: 'test-6708:probe', id: 'first', props: { data: 1 } });
    renderWithData({ type: 'test-6708:probe', id: 'second', props: { data: 1 } });
    expect(warnings()).toHaveLength(2);
  });

  it('does not repeat itself across a re-render of the same node', () => {
    const node = { type: 'test-6708:probe', id: 'rerendered', props: { data: 1 } };
    const { rerender } = renderWithData(node);
    rerender(
      <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as never}>
        <SchemaRenderer schema={node as never} />
      </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
    );
    expect(warnings()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- *
 * The pure halves, asserted directly — a diagnostic whose only test is "a spy
 * was called" goes green the moment someone no-ops it.
 * -------------------------------------------------------------------------- */

describe('objectui#6708 — readsPropsBag', () => {
  it.each([
    ['element:text', true],
    ['element:definition-list', true],
    ['element:', true],
    ['view:simple', true],
    ['data-table', false],
    ['card', false],
    ['statistic', false],
    ['view:grid', false],
    ['text', false],
    ['', false],
  ] as const)('%s -> %s', (type, expected) => {
    expect(readsPropsBag(type)).toBe(expected);
  });

  it('answers false for a non-string type rather than throwing', () => {
    expect(readsPropsBag(undefined)).toBe(false);
    expect(readsPropsBag(42)).toBe(false);
    expect(readsPropsBag(null)).toBe(false);
  });
});

describe('objectui#6708 — collectDroppedPropsKeys', () => {
  it('returns the authored keys for a component-renderer node', () => {
    const bag = { data: 1, title: 'x' };
    expect(collectDroppedPropsKeys('card', bag, bag)).toEqual(['data', 'title']);
  });

  it.each([
    ['the readProps family', 'element:text', { content: 'x' }, { content: 'x' }],
    ['an empty outgoing bag', 'card', { title: 'x' }, {}],
    ['no bag at all', 'card', undefined, undefined],
    ['a string authored bag', 'card', 'nope', { 0: 'n', 1: 'o' }],
    ['an array authored bag', 'card', ['nope'], { 0: 'nope' }],
    ['a null authored bag', 'card', null, null],
  ] as const)('returns null for %s', (_label, type, authored, outgoing) => {
    expect(collectDroppedPropsKeys(type, authored, outgoing)).toBeNull();
  });

  it('reads BOTH bags — an authored object with an emptied outgoing bag is silent', () => {
    // The objectui#5123 case: `properties` declared the same key, so it was
    // subtracted from the outgoing bag and the author has the canonical answer.
    expect(collectDroppedPropsKeys('card', { title: 'fromProps' }, {})).toBeNull();
  });
});

describe('objectui#6708 — formatDroppedPropsBagMessage', () => {
  it('reads as one sentence for a single key', () => {
    const message = formatDroppedPropsBagMessage('card', 'summary', ['title']);
    expect(message.startsWith(DROPPED_PROPS_BAG_PREFIX)).toBe(true);
    expect(message).toContain('Key under `props`: `title`');
    expect(message).toContain('`schema.title` is undefined');
    expect(message).toContain('Write it under `properties` instead');
  });

  it('pluralises, and lists every key, for more than one', () => {
    const message = formatDroppedPropsBagMessage('card', undefined, ['title', 'subtitle']);
    expect(message).toContain('Keys under `props`: `title`, `subtitle`');
    expect(message).toContain('Write them under `properties` instead');
    // No id was authored, so none is claimed.
    expect(message).not.toContain('(id:');
  });

  it('does not pretend to know an untyped node', () => {
    expect(formatDroppedPropsBagMessage(undefined, undefined, ['x'])).toContain('(untyped node)');
  });
});
