/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6752 — a non-object `props` was object-spread into indexed React
 * props: `props: 'not-a-bag'` reached the element as `0`, `1`, `2`, …
 *
 * ## Why this card landed as a guard rather than as a comment
 *
 * Triage dispatched it measurement-first: read WHY the sibling `properties`
 * branch carries a wider guard, then let the reason pick the arm. If the reason
 * is channel-independent the missing `props` guard is an oversight (widen it);
 * if it is hoist-specific the asymmetry is intended (document it instead).
 *
 * The reason was measured, not read off the comment — and the comment turned
 * out to be wrong about its own guard. On `b76ca6764`, ablating the
 * `properties` guard to bare truthiness and re-rendering
 * `{ type, properties: 'not-a-bag' }` left the indexed keys the hoist puts on
 * the node COMPLETELY UNCHANGED (`0` … `8` either way): the hoist's own
 * `Object.entries` walk enumerates a string's character indices whatever that
 * guard did. Exactly one thing moved — whether `schema.properties` still holds
 * the value the author wrote (`'not-a-bag'` guarded, `{ '0': 'n', … }`
 * ablated). So the guard buys the AUTHORED value's shape, which is
 * channel-independent, and the repo already states it that way at a second,
 * non-hoist site: `propsWithoutCanonicalKeys` excludes a degenerate bag
 * "for the same reason the evaluation guard excludes them — a degenerate
 * `properties` must not have its shape reinterpreted here."
 *
 * ⇒ arm 1. The `props` branch was missing the same guard for the same reason.
 *
 * ## Why the fix has two halves
 *
 * Measured, not assumed. With ONLY the evaluation memo's guard widened, the
 * nine indexed props came BACK: the bag reached `propsWithoutCanonicalKeys` as
 * the authored string, was returned unchanged, and `{ ...outgoingPropsBag }` at
 * the `createElement` call re-enumerated it. Both sites object-spread the bag,
 * so both needed the predicate.
 *
 * ## `BASE_READING`
 *
 * Captured on `b76ca6764` — this branch's base, with `SchemaRenderer.tsx` at its
 * committed blob `1e48de087` and no part of this card in the tree — by
 * rendering exactly the nodes below through the real `SchemaRenderer`, and
 * pasted verbatim. It is the pre-fix tree, so the "unchanged" legs are a real
 * before/after comparison rather than a snapshot this file wrote for itself,
 * and the degenerate legs pin a shape that was MEASURED to be there before the
 * guard removed it. A pin that never went red is not evidence.
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
  __resetDroppedPropsBagWarnings,
} from '../utils/propsBagDiagnostic';

/** The provider really does hold the path the object-bag case spells. */
const DATA = { customers: ['ada', 'grace'] };

const renderWithData = (schema: unknown) =>
  render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );

const snap = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

interface Reading {
  propKeys: string[];
  indexedPropKeys: string[];
  propsReactProp: unknown;
  propertiesReactProp: unknown;
  schemaProps: unknown;
  schemaProperties: unknown;
}

const captured: Record<string, Reading> = {};

/**
 * Records BOTH channels: the React props the element actually receives, and
 * what a `({ schema })` renderer reads. `indexedPropKeys` is the card's whole
 * subject, isolated so a failure names it instead of burying it in a diff of
 * every prop.
 */
const makeProbe = (label: string) => {
  const Probe: React.FC<Record<string, unknown> & { schema?: Record<string, unknown> }> = ({
    schema,
    ...rest
  }) => {
    captured[label] = {
      propKeys: Object.keys(rest).sort(),
      indexedPropKeys: Object.keys(rest)
        .filter(k => /^\d+$/.test(k))
        .sort(),
      propsReactProp: snap(rest.props ?? null),
      propertiesReactProp: snap(rest.properties ?? null),
      schemaProps: snap(schema?.props ?? null),
      schemaProperties: snap(schema?.properties ?? null),
    };
    return <div data-testid={label} />;
  };
  return Probe;
};

/** One node per envelope shape the card names. `not-a-bag` is nine characters. */
const CASES: ReadonlyArray<readonly [string, unknown]> = [
  ['propsString', { type: 'test:deg', id: 'a', props: 'not-a-bag' }],
  ['propertiesString', { type: 'test:deg', id: 'b', properties: 'not-a-bag' }],
  ['propsArray', { type: 'test:deg', id: 'c', props: ['x', 'y'] }],
  ['propsNumber', { type: 'test:deg', id: 'd', props: 42 }],
  ['propsTrue', { type: 'test:deg', id: 'e', props: true }],
  ['propsObject', { type: 'test:deg', id: 'f', props: { title: 'T', data: '${data.customers}' } }],
  ['propertiesArray', { type: 'test:deg', id: 'g', properties: ['x', 'y'] }],
];

