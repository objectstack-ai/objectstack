/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6760 — the `properties` hoist enumerated a DEGENERATE `properties`
 * into indexed node keys: `properties: 'not-a-bag'` reached the element as
 * nine React props named `0` … `8`.
 *
 * ## The half objectui#6752 left open, and why it was the loud half
 *
 * objectui#6752 fixed the `props` bag. Its sibling `properties` — the SPEC
 * spelling, of which `props` is the annotated legacy alias — stayed open, and
 * the site was never the evaluation memo's guard: it is the hoist's own
 * `Object.entries` walk, which enumerates a string's character indices
 * whatever any guard upstream of it did. That is a MEASURED fact, not a
 * reading of a comment; see "Ablations" below.
 *
 * ## The arm
 *
 * The card left two, both cheap and both reversible: (a) guard the hoist the
 * way the evaluation memo is guarded, or (b) rule that the hoist may enumerate
 * whatever it is handed and say so at the hoist. Arm (a). The reasoning lives
 * where the code is — at the hoist in `SchemaRenderer.tsx` — and turns on
 * objectui#5123's "one answer per key, whichever channel reads it": arm (b)
 * would have answered ONE authored mistake two ways depending on which of two
 * spellings of one bag was used, with the reinterpreting half falling on the
 * canonical spelling.
 *
 * ## `BASE_READING`
 *
 * Captured on `c6732825d` — this branch's base, with `SchemaRenderer.tsx` at
 * its committed blob `e95eb4372` and no part of this card in the tree — by
 * rendering exactly the nodes below through the real `SchemaRenderer`, and
 * pasted verbatim. So the legs that assert "unchanged" are a real before/after
 * comparison, and the degenerate legs pin a shape that was measured to be
 * there before the guard removed it. A pin that never went red is not
 * evidence.
 *
 * ## Ablations, in both directions
 *
 * The card's own method note asks for what does NOT move as well as what does,
 * because its filing used ablation in REVERSE — to prove a guard was NOT
 * responsible for an output. Three runs, all on this branch with the fix
 * committed, each restored to `HEAD` and re-verified byte-identical after:
 *
 *   1. FORWARD — hoist guard back to bare `if (newSchema.properties)`:
 *      `0` … `8` return for a string bag, `0`, `1` for an array bag. So this
 *      card's guard is what removes them.
 *   2. REVERSE — evaluation memo's `isConfigBag` back to bare truthiness,
 *      hoist guard kept: on the card's base this changed NOTHING (that is how
 *      the memo's old "because the value feeds the hoist" comment was
 *      falsified). On this branch it reads the OTHER way — the indexed keys
 *      come back, AND the `properties` a renderer reads becomes
 *      `{ '0': 'n', … }` instead of `'not-a-bag'`, because the bare spread
 *      manufactures a real bag out of the string and the hoist then
 *      enumerates it legitimately. The two guards are in SERIES after this
 *      card, not redundant: the memo's keeps the authored value's shape, and
 *      this card's declines to enumerate a value that never had keys. The
 *      file says so at both sites.
 *   3. REVERSE — `propsWithoutCanonicalKeys`' `isConfigBag(propertiesBag)`
 *      early return back to bare truthiness: NOTHING moves in any leg here.
 *      That site decides objectui#5123 precedence between two co-present bags
 *      and never fed the indexed keys, so this card must not be credited to
 *      it.
 *
 * No rebuild is involved in any of the three: this file imports
 * `../SchemaRenderer` by relative path, so vitest reads the source tree, not a
 * `dist/`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

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

/**
 * One node per envelope shape. `not-a-bag` is nine characters.
 *
 * `propertiesNumber` / `propertiesTrue` are here precisely because they did
 * NOT move: `Object.entries(42)` was already empty, so they say where this
 * guard's reach stops. `propertiesObjectInnerType` is the `page:tabs` node the
 * hoist's `type`/`id` protection exists for.
 */
