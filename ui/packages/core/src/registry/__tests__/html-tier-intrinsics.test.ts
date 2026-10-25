/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10735 — the html tier's intrinsic-element roster and how
 * `getPublicConfigs()` projects it (executing the ruling A on objectstack#20112).
 *
 * The roster is a SECOND list beside `PUBLIC_BLOCKS`, and the two must stay
 * disjoint: the curated read wins the dedupe inside `getPublicConfigs()`, so a
 * tag on both would come out unstamped and the marker every curated-vocabulary
 * consumer filters on would silently not apply. The membership is pinned
 * against the JSON surface's OWN declaration of the same tags —
 * `HtmlElementSchema` and `SemanticElementSchema` in `@object-ui/types` — so the
 * two declarations cannot drift apart without one of them going red here.
 */

import { describe, expect, it } from 'vitest';
import { LayoutSchema } from '@object-ui/types/zod';
import { Registry } from '../Registry.js';
import { PUBLIC_BLOCKS, PUBLIC_BLOCK_SET } from '../public-blocks.js';
import { HTML_TIER_INTRINSICS, HTML_TIER_INTRINSIC_SET } from '../html-tier-intrinsics.js';

const C = () => null;

/**
 * The tags the JSON surface declares as html elements — read off the layout
 * union's two `z.enum` arms, not restated. `HtmlElementSchema` and
 * `SemanticElementSchema` are deliberately NOT exported from the zod barrel
 * (objectui#9067), so the arms are found by shape: exactly two arms of
 * `LayoutSchema` key their `type` by an enum, the sectioning family (the one
 * holding `main`) and the flow/inline family (the one holding `p`).
 */
type EnumTypeArm = { shape?: { type?: { def?: { type?: string }; options?: readonly string[] } } };
const enumArms = (): string[][] =>
  (LayoutSchema as unknown as { options: EnumTypeArm[] }).options
    .filter((arm) => arm.shape?.type?.def?.type === 'enum')
    .map((arm) => [...(arm.shape?.type?.options ?? [])]);
const flowInlineTags = (): string[] => enumArms().find((arm) => arm.includes('p')) ?? [];
const sectioningTags = (): string[] => enumArms().find((arm) => arm.includes('main')) ?? [];

describe('HTML_TIER_INTRINSICS — the roster (objectui#10735)', () => {
  it('is duplicate-free and matches its set', () => {
    expect(new Set(HTML_TIER_INTRINSICS).size).toBe(HTML_TIER_INTRINSICS.length);
    expect(HTML_TIER_INTRINSIC_SET.size).toBe(HTML_TIER_INTRINSICS.length);
  });

  it('is disjoint from PUBLIC_BLOCKS — a tag on both would come out curated and unstamped', () => {
    expect(HTML_TIER_INTRINSICS.filter((tag) => PUBLIC_BLOCK_SET.has(tag))).toEqual([]);
    expect(PUBLIC_BLOCKS.filter((tag) => HTML_TIER_INTRINSIC_SET.has(tag))).toEqual([]);
  });

  it('carries every tag the JSON surface declares as an html or sectioning element', () => {
    // Anti-vacuity: exactly the two enum arms resolved, and to the vocabulary
    // this card is about (one spelling out of each arm).
    expect(enumArms()).toHaveLength(2);
    const flowInline = flowInlineTags();
    const sectioning = sectioningTags();
    expect(flowInline.length).toBeGreaterThan(30);
    expect(flowInline).toEqual(expect.arrayContaining(['h1', 'p', 'a', 'img', 'br']));
    expect(sectioning).toHaveLength(7);
    expect(sectioning).toContain('main');

    expect(flowInline.filter((tag) => !HTML_TIER_INTRINSIC_SET.has(tag))).toEqual([]);
    expect(sectioning.filter((tag) => !HTML_TIER_INTRINSIC_SET.has(tag))).toEqual([]);
  });

  it('adds exactly the three "registered elsewhere" tags the ruling names beyond those enums', () => {
    const declaredByEnums = new Set([...flowInlineTags(), ...sectioningTags()]);
    expect(HTML_TIER_INTRINSICS.filter((tag) => !declaredByEnums.has(tag)).sort()).toEqual(
      ['label', 'span', 'table'],
    );
  });

  it('leaves `div` out — deprecated in favour of `box`, and refused by the gate that reads the manifest', () => {
    expect(HTML_TIER_INTRINSIC_SET.has('div')).toBe(false);
    // `box` is the JSON surface's replacement and is curated, not html-tier.
    expect(PUBLIC_BLOCK_SET.has('box')).toBe(true);
    expect(HTML_TIER_INTRINSIC_SET.has('box')).toBe(false);
  });

  it('carries `code` and leaves `kbd` out — an element passthrough since objectui#10756, and an unruled component', () => {
    // `code` used to be the bare fallback of the `field:code` widget (no inputs,
    // no child slot) and was ledgered out; `html-elements.tsx` now registers it
    // from `TAGS` and the widget stands down from the bare key. `kbd` is a `ui`
    // component reading `keys` / `label`, still recorded in the console test's
    // exclusion ledger with its reason.
    expect(HTML_TIER_INTRINSIC_SET.has('code')).toBe(true);
    expect(HTML_TIER_INTRINSIC_SET.has('kbd')).toBe(false);
  });
});

describe('getPublicConfigs — the html tier rides the contract read, stamped (objectui#10735)', () => {
  it('returns a registered roster tag stamped `tier: html`, keyed by the bare tag', () => {
    const r = new Registry();
    r.register('flex', C, { namespace: 'ui' }); // curated
    r.register('p', C, { namespace: 'ui', inputs: [{ name: 'className', type: 'string' }, { name: 'children', type: 'slot' }] });
    r.register('studio-admin', C, { namespace: 'app-shell' }); // capability only

    const configs = r.getPublicConfigs();
    const byType = new Map(configs.map((c) => [c.type, c]));

    expect([...byType.keys()].sort()).toEqual(['flex', 'p']);
    expect(byType.get('flex')!.tier).toBeUndefined();
    expect(byType.get('p')!.tier).toBe('html');
    // The registration's own metadata travels: the manifest carries the tag
    // "exactly as the registry declares it".
    expect(byType.get('p')!.inputs?.map((i) => i.name)).toEqual(['className', 'children']);
    expect(byType.get('p')!.namespace).toBe('ui');
    // Bare tag, not the namespaced canonical.
    expect(configs.some((c) => c.type.includes(':'))).toBe(false);
  });

  it('is a PROJECTION — the stamp never reaches the registration', () => {
    const r = new Registry();
    r.register('h1', C, { namespace: 'ui' });
    expect(r.getPublicConfigs().find((c) => c.type === 'h1')!.tier).toBe('html');
    expect(r.getMeta('h1')?.tier).toBeUndefined();
    expect(r.getConfig('h1')?.tier).toBeUndefined();
  });

  it('skips a roster tag that is not registered (aspirational-safe, like PUBLIC_BLOCKS)', () => {
    const r = new Registry();
    r.register('card', C, { namespace: 'ui' });
    expect(r.getPublicConfigs().map((c) => c.type)).toEqual(['card']);
  });

  it('does not admit `div` even when it is registered and deprecated on the json surface only', () => {
    const r = new Registry();
    r.register('div', C, {
      namespace: 'ui',
      deprecated: { surfaces: ['json'], replacement: 'author "box" for a plain wrapper' },
    });
    r.register('span', C, { namespace: 'ui', deprecated: { surfaces: ['json'] } });
    const types = r.getPublicConfigs().map((c) => c.type);
    // `span` is on the roster (deprecated on json, permanent on html); `div` is not.
    expect(types).toEqual(['span']);
  });

  it('does not admit a field widget squatting on an html tag name that is not on the roster', () => {
    // `summary` is the console's live instance: the `field:summary` widget's
    // bare fallback shares its name with the HTML element and is ledgered out.
    const r = new Registry();
    r.register('summary', C, { namespace: 'field' });
    expect(r.getPublicConfigs()).toEqual([]);
  });

  it('projects a roster tag from whatever holds its bare key — why `field:code` stands down (objectui#10756)', () => {
    // The roster names the TAG; the projection copies the registration the bare
    // key resolves to. Were the field widget still the bare `code` owner, the
    // manifest would declare a code editor under the tag — the defect this card
    // closes — so `@object-ui/fields` registers `code` with `skipFallback` and
    // `html-elements.tsx`'s `ui:code` is the one bare claimant. Both halves,
    // in one registry:
    const r = new Registry();
    r.register('code', C, { namespace: 'field', skipFallback: true });
    expect(r.getPublicConfigs()).toEqual([]); // the widget declined the bare key: nothing to project
    const Passthrough = () => null;
    r.register('code', Passthrough, {
      namespace: 'ui',
      inputs: [{ name: 'className', type: 'string' }, { name: 'children', type: 'slot' }],
    });
    const cfg = r.getPublicConfigs().find((c) => c.type === 'code');
    expect(cfg?.tier).toBe('html');
    expect(cfg?.namespace).toBe('ui');
    expect(cfg?.component).toBe(Passthrough);
    expect(r.getConfig('field:code')?.component).toBe(C); // the widget is still its own key
  });

  it('resolves a lazily registered roster tag as a stamped stub', () => {
    const r = new Registry();
    r.registerLazy('p', () => Promise.resolve(), { namespace: 'ui' });
    const cfg = r.getPublicConfigs().find((c) => c.type === 'p');
    expect(cfg?.lazy).toBe(true);
    expect(cfg?.tier).toBe('html');
    expect(cfg?.component).toBeUndefined();
  });

  it('lists the curated tier first and the html tier after it — the stable, reviewable order', () => {
    const r = new Registry();
    r.register('p', C, { namespace: 'ui' });
    r.register('flex', C, { namespace: 'ui' });
    r.register('my-widget', C, { namespace: 'x', tier: 'public' });
    const types = r.getPublicConfigs().map((c) => c.type);
    expect(types).toEqual(['flex', 'my-widget', 'p']);
  });
});
