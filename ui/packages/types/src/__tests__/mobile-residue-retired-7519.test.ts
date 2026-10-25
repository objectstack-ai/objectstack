/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `MobileResponsiveConfig` and `GestureConfig` (objectui#7519).
 *
 * Both were declared in `../mobile.ts` and published twice — re-exported by this
 * package's root barrel AND by `@object-ui/mobile`'s — and each had exactly one
 * consumer: the `responsive` / `gestures` member of `MobileComponentConfig`.
 * objectui#5942 (PR #7526) retired that container, which left each of them as a
 * declaration plus two barrel re-exports and nothing else. objectui#7519 removes
 * the declarations and both re-exports — the route the container took.
 *
 * ## Why this pin is type-level ONLY, and why that is not a shortcut
 *
 * The sibling retirement pins in this directory have a second half: the Zod
 * mirror refuses the retired key by name (`retirementTombstone()`), because under
 * a non-strict `z.object` a deleted key is silently STRIPPED and only a tombstone
 * turns that into a named refusal. ⛔ That half does not exist here and writing it
 * would be a fabrication: `../mobile.ts` has never had a `zod/` twin — no mirror
 * ever parsed either shape — so there is no parse verdict for this deletion to
 * change. The only channel a consumer of either name ever had was the compiler,
 * and that is the channel pinned: TS2305 / TS2724 at the import (TS2694 through
 * the `import('…')` spelling below). Same shape as objectui#7654.
 *
 * ## How the `@ts-expect-error` lines stay honest
 *
 * Each directive sits on a line whose ONLY possible diagnostic is the missing
 * export: the probe value is used, so no unused-local error can consume the
 * directive by accident, and the literal would type-check cleanly if the
 * declaration came back. Each retired-name probe is paired with a LIVE name
 * reached through the identical `import('…')` spelling and no directive, so a
 * broken specifier — which would satisfy the directive for the wrong reason
 * (TS2307) — turns the control red instead. Real enforcement because
 * `tsconfig.test.json` compiles this file under this package's `type-check`
 * script (objectui#3009). Reverse-verified at the PR: with the declarations and
 * barrel lines restored, `tsc -p tsconfig.test.json` reports TS2578 on exactly
 * the four directive lines.
 *
 * The second `describe` reads the two barrels and the declaring file off disk —
 * a source read, not an import, because `@object-ui/types` has zero deps and
 * must not take one on `@object-ui/mobile` (the same instrument the
 * `OfflineConfig` pin in `page-nav-misc-spec-parity.test.ts` uses). That leg is
 * what keeps the `@object-ui/mobile` barrel honest, which the compiler leg
 * cannot reach from this package.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');

describe('objectui#7519 — the retired names are gone from the compile-time surface', () => {
  it('`GestureConfig` no longer resolves from the root barrel or from `./mobile`', () => {
    // @ts-expect-error RETIRED (objectui#7519): `@object-ui/types` no longer exports `GestureConfig`
    const viaBarrel: import('../index.js').GestureConfig = { type: 'tap', action: 'noop' };
    // @ts-expect-error RETIRED (objectui#7519): `./mobile` no longer declares `GestureConfig`
    const viaModule: import('../mobile.js').GestureConfig = { type: 'tap', action: 'noop' };
    expect(viaBarrel).toEqual(viaModule);
  });

  it('`MobileResponsiveConfig` no longer resolves from the root barrel or from `./mobile`', () => {
    // @ts-expect-error RETIRED (objectui#7519): `@object-ui/types` no longer exports `MobileResponsiveConfig`
    const viaBarrel: import('../index.js').MobileResponsiveConfig = { columns: 2 };
    // @ts-expect-error RETIRED (objectui#7519): `./mobile` no longer declares `MobileResponsiveConfig`
    const viaModule: import('../mobile.js').MobileResponsiveConfig = { columns: 2 };
    expect(viaBarrel).toEqual(viaModule);
  });

  it('the neighbours the two stood beside still resolve through the same spelling (control)', () => {
    // No directive on purpose: if `../index.js` or `../mobile.js` stopped
    // resolving, the directives above would be satisfied by TS2307 for the wrong
    // reason — these lines go red first.
    const ctx: import('../index.js').GestureContext = {
      type: 'tap',
      startPosition: { x: 0, y: 0 },
      endPosition: { x: 0, y: 0 },
      distance: 0,
      duration: 0,
      velocity: 0,
    };
    const value: import('../mobile.js').ResponsiveValue<number> = { md: 2 };
    const kind: import('../index.js').GestureType = 'tap';
    expect(ctx.type).toBe(kind);
    expect(value).toEqual({ md: 2 });
  });
});

describe('objectui#7519 — the retired names are gone from both barrels and the declaring file', () => {
  const typesBarrel = read('../index.ts');
  const mobileBarrel = read('../../../mobile/src/index.ts');
  const declaring = read('../mobile.ts');

  // A re-export block entry: the bare name alone on its line, followed by a comma.
  // `SpecGestureConfig,` cannot match `reexport('GestureConfig')` — the name must
  // start right after the indent.
  const reexport = (name: string): RegExp => new RegExp(`^\\s*${name},\\s*$`, 'm');
  const declaration = (name: string): RegExp => new RegExp(`^export (interface|type) ${name}\\b`, 'm');

  it('`@object-ui/types` root barrel no longer re-exports either name (controls stay in)', () => {
    expect(typesBarrel).not.toMatch(reexport('GestureConfig'));
    expect(typesBarrel).not.toMatch(reexport('MobileResponsiveConfig'));
    expect(typesBarrel).toMatch(reexport('GestureContext'));
    expect(typesBarrel).toMatch(reexport('ResponsiveValue'));
  });

  it('`@object-ui/mobile` root barrel no longer re-exports either name (controls stay in)', () => {
    expect(mobileBarrel).not.toMatch(reexport('GestureConfig'));
    expect(mobileBarrel).not.toMatch(reexport('MobileResponsiveConfig'));
    expect(mobileBarrel).toMatch(reexport('GestureContext'));
    expect(mobileBarrel).toMatch(reexport('ResponsiveValue'));
  });

  it('`mobile.ts` no longer declares either name, and records why in a `//` note', () => {
    expect(declaring).not.toMatch(declaration('GestureConfig'));
    expect(declaring).not.toMatch(declaration('MobileResponsiveConfig'));
    expect(declaring).toMatch(declaration('GestureContext'));
    expect(declaring).toMatch(declaration('GestureType'));
    // The retirement notes are `//` comments so declaration emit strips them —
    // the objectui#5942 contract-review lesson: a JSDoc pointer into a `//` note
    // survives into the published .d.ts while its target does not. They must
    // still exist in SOURCE, one per retired name.
    expect(declaring).toMatch(/^\/\/ RETIRED \(objectui#7519.*`MobileResponsiveConfig`/m);
    expect(declaring).toMatch(/^\/\/ RETIRED \(objectui#7519.*`GestureConfig`/m);
  });
});
