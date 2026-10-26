/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9414 — the icon seam's tokeniser had no letter-to-digit boundary.
 *
 * ## What was wrong
 *
 * `toKebabIconName` split two boundaries — `lower-or-digit -> Upper` and
 * `acronym-run -> Word` — and never `letter -> digit`. So `Building2`, the
 * spelling `lucide-react` exports and the spelling lucide's own site shows an
 * author, tokenised to `building2`; lucide's canonical key is `building-2`;
 * the name matched nothing and `getLazyIcon` degraded it to the `Database`
 * glyph. ⛔ No error, no warning, no log — the author saw *an* icon with no
 * signal that it was not theirs.
 *
 * ## Why no gate saw it, and why this file is a CAPABILITY pin
 *
 * `scripts/check-lucide-icon-record-names.mjs` censuses the names that ARE
 * AUTHORED in this tree and judges them against lucide's runtime `icons`
 * record. It was green on the defect and green correctly: nothing here authored
 * a digit-suffixed name, and `lazy-icon.tsx` is a DECLARED_DYNAMIC_READER,
 * which that gate reports and does not judge. What IS authored and what the
 * tokeniser CAN accept are different populations, and only the second one is
 * the seam's contract. ⇒ this file pins the second.
 *
 * ## The populations are re-derived, never written down (AGENTS.md #5 / #9)
 *
 * Every assertion below is computed from the installed `lucide-react` on every
 * run. A count copied in here would state a fact derived once and never again,
 * and would go on reading as live after lucide moved under it — which is the
 * exact failure this seam already had.
 */
import { describe, expect, it } from 'vitest';
import * as lucide from 'lucide-react';
import { iconNames } from 'lucide-react/dynamic.mjs';

// Through the package's PUBLIC entry, which is the surface every consumer gets
// — never `../lib/lazy-icon`, which would pass on a seam that had stopped
// re-exporting these names.
import { getLazyIcon, isLucideIconName, toKebabIconName } from '../index';

/** The canonical vocabulary the seam accepts — lucide's own dynamic surface. */
const CANONICAL: readonly string[] = iconNames as unknown as string[];
const CANONICAL_SET = new Set(CANONICAL);

/** Every spelling `lucide-react` exports, minus the runtime `icons` record. */
const EXPORT_KEYS = Object.keys(lucide).filter((key) => key !== 'icons');
const EXPORT_KEY_SET = new Set(EXPORT_KEYS);

/**
 * lucide's OWN `toPascalCase`, which is what turns a canonical icon name into
 * the component name it exports: drop each hyphen, upper-case the character
 * that followed it. Re-spelled here rather than imported because it lives in
 * `@lucide/shared` and is not on `lucide-react`'s public surface; the guard in
 * the first case below is what keeps this honest — it fails if this spelling
 * ever stops agreeing with the export keys lucide actually ships.
 */
const toLucidePascalCase = (canonical: string): string =>
  canonical.replace(/(^|-)(\w)/g, (_match, _sep, char: string) => char.toUpperCase());

/**
 * The PRE-#9414 tokeniser, frozen.
 *
 * ⛔ This is not a second copy of the implementation and must never be re-synced
 * with it. It is the HISTORICAL baseline the no-loss leg is measured against:
 * the change had to be a strict superset, so every name this resolved must
 * still resolve to the byte-identical result. Re-syncing it would turn that
 * measurement into a tautology.
 */
const PRE_9414 = (name: string): string =>
  name.includes('-')
    ? name.toLowerCase()
    : name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .toLowerCase();