const CASES: ReadonlyArray<readonly [string, unknown]> = [
  ['propertiesString', { type: 'test:deg', id: 'b', properties: 'not-a-bag' }],
  ['propertiesArray', { type: 'test:deg', id: 'g', properties: ['x', 'y'] }],
  ['propertiesNumber', { type: 'test:deg', id: 'h', properties: 42 }],
  ['propertiesTrue', { type: 'test:deg', id: 'i', properties: true }],
  [
    'propertiesObject',
    { type: 'test:deg', id: 'j', properties: { title: 'T', data: '${data.customers}' } },
  ],
  ['propertiesObjectInnerType', { type: 'page:tabs', id: 'k', properties: { type: 'line', title: 'T' } }],
  ['bothBags', { type: 'test:deg', id: 'l', properties: 'not-a-bag', props: { title: 'P' } }],
];

const BASE_READING: Record<string, Reading> = JSON.parse(`{
  "propertiesString": {"propKeys":["0","1","2","3","4","5","6","7","8","className","data-obj-id","data-obj-type","disabled","id","properties"],"indexedPropKeys":["0","1","2","3","4","5","6","7","8"],"propsReactProp":null,"propertiesReactProp":"not-a-bag","schemaProps":null,"schemaProperties":"not-a-bag"},
  "propertiesArray": {"propKeys":["0","1","className","data-obj-id","data-obj-type","disabled","id","properties"],"indexedPropKeys":["0","1"],"propsReactProp":null,"propertiesReactProp":["x","y"],"schemaProps":null,"schemaProperties":["x","y"]},
  "propertiesNumber": {"propKeys":["className","data-obj-id","data-obj-type","disabled","id","properties"],"indexedPropKeys":[],"propsReactProp":null,"propertiesReactProp":42,"schemaProps":null,"schemaProperties":42},
  "propertiesTrue": {"propKeys":["className","data-obj-id","data-obj-type","disabled","id","properties"],"indexedPropKeys":[],"propsReactProp":null,"propertiesReactProp":true,"schemaProps":null,"schemaProperties":true},
  "propertiesObject": {"propKeys":["className","data","data-obj-id","data-obj-type","disabled","id","properties","title"],"indexedPropKeys":[],"propsReactProp":null,"propertiesReactProp":{"title":"T","data":["ada","grace"]},"schemaProps":null,"schemaProperties":{"title":"T","data":["ada","grace"]}},
  "propertiesObjectInnerType": {"propKeys":["className","data-obj-id","data-obj-type","disabled","id","properties","title"],"indexedPropKeys":[],"propsReactProp":null,"propertiesReactProp":{"type":"line","title":"T"},"schemaProps":null,"schemaProperties":{"type":"line","title":"T"}},
  "bothBags": {"propKeys":["0","1","2","3","4","5","6","7","8","className","data-obj-id","data-obj-type","disabled","id","properties","props","title"],"indexedPropKeys":["0","1","2","3","4","5","6","7","8"],"propsReactProp":{"title":"P"},"propertiesReactProp":"not-a-bag","schemaProps":{"title":"P"},"schemaProperties":"not-a-bag"}
}`);