const BASE_READING: Record<string, Reading> = JSON.parse(`{
  "propsString": {"propKeys":["0","1","2","3","4","5","6","7","8","className","data-obj-id","data-obj-type","disabled","id","props"],"indexedPropKeys":["0","1","2","3","4","5","6","7","8"],"propsReactProp":{"0":"n","1":"o","2":"t","3":"-","4":"a","5":"-","6":"b","7":"a","8":"g"},"propertiesReactProp":null,"schemaProps":{"0":"n","1":"o","2":"t","3":"-","4":"a","5":"-","6":"b","7":"a","8":"g"},"schemaProperties":null},
  "propertiesString": {"propKeys":["0","1","2","3","4","5","6","7","8","className","data-obj-id","data-obj-type","disabled","id","properties"],"indexedPropKeys":["0","1","2","3","4","5","6","7","8"],"propsReactProp":null,"propertiesReactProp":"not-a-bag","schemaProps":null,"schemaProperties":"not-a-bag"},
  "propsArray": {"propKeys":["0","1","className","data-obj-id","data-obj-type","disabled","id","props"],"indexedPropKeys":["0","1"],"propsReactProp":{"0":"x","1":"y"},"propertiesReactProp":null,"schemaProps":{"0":"x","1":"y"},"schemaProperties":null},
  "propsNumber": {"propKeys":["className","data-obj-id","data-obj-type","disabled","id","props"],"indexedPropKeys":[],"propsReactProp":{},"propertiesReactProp":null,"schemaProps":{},"schemaProperties":null},
  "propsTrue": {"propKeys":["className","data-obj-id","data-obj-type","disabled","id","props"],"indexedPropKeys":[],"propsReactProp":{},"propertiesReactProp":null,"schemaProps":{},"schemaProperties":null},
  "propsObject": {"propKeys":["className","data","data-obj-id","data-obj-type","disabled","id","props","title"],"indexedPropKeys":[],"propsReactProp":{"title":"T","data":["ada","grace"]},"propertiesReactProp":null,"schemaProps":{"title":"T","data":["ada","grace"]},"schemaProperties":null},
  "propertiesArray": {"propKeys":["0","1","className","data-obj-id","data-obj-type","disabled","id","properties"],"indexedPropKeys":["0","1"],"propsReactProp":null,"propertiesReactProp":["x","y"],"schemaProps":null,"schemaProperties":["x","y"]}
}`);