describe('objectui#9414 — the seam accepts lucide’s canonical names in the spelling lucide exports', () => {
  it('has both populations to judge, so the legs below are readings rather than vacuous', () => {
    // A silently emptied population would satisfy every `toEqual([])` below.
    expect(CANONICAL.length).toBeGreaterThan(0);
    expect(EXPORT_KEYS.length).toBeGreaterThan(CANONICAL.length);
  });

  it('reaches EVERY canonical icon name from its own exported PascalCase spelling', () => {
    // THE CAPABILITY. Derived over lucide's whole canonical vocabulary, so it
    // moves with lucide instead of pinning a snapshot of it.
    const pairs = CANONICAL.map((canonical) => [canonical, toLucidePascalCase(canonical)] as const);

    // Guard on the derivation itself: these PascalCase spellings must be the
    // ones lucide really exports, or the leg below judges names nobody can
    // author. This is what makes re-spelling `toPascalCase` above safe.
    expect(pairs.filter(([, pascal]) => !EXPORT_KEY_SET.has(pascal)).map(([c]) => c)).toEqual([]);

    expect(pairs.filter(([, pascal]) => !isLucideIconName(pascal)).map(([c]) => c)).toEqual([]);
  });

  it('changes NOTHING the pre-#9414 tokeniser already resolved — byte-identical', () => {
    // The must-stay-unchanged leg. A count that only goes up is not a reading:
    // the change is a strict superset or it is a regression.
    const alreadyResolved = EXPORT_KEYS.filter((key) => CANONICAL_SET.has(PRE_9414(key)));
    expect(alreadyResolved.length).toBeGreaterThan(0);

    const moved = alreadyResolved.filter((key) => toKebabIconName(key) !== PRE_9414(key));
    expect(moved).toEqual([]);
  });

  it('leaves every canonical kebab spelling untouched', () => {
    // The other half of the no-loss leg: authors write kebab too, and the
    // early return for a hyphenated name must keep meaning what it meant.
    expect(CANONICAL.filter((name) => toKebabIconName(name) !== name)).toEqual([]);
  });

  // The shapes the card named, pinned one per case so a red says WHICH shape
  // died. The canonical spelling is asserted to be a live member in the same
  // case, so a lucide retirement reds here loudly instead of leaving the
  // mapping assertion restating a dead name.
  it.each([
    ['Building2', 'building-2'],
    ['BarChart3', 'bar-chart-3'],
    ['CheckCircle2', 'check-circle-2'],
    ['CircleSlash2', 'circle-slash-2'],
    ['ArrowDown01', 'arrow-down-01'],
    ['Clock1', 'clock-1'],
    ['Axis3D', 'axis-3-d'],
    ['Axis3d', 'axis-3d'],
  ])('digit-suffixed `%s` tokenises to the canonical `%s`', (pascal, canonical) => {
    expect({ kebab: toKebabIconName(pascal), live: CANONICAL_SET.has(canonical) }).toEqual({
      kebab: canonical,
      live: true,
    });
    expect(isLucideIconName(pascal)).toBe(true);
  });

  // The `Grid2x2` family — IN, deliberately (objectui#9414 fenced this as the
  // taker's call). They are reached by the SAME single rule, not a second one:
  // the negative lookbehind holds the split off inside a `2x2` run, so the
  // result is lucide's PRIMARY spelling `grid-2x2` rather than its `grid-2-x-2`
  // alias. `Grid3x2` is the shape that proves the difference matters — lucide
  // ships no `grid-3-x-2` alias at all, so a rule that routed through the alias
  // spellings would recover five of these six and leave this one behind.
  it.each([
    ['Grid2x2', 'grid-2x2'],
    ['Grid2x2Check', 'grid-2x2-check'],
    ['Grid2x2Plus', 'grid-2x2-plus'],
    ['Grid2x2X', 'grid-2x2-x'],
    ['Grid3x2', 'grid-3x2'],
    ['Grid3x3', 'grid-3x3'],
  ])('digit-letter-digit `%s` tokenises to the canonical `%s`', (pascal, canonical) => {
    expect({ kebab: toKebabIconName(pascal), live: CANONICAL_SET.has(canonical) }).toEqual({
      kebab: canonical,
      live: true,
    });
    expect(isLucideIconName(pascal)).toBe(true);
  });

  it('still rejects what is not an icon, so the legs above are not a yes-machine', () => {
    // CONTROLS, known direction, HIT in this same run.
    // `useLucideContext` is a hook and `default` is the module's default
    // export; both are namespace keys and neither is an icon. They are the
    // residue objectui#9414 deliberately leaves rejected.
    expect(isLucideIconName('useLucideContext')).toBe(false);
    expect(isLucideIconName('default')).toBe(false);
    expect(isLucideIconName('NotAnIconAnywhere')).toBe(false);
    expect(isLucideIconName('Building9999')).toBe(false);
    expect(isLucideIconName('')).toBe(false);
    expect(isLucideIconName(undefined)).toBe(false);
  });

  it('stops degrading a digit-suffixed name to the `Database` fallback', () => {
    // The user-visible half, stated on the resolver rather than the tokeniser:
    // the wrong-glyph outcome is what an author actually met.
    const { Database } = lucide as unknown as Record<string, unknown>;
    expect(getLazyIcon('Building2')).not.toBe(Database);
    // CONTROL: a name lucide really does not have still degrades, which is the
    // documented behaviour for server-driven schemas naming other libraries.
    expect(getLazyIcon('NotAnIconAnywhere')).toBe(Database);
  });
});