describe('objectui#6760 — a degenerate `properties` is no longer hoisted into indexed node keys', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const key of Object.keys(captured)) delete captured[key];
    for (const [label, schema] of CASES) {
      const [namespace, name] = String((schema as { type: string }).type).split(':');
      ComponentRegistry.register(name, makeProbe(label), { namespace, skipFallback: true });
      const { unmount } = renderWithData(schema);
      unmount();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ComponentRegistry.unregister?.('deg', 'test');
    ComponentRegistry.unregister?.('tabs', 'page');
  });

  /* ---------------------------------------------------------------- *
   * 1 — the defect, and that it was really there
   * ---------------------------------------------------------------- */

  it('pins the pre-fix shape the card reported: nine node keys named `0`…`8`', () => {
    // Not an assertion about today's tree — it states what BASE_READING holds,
    // so a future edit that quietly rewrites this constant to match a changed
    // renderer has to lie in public rather than in passing.
    expect(BASE_READING.propertiesString.indexedPropKeys).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8',
    ]);
    expect(BASE_READING.propertiesArray.indexedPropKeys).toEqual(['0', '1']);
  });

  it('a string `properties` now reaches the element with NO indexed props', () => {
    expect(captured.propertiesString.indexedPropKeys).toEqual([]);
    // The exact shape that must not come back, named rather than implied.
    for (const k of ['0', '1', '2', '3', '4', '5', '6', '7', '8']) {
      expect(captured.propertiesString.propKeys).not.toContain(k);
    }
  });

  it('an array `properties` contributes no keys either', () => {
    expect(captured.propertiesArray.indexedPropKeys).toEqual([]);
    expect(captured.propertiesArray.propKeys).not.toContain('0');
  });

  it('the authored value survives instead of the hoist’s reading of it', () => {
    // `properties` is still passed through as a React prop of that name and is
    // still what a `({ schema })` renderer reads — unchanged by this card. What
    // changed is only that its CHARACTERS are no longer node keys.
    expect(captured.propertiesString.propertiesReactProp).toBe('not-a-bag');
    expect(captured.propertiesString.schemaProperties).toBe('not-a-bag');
    expect(captured.propertiesArray.propertiesReactProp).toEqual(['x', 'y']);
    expect(captured.propertiesArray.schemaProperties).toEqual(['x', 'y']);
  });

  it('a degenerate `properties` no longer drowns a co-declared real `props`', () => {
    // The two-bag node: `props: { title: 'P' }` was already reaching the
    // element before this card, buried among nine indexed keys. Only the noise
    // went away — objectui#5123's precedence is untouched, because a degenerate
    // bag declares no key for either spelling to win.
    expect(captured.bothBags.indexedPropKeys).toEqual([]);
    expect(captured.bothBags.propKeys).toContain('title');
    expect(captured.bothBags.propsReactProp).toEqual({ title: 'P' });
    expect(captured.bothBags.propertiesReactProp).toBe('not-a-bag');
  });

  /* ---------------------------------------------------------------- *
   * 2 — what must NOT move (this is what catches an over-broad guard)
   * ---------------------------------------------------------------- */

  it('a real object `properties` still hoists, byte-for-byte as before this card', () => {
    expect(captured.propertiesObject).toEqual(BASE_READING.propertiesObject);
    // Spelled out, because this is the leg that fails if the guard is too wide:
    // the bag is still evaluated (`${data.customers}` collapsed) and its keys
    // are still hoisted onto the node and spread as React props.
    expect(captured.propertiesObject.propKeys).toContain('title');
    expect(captured.propertiesObject.propKeys).toContain('data');
    expect(captured.propertiesObject.propertiesReactProp).toEqual({
      title: 'T',
      data: ['ada', 'grace'],
    });
  });

  it('the hoist still refuses to let an inner `type` shadow the descriptor', () => {
    // `page:tabs` with `properties.type: 'line'` — the reason HOIST_PROTECTED_KEYS
    // exists. Guarding the hoist must not disturb what the hoist does with a
    // real bag, including what it declines to copy.
    expect(captured.propertiesObjectInnerType).toEqual(BASE_READING.propertiesObjectInnerType);
    expect(captured.propertiesObjectInnerType.propKeys).not.toContain('type');
    expect(captured.propertiesObjectInnerType.propKeys).toContain('title');
  });

  it('a number and a boolean `properties` are byte-identical to the base — this guard never reached them', () => {
    // `Object.entries(42)` and `Object.entries(true)` were already empty, so
    // these two nodes were never part of the defect. Pinned so the card is not
    // credited with fixing them, and so an over-broad future guard that starts
    // dropping the `properties` React prop itself fails here.
    expect(captured.propertiesNumber).toEqual(BASE_READING.propertiesNumber);
    expect(captured.propertiesTrue).toEqual(BASE_READING.propertiesTrue);
  });
});
