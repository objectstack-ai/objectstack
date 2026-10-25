/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The question a gate can now ask — "is this type deprecated?" (objectui#6674).
 *
 * ## What could not be asked before
 *
 * Nothing. A component deprecation was stated in exactly two places, and no
 * gate, test or type can consult either one:
 *
 *   1. a `console.warn` STRING LITERAL inside the renderer
 *      (`packages/components/src/renderers/basic/div.tsx`, and the same shape
 *      in `span.tsx`), and
 *   2. the word "(Deprecated)" inside the human-readable `label`
 *      (`'Container (Deprecated)'`).
 *
 * Both gates that touch component types ask a DIFFERENT question — whether the
 * type RESOLVES. `examples/schema-catalog/test/catalog-gallery-render.test.tsx`
 * asserts `ComponentRegistry.get(type)` is truthy and that no OBJUI-001 panel
 * paints; `scripts/check-doc-component-types.mjs` asks the same existence
 * question over `content/docs/**`. A deprecated type resolves and renders, so
 * both stay green. objectui#6674 demonstrated the cost rather than arguing it:
 * that catalog suite passes 583/583 with 85 authored `div` nodes in the corpus.
 * The green WAS the finding.
 *
 * This lane's usual defect is "declared but enforced nowhere". This was a layer
 * below it: nothing was declared to enforce.
 *
 * ## What each case here pins
 *
 * The last case is the one that names the defect directly: a registration whose
 * label says "(Deprecated)" and whose renderer warns still answers `undefined`,
 * because PROSE IS NOT A DECLARATION. That case would have been green — with
 * the identical registration — before this reader existed, in the sense that
 * there was no reader to disagree with; it is here so the distinction the card
 * draws has a test that states it.
 *
 * The surface-scoping cases carry the maintainer ruling of 2026-08-10
 * (objectui#4000). `span` is deprecated on the JSON authoring surface and is at
 * the same time vocabulary of the `kind:'html'` tier, where our own parser
 * compiles the plain tag straight through and no other spelling exists to
 * migrate to (`div` was too, until objectui#10757 declared it deprecated on
 * both surfaces). A boolean would have made the declaration
 * false for one of its two readers; `deprecationFor` makes every caller name
 * the surface it is asking about, so no gate re-derives that exemption locally.
 *
 * ## Deliberately NOT here
 *
 * Any assertion that a REAL type is deprecated. This file registers its own
 * fixtures into a private `Registry` instance. Marking `div` (or anything else)
 * is objectui#3965's decision, and the corpus that would go red for it is
 * measured in `examples/schema-catalog/test/catalog-deprecated-types.test.ts`,
 * which is also where the corpus-wide gate lives. Nothing in this repo declares
 * a deprecation today; this is the vocabulary and the reader.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Registry } from '../Registry.js';
import type { ComponentDeprecation } from '../Registry.js';

/** An inert renderer — every case here reads metadata, none of them renders. */
const NOOP = () => null;

/**
 * A private registry per case. The exported `ComponentRegistry` is a
 * process-level singleton shared across every test file in the run, and these
 * fixtures must not reach it.
 */
const fresh = () => new Registry<unknown>();

const DIV_LIKE: ComponentDeprecation = {
  surfaces: ['json'],
  replacement: 'use "card", "flex", or semantic layout components',
};

describe('Registry.deprecationFor — the reader (objectui#6674)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers undefined for a registration that declares nothing — and the type IS registered', () => {
    const registry = fresh();
    registry.register('plain', NOOP, { namespace: 'probe' });

    // The control comes FIRST: `undefined` from an unknown type and `undefined`
    // from a type that declares no deprecation are the same value, so without
    // this the case cannot tell them apart.
    expect(registry.has('probe:plain')).toBe(true);

    expect(registry.deprecationFor('probe:plain', 'json')).toBeUndefined();
    expect(registry.deprecationFor('probe:plain', 'html')).toBeUndefined();
  });

  it('answers with the declaration on a surface the registration names', () => {
    const registry = fresh();
    registry.register('boxy', NOOP, { namespace: 'probe', deprecated: DIV_LIKE });

    expect(registry.deprecationFor('probe:boxy', 'json')).toEqual(DIV_LIKE);
  });

  it('hands back the migration guidance, not just a yes — so a gate can say what to author instead', () => {
    const registry = fresh();
    registry.register('boxy', NOOP, { namespace: 'probe', deprecated: DIV_LIKE });

    // The reader returns the DECLARATION rather than a boolean precisely for
    // this: a gate that can only say "deprecated" sends its reader back to the
    // console string this declaration replaces.
    expect(registry.deprecationFor('probe:boxy', 'json')?.replacement).toBe(
      'use "card", "flex", or semantic layout components',
    );
  });

  it('answers undefined on a surface the registration does NOT name (the objectui#4000 ruling)', () => {
    const registry = fresh();
    registry.register('boxy', NOOP, { namespace: 'probe', deprecated: DIV_LIKE });

    // This is the whole reason the declaration carries surfaces. `span` is
    // deprecated for JSON-authored pages and is vocabulary of the
    // `kind:'html'` tier, where the parser maps the plain tag straight through.
    // A gate sweeping html-tier sources must get "not deprecated" here without
    // knowing that ruling.
    expect(registry.deprecationFor('probe:boxy', 'html')).toBeUndefined();

    // Paired control: the same call on the declared surface still answers, so
    // the `undefined` above is the SCOPE and not a registration that failed.
    expect(registry.deprecationFor('probe:boxy', 'json')).toEqual(DIV_LIKE);
  });

  it('answers on both surfaces when the registration names both', () => {
    const registry = fresh();
    const everywhere: ComponentDeprecation = { surfaces: ['json', 'html'] };
    registry.register('gone', NOOP, { namespace: 'probe', deprecated: everywhere });

    expect(registry.deprecationFor('probe:gone', 'json')).toEqual(everywhere);
    expect(registry.deprecationFor('probe:gone', 'html')).toEqual(everywhere);
  });

  it('treats an empty surface list as declaring nothing, on every surface', () => {
    const registry = fresh();
    registry.register('empty', NOOP, {
      namespace: 'probe',
      deprecated: { surfaces: [] },
    });

    // A deprecation that applies to no reader is indistinguishable from no
    // deprecation, and the reader says so rather than leaking a truthy object
    // that every caller would then have to re-check.
    expect(registry.deprecationFor('probe:empty', 'json')).toBeUndefined();
    expect(registry.deprecationFor('probe:empty', 'html')).toBeUndefined();
  });

  it('answers under BOTH spellings of a namespaced registration', () => {
    const registry = fresh();
    registry.register('boxy', NOOP, { namespace: 'probe', deprecated: DIV_LIKE });

    // `register` stores a namespaced registration under the bare key too, and a
    // corpus authors whichever spelling it likes. Resolution is `getMeta`'s, so
    // a gate does not have to reproduce the fallback rule to ask the question.
    expect(registry.deprecationFor('boxy', 'json')).toEqual(DIV_LIKE);
    expect(registry.deprecationFor('probe:boxy', 'json')).toEqual(DIV_LIKE);
    // And through the explicit-namespace parameter, the third spelling.
    expect(registry.deprecationFor('boxy', 'json', 'probe')).toEqual(DIV_LIKE);
  });

  it('answers only under the namespaced key when the registration sets skipFallback', () => {
    const registry = fresh();
    registry.register('boxy', NOOP, {
      namespace: 'probe',
      skipFallback: true,
      deprecated: DIV_LIKE,
    });

    expect(registry.deprecationFor('probe:boxy', 'json')).toEqual(DIV_LIKE);
    // The bare key was never claimed, so this is "unknown type", and the
    // control below is what distinguishes that from "declares nothing".
    expect(registry.has('boxy')).toBe(false);
    expect(registry.deprecationFor('boxy', 'json')).toBeUndefined();
  });

  it('answers from a registerLazy stub, before the plugin chunk has loaded', () => {
    const registry = fresh();
    registry.registerLazy('heavy', () => Promise.resolve(), {
      namespace: 'probe',
      deprecated: DIV_LIKE,
    });

    // A gate must not have to import every plugin package to learn that one of
    // its types is deprecated — that would make the answer depend on how much
    // of the registry a given test happened to load. `getMeta` already reads a
    // pending stub's meta; this reader inherits that.
    expect(registry.deprecationFor('probe:heavy', 'json')).toEqual(DIV_LIKE);
  });

  it('answers undefined for a type nothing registered, without throwing', () => {
    const registry = fresh();

    expect(registry.deprecationFor('no-such-type', 'json')).toBeUndefined();
  });

  it('is NOT satisfied by prose — a "(Deprecated)" label and a console.warn declare nothing', () => {
    const registry = fresh();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The pre-#6674 state of `div`, reproduced exactly: the two statements that
    // existed, and no third one. The renderer warns on every render and the
    // palette label says the word — and the registry still cannot answer the
    // question, which is the finding this card filed.
    registry.register(
      'legacy-box',
      () => {
        console.warn('[ObjectUI] The "legacy-box" component is deprecated.');
        return null;
      },
      { namespace: 'probe', label: 'Legacy Box (Deprecated)' },
    );

    const meta = registry.getMeta('probe:legacy-box');
    expect(meta?.label).toContain('(Deprecated)');
    expect(registry.deprecationFor('probe:legacy-box', 'json')).toBeUndefined();

    // And the renderer really does warn, so the two prose statements are both
    // genuinely present — this is a registration in the shape the card
    // describes, not a straw man with the label alone.
    const render = registry.get('probe:legacy-box') as () => null;
    render();
    expect(
      warn.mock.calls.filter((args: unknown[]) =>
        /is deprecated/.test(String(args[0])),
      ),
    ).toHaveLength(1);
  });
});
