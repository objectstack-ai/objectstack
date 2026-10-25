/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5935 — the ONE icon-name seam.
 *
 * Seven modules used to resolve authored icon names, with THREE tokenisers
 * (`split('-')` on five, `split(/[-_\s]/)` on one, `split(/[-_\s]+/)` on one)
 * and the `Home -> House` rename on only four, so the same authored name
 * rendered on one surface and not another. This file pins what the surviving
 * one does.
 *
 * ## What is being proved, and what could not be proved by rendering
 *
 * The per-surface suites prove that each call site still draws ITS OWN fallback
 * (`null`, the objectui#5631 placeholder, `Inbox`, a name chip). They cannot
 * prove the seam's own algebra, because a surface only ever shows "resolved" or
 * "did not" — so the tokeniser rows below are here, where the answer is the
 * component itself.
 *
 * ## The adopted rule is MEASURED, not chosen
 *
 * `split(/[-_\s]+/)` with `Home -> House` universal, from the pre-dispatch
 * enumeration the 2026-08-31 ruling required (comment 5522254814). Its
 * regression set is EMPTY three ways over: against the authored population,
 * against the every-name-x-every-surface cross-product, and against a
 * bound-free differential over 8,298 spellings derived from all 1,767 live
 * record keys. `split('-')` regresses 4,748 pairs in that last reading, which
 * is why it is not adoptable and why the rows below assert the WIDER rule
 * rather than the more common one.
 *
 * ## ⭐ Why these rows compare glyph IDENTITY and not object identity
 *
 * objectui#9251 took the seam off lucide's runtime `icons` record — indexing it
 * dragged all 1,781 icon modules into the console's eager closure — so the
 * value `resolveIcon` returns is no longer the record's own component object,
 * and `toBe(icons.ArrowRight)` stopped expressing "resolved to ArrowRight".
 *
 * ⛔ The record is NOT dropped as the oracle here; only the comparison changed.
 * Every row below still asks the record what the right answer is, and compares
 * by `displayName`, which lucide's own `createLucideIcon` sets to the PascalCase
 * record key and which the seam sets to the same value. That substitution is
 * only sound if no two record glyphs share a `displayName`, so that is measured
 * in the first row rather than assumed — and the whole file still runs against
 * the installed `icons`, so a lucide retirement moves these rows exactly as it
 * did before.
 */

import { describe, it, expect } from 'vitest';
import { icons } from 'lucide-react';
import { resolveIcon, describeIconLookup } from '../resolve-icon';

/**
 * Which record glyph a component IS, by the name lucide gives it.
 *
 * `null` stays `null` so an unresolvable name is still distinguishable from a
 * resolved one; a component without a `displayName` answers a sentinel rather
 * than `null`, so a seam that started returning anonymous components could not
 * pass for one that resolved nothing.
 */
const glyphOf = (component: unknown): string | null => {
  if (component === null || component === undefined) return null;
  return (component as { displayName?: string }).displayName ?? '<anonymous component>';
};

describe('the icon-name seam resolves (objectui#5935)', () => {
  /**
   * ⭐ The precondition for every `glyphOf` comparison below: within the record,
   * a `displayName` names exactly one glyph, so comparing by it is as strong as
   * the `toBe(icons.X)` identity check it replaced (objectui#9251).
   */
  it('IDENTIFIES uniquely — the record\'s 1,781 glyphs have 1,781 distinct display names', () => {
    const keys = Object.keys(icons);
    expect(keys.length).toBeGreaterThan(1000);
    const names = new Set(keys.map((key) => glyphOf((icons as Record<string, unknown>)[key])));
    expect(names.size).toBe(keys.length);
    // Non-vacuity: the set is built from real names, not from the sentinel.
    expect(names.has('<anonymous component>')).toBe(false);
    expect(names.has('House')).toBe(true);
  });

  /**
   * ⭐ Non-vacuity for every "resolves" row below. A `resolveIcon` that returned
   * some component for EVERY input would pass them all; a `resolveIcon` that
   * returned `null` for every input would pass every fallback row in every
   * per-surface suite. Both directions are excluded here, in the same run.
   */
  it('DISCRIMINATES — a live name resolves and a dead one does not', () => {
    expect(resolveIcon('file-text')).not.toBeNull();
    expect(resolveIcon('not-a-real-icon')).toBeNull();
  });

  it('accepts all four authored spellings of one glyph', () => {
    const canonical = glyphOf(icons.ArrowRight);
    expect(canonical).toBe('ArrowRight');
    // kebab — what the docs and most fixtures author.
    expect(glyphOf(resolveIcon('arrow-right'))).toBe(canonical);
    // snake — resolved on TWO of the seven surfaces before this card and on
    // five of them not at all. This row is the consolidation.
    expect(glyphOf(resolveIcon('arrow_right'))).toBe(canonical);
    // space-separated — same story.
    expect(glyphOf(resolveIcon('arrow right'))).toBe(canonical);
    // already-Pascal — authored in real fixtures, must not be mangled.
    expect(glyphOf(resolveIcon('ArrowRight'))).toBe(canonical);
  });

  it('collapses repeated and mixed separators', () => {
    // `+` in the tokeniser. The equivalent spelling without it produced empty
    // tokens, which capitalise to nothing and join to nothing — measured
    // identical over 51,449 hostile spellings, and pinned here so the two
    // spellings are not "fixed" apart later.
    expect(glyphOf(resolveIcon('arrow--right'))).toBe(glyphOf(icons.ArrowRight));
    expect(glyphOf(resolveIcon('arrow-_ right'))).toBe(glyphOf(icons.ArrowRight));
  });

  it('applies the `Home` -> `House` rename, which is the ONLY rename', () => {
    // lucide dropped `Home` from its runtime record and kept `House`. The map
    // exists so a name that used to resolve still does — it is not a general
    // alias table, and nothing else belongs in it.
    expect(icons).not.toHaveProperty('Home');
    expect(glyphOf(resolveIcon('home'))).toBe(glyphOf(icons.House));
    expect(glyphOf(resolveIcon('Home'))).toBe(glyphOf(icons.House));
    expect(describeIconLookup('home')).toEqual({ pascal: 'Home', key: 'House' });
    // The control: an UNMAPPED name passes through both halves unchanged, so
    // the row above is about the map and not about `describeIconLookup` always
    // answering `House`.
    expect(describeIconLookup('file-text')).toEqual({ pascal: 'FileText', key: 'FileText' });
  });

  it('returns null — never a fallback glyph — for absent and unresolvable names', () => {
    // ⭐ The contract the 2026-09-03 maintainer ruling (option C) fixed: the
    // seam does `name -> component`, and NOTHING about what a surface draws
    // when there is no component. Each call site keeps its own fallback, so
    // this function must never acquire one, and must never acquire a parameter
    // for choosing one either.
    expect(resolveIcon(undefined)).toBeNull();
    expect(resolveIcon('')).toBeNull();
    expect(resolveIcon('definitely-not-a-lucide-icon')).toBeNull();
    // A RETIRED spelling: `Edit` still imports and still renders, but its key
    // is gone from the runtime record. Rules out a resolver that reached for
    // the named exports instead — a third, more forgiving vocabulary.
    expect(resolveIcon('edit')).toBeNull();
    expect(glyphOf(resolveIcon('square-pen'))).toBe(glyphOf(icons.SquarePen));
  });

  it('takes the seam FUNCTION, not a re-derived string, as the answer', () => {
    // `describeIconLookup` exists only so `renderers/basic/icon.tsx` can name
    // both halves in its objectui#5631 warning without a second copy of the
    // tokeniser. Pinned as CONSISTENT with `resolveIcon` so the diagnostic can
    // never describe a lookup that did not happen.
    for (const authored of ['home', 'file-text', 'arrow_right', 'not-a-real-icon']) {
      const { key } = describeIconLookup(authored);
      const expected = Object.prototype.hasOwnProperty.call(icons, key)
        ? glyphOf((icons as Record<string, unknown>)[key])
        : null;
      expect(glyphOf(resolveIcon(authored))).toBe(expected);
    }
  });

  it('is what the widening promised: the OLD resolving sets are strict subsets', () => {
    // Why no name could regress, made concrete. The old narrow tokeniser is
    // re-implemented HERE, in the test, so the claim is checked rather than
    // asserted — every name it resolved must still resolve, and the two names
    // the enumeration named as newly-resolving must now do so.
    const narrow = (name: string) => {
      const pascal = name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
      const mapped = pascal === 'Home' ? 'House' : pascal;
      return Object.prototype.hasOwnProperty.call(icons, mapped)
        ? glyphOf((icons as Record<string, unknown>)[mapped])
        : null;
    };
    let carried = 0;
    for (const key of Object.keys(icons)) {
      // The kebab spelling of every live glyph — what the narrow tokeniser
      // could resolve at all.
      const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      const before = narrow(kebab);
      if (before === null) continue;
      carried += 1;
      expect(glyphOf(resolveIcon(kebab)), `${kebab} stopped resolving`).toBe(before);
    }
    // Non-vacuity: a loop that skipped everything would pass silently.
    expect(carried).toBeGreaterThan(1000);
    // And the widening the enumeration measured, in both of its named cases.
    expect(narrow('building_2')).toBeNull();
    expect(glyphOf(resolveIcon('building_2'))).toBe(glyphOf(icons.Building2));
    expect(narrow('layout_dashboard')).toBeNull();
    expect(glyphOf(resolveIcon('layout_dashboard'))).toBe(glyphOf(icons.LayoutDashboard));
  });
});
