/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ActionGroup` stays RETIRED from `@object-ui/types` (objectui#11168 slice 2).
 *
 * The interface was re-exported from the package entry (`dist/index.d.ts`) and
 * nothing imported it. It was not the mirror of the `action:group` block: that
 * is `ActionGroupBlockSchema` (`../zod/public-blocks.zod.ts`), the spec row by
 * reference. It required a `name` the row refuses (slice 1 retired it from the
 * block's published inputs), required `label` and `actions` the row makes
 * optional, typed `visible` as a string only, and lacked `location`, `variant`
 * and `size`. The tombstone where it stood in `../ui-action.ts` records this.
 *
 * ⚠️ The zero-importer reading is the IN-REPO half: `@object-ui/types` is
 * published, and an external TypeScript consumer is not observable from here.
 * Such a consumer gets a compile error naming the symbol, and the changeset
 * names the replacement.
 *
 * Two instruments:
 *   - `tsc` reads the `@ts-expect-error` legs (this package type-checks its
 *     tests through `tsconfig.test.json`). They are the half that tells the
 *     retirement from its absence, because a type exists only for `tsc`.
 *   - vitest reads the two source files as TEXT, so a re-introduced
 *     declaration reddens even in a run that never type-checks.
 * Every leg has a lit control on the same instrument, so a module that stopped
 * resolving anything cannot pass for a retirement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Rooted at THIS file, never at `process.cwd()`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = resolve(HERE, '..', 'ui-action.ts');
const BARREL_PATH = resolve(HERE, '..', 'index.ts');

/* ── The type face: gone from the declaring module AND from the published entry ── */

// @ts-expect-error objectui#11168 slice 2 — `ActionGroup` is RETIRED from `../ui-action`. Type an `action:group` node with `ActionGroupBlockSchema`.
type _RetiredFromTheDeclaringModule = import('../ui-action').ActionGroup;

// @ts-expect-error objectui#11168 slice 2 — and RETIRED from the package entry, the face an external consumer imports.
type _RetiredFromThePublishedEntry = import('../index').ActionGroup;

/**
 * ⭐ LIT CONTROLS for the two directives above, through the exact same import
 * forms and with no directive: a sibling from the same `export type` block of
 * the entry still resolves, from the module and from the entry.
 */
type _SiblingStillResolvesFromTheModule = import('../ui-action').ActionContext;
type _SiblingStillResolvesFromTheEntry = import('../index').ActionResult;

/** Consumed so the two controls are not unused type aliases. */
type _ControlsAreReferenced = [
  _SiblingStillResolvesFromTheModule['record'],
  _SiblingStillResolvesFromTheEntry['success'],
];

describe('objectui#11168 slice 2 — `ActionGroup` stays retired from `@object-ui/types`', () => {
  it('the declaring module no longer declares the interface', () => {
    const source = readFileSync(DECLARATION_PATH, 'utf8');
    expect(/^export interface ActionGroup\b/m.test(source)).toBe(false);
    // LIT CONTROL: the same matcher shape finds a sibling the module keeps.
    expect(/^export interface ActionContext\b/m.test(source)).toBe(true);
    // The tombstone stays: it names the replacement and why this was not it.
    expect(source).toContain('`ActionGroup` — RETIRED (objectui#11168 slice 2)');
  });

  it('the package entry no longer re-exports it', () => {
    const barrel = readFileSync(BARREL_PATH, 'utf8');
    expect(/^\s*ActionGroup,\s*$/m.test(barrel)).toBe(false);
    // LIT CONTROL: the identical matcher finds a sibling in the same block.
    expect(/^\s*ActionContext,\s*$/m.test(barrel)).toBe(true);
  });
});