describe('objectui#6752 — a degenerate `props` bag is no longer spread into indexed React props', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    __resetDroppedPropsBagWarnings();
    for (const key of Object.keys(captured)) delete captured[key];
    for (const [label, schema] of CASES) {
      ComponentRegistry.register('deg', makeProbe(label), {
        namespace: 'test',
        skipFallback: true,
      });
      const { unmount } = renderWithData(schema);
      unmount();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ComponentRegistry.unregister?.('deg', 'test');
  });

  /* ---------------------------------------------------------------- *
   * 1 — the defect, and that it was really there
   * ---------------------------------------------------------------- */

  it('pins the pre-fix shape the card reported: nine React props named `0`…`8`', () => {
    // Not an assertion about today's tree — it states what BASE_READING holds,
    // so a future edit that quietly rewrites this constant to match a changed
    // renderer has to lie in public rather than in passing.
    expect(BASE_READING.propsString.indexedPropKeys).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8',
    ]);
    expect(BASE_READING.propsString.propsReactProp).toEqual({
      0: 'n', 1: 'o', 2: 't', 3: '-', 4: 'a', 5: '-', 6: 'b', 7: 'a', 8: 'g',
    });
  });

  it('a string `props` now reaches the element with NO indexed props', () => {
    expect(captured.propsString.indexedPropKeys).toEqual([]);
    // The exact shape that must not come back, named rather than implied.
    for (const k of ['0', '1', '2', '3', '4', '5', '6', '7', '8']) {
      expect(captured.propsString.propKeys).not.toContain(k);
    }
  });

  it('an array, a number and a boolean `props` contribute no keys either', () => {
    expect(captured.propsArray.indexedPropKeys).toEqual([]);
    expect(captured.propsNumber.indexedPropKeys).toEqual([]);
    expect(captured.propsTrue.indexedPropKeys).toEqual([]);
  });

  it('the authored value survives instead of the spread’s reading of it', () => {
    // `props` is passed through as a React prop of that name (unchanged by this
    // card); what changed is that it now carries what the author wrote.
    expect(captured.propsString.propsReactProp).toBe('not-a-bag');
    expect(captured.propsArray.propsReactProp).toEqual(['x', 'y']);
    expect(captured.propsNumber.propsReactProp).toBe(42);
    expect(captured.propsTrue.propsReactProp).toBe(true);
    // …and a `({ schema })` renderer reads the same authored value.
    expect(captured.propsString.schemaProps).toBe('not-a-bag');
  });

  /* ---------------------------------------------------------------- *
   * 2 — what must NOT move (this is what catches an over-broad guard)
   * ---------------------------------------------------------------- */

  it('a normal object `props` is byte-for-byte what it was before this card', () => {
    expect(captured.propsObject).toEqual(BASE_READING.propsObject);
    // Spelled out, because this is the leg that fails if the guard is too wide:
    // the bag is still evaluated (`${data.customers}` collapsed) and still
    // spread as individual React props.
    expect(captured.propsObject.propKeys).toContain('title');
    expect(captured.propsObject.propKeys).toContain('data');
    expect(captured.propsObject.propsReactProp).toEqual({
      title: 'T',
      data: ['ada', 'grace'],
    });
  });

  it('the `properties` channel: this card changed one bag, and the other half is now closed too', () => {
    // The leg objectui#6752 owns, unchanged: the AUTHORED `properties` value
    // still reaches both channels exactly as BASE_READING recorded it. This
    // card changed one bag, and that is still true.
    expect(captured.propertiesString.propertiesReactProp).toEqual(
      BASE_READING.propertiesString.propertiesReactProp,
    );
    expect(captured.propertiesString.schemaProperties).toEqual(
      BASE_READING.propertiesString.schemaProperties,
    );
    expect(captured.propertiesArray.propertiesReactProp).toEqual(
      BASE_READING.propertiesArray.propertiesReactProp,
    );
    expect(captured.propertiesArray.schemaProperties).toEqual(
      BASE_READING.propertiesArray.schemaProperties,
    );

    // ⬆ RATCHET, not a weakening (objectui#6760). This leg used to assert the
    // WHOLE `properties` reading still equalled BASE_READING, and said so
    // explicitly as "recorded, not fixed": the hoist's own `Object.entries`
    // walk still put `0`…`8` on the node, out of this card's scope (which
    // forbids changing hoist behaviour) and filed as objectui#6760. That card
    // guarded the hoist, so the equality is now false in the direction of LESS
    // leakage, and the assertion tightens with it — from "nine indexed props,
    // exactly as before" to "none at all". Nothing this file asserted about
    // the `props` bag moved; the pre-fix shape it used to pin lives on as
    // history in `SchemaRenderer.degeneratePropertiesHoist.test.tsx`, which
    // owns the hoist half from here.
    expect(BASE_READING.propertiesString.indexedPropKeys).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8',
    ]);
    expect(captured.propertiesString.indexedPropKeys).toEqual([]);
    expect(captured.propertiesArray.indexedPropKeys).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 3 — objectui#6708's diagnostic is undisturbed
   * ---------------------------------------------------------------- */

  describe('objectui#6708’s dropped-`props` diagnostic still behaves exactly as it did', () => {
    const warnings = (): string[] =>
      ((console.warn as unknown as { mock?: { calls: unknown[][] } }).mock?.calls ?? [])
        .map(c => String(c[0]))
        .filter(m => m.startsWith(DROPPED_PROPS_BAG_PREFIX));

    it('stays silent on a degenerate bag — it reads the AUTHORED bag', () => {
      // It was already silent here before this card (it reads `schema.props`,
      // not the rebuilt one). It must still be silent, and for the same reason:
      // a string is not a config bag, so there is no key to point at.
      vi.mocked(console.warn).mockClear();
      __resetDroppedPropsBagWarnings();
      const { unmount } = renderWithData({ type: 'test:deg', id: 'z1', props: 'not-a-bag' });
      expect(warnings()).toEqual([]);
      unmount();
    });

    it('still fires on a real bag a `schema`-reading renderer would drop', () => {
      vi.mocked(console.warn).mockClear();
      __resetDroppedPropsBagWarnings();
      const { unmount } = renderWithData({ type: 'test:deg', id: 'z2', props: { title: 'T' } });
      const lines = warnings();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('`title`');
      unmount();
    });
  });
});
