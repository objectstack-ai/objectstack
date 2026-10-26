/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5216 — the private `?runAction=` string convention is RETIRED, and
 * cannot come back by accident.
 *
 * ## What the convention was
 *
 * `?runAction=<name>` was a deep link with **two hand-written definitions and
 * no declaration**: `CloudOnboardingNext` built the query by string
 * concatenation (`` `${envsRoute}?runAction=create_environment` ``), and
 * `EnvironmentListToolbar` matched it by reading a bare `'runAction'` literal
 * off `window.location.search` and comparing it to a hard-coded action name.
 *
 * Nothing declared it. `objectui validate` could not see it (the nav schema
 * strips unknown keys). `RESERVED_URL_PARAMS` did not list it, so a page could
 * have repurposed the name with no collision check to catch it. And because the
 * consumer compared against ONE hard-coded action, the "convention" was really
 * a single-value private protocol between two files — a second de-facto
 * contract of exactly the shape AGENTS.md #0.1 exists to prevent.
 *
 * `@objectstack/spec` now publishes the real one: `ObjectNavItemSchema.runAction`
 * (objectstack#7253). So the convention is not a contract that needs migrating;
 * it is pure debt, and this file is what keeps it deleted.
 *
 * ## ⚠ WHAT THIS FILE CANNOT ASSERT — read before adding a case here
 *
 * This is a SOURCE SCAN, not a behavioural test. It proves the literal is gone
 * from the source, not that the runtime honours the declared slot — that is
 * `resolveHref.runAction.test.ts` (producer) and `useNavRunAction.test.tsx`
 * (consumer), and neither is replaceable by this one. A scan also cannot see a
 * literal assembled at runtime (`'run' + 'Action'`); it catches the failure
 * mode that actually recurs — someone re-typing the string because importing
 * the constant was one keystroke more.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_RUN_ACTION_PARAM } from '@object-ui/layout';
import { RESERVED_URL_PARAMS } from '../urlParams';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

/**
 * Drop block and line comments before scanning. Doc comments legitimately NAME
 * the retired param while explaining the mechanism that replaced it — without
 * this, the rule would forbid documenting its own subject, and the pressure
 * would be to delete the explanation rather than the debt.
 */
const stripComments = (src: string): string =>
  mask(src);

/**
 * Every file that used to hand-write the param name, plus the two that consume
 * it today. If a future file needs the name, it imports the constant — so this
 * list is allowed to grow only with files that DON'T contain the literal.
 * `CloudOnboardingNext.tsx`, the producer half of the retired convention, left
 * the list when the widget itself retired (objectui#12954).
 */
const SOURCES_THAT_MUST_NOT_SPELL_IT = [
  'packages/app-shell/src/environment/EnvironmentListToolbar.tsx',
  'packages/app-shell/src/views/ObjectView.tsx',
  'packages/app-shell/src/hooks/useNavRunAction.ts',
];

describe('the private `?runAction=` convention is gone from the source (#5216)', () => {
  it.each(SOURCES_THAT_MUST_NOT_SPELL_IT)('%s spells the param name nowhere', (rel) => {
    const src = read(rel);

    // The quoted literal in code — see `stripComments` on why documentation
    // that names the retired string is not itself the debt.
    const code = stripComments(src);

    expect(code).not.toMatch(/['"`]runAction['"`]/);
    // The hand-concatenated query, in any quoting.
    expect(code).not.toMatch(/\?runAction=/);
  });

  it('the toolbar no longer reads the raw search string for it', () => {
    const src = read('packages/app-shell/src/environment/EnvironmentListToolbar.tsx');

    // Before #5216: `new URLSearchParams(window.location.search).get('runAction')`.
    // Read-once/consume-once now lives in one shared hook; a second copy here
    // would be a second set of #4123 semantics waiting to drift.
    expect(src).not.toContain('URLSearchParams');
    expect(src).toContain('useNavRunAction');
  });
});

describe('the param name now has exactly one definition (#5216)', () => {
  it('is owned by @object-ui/layout, next to its only writer', () => {
    expect(NAV_RUN_ACTION_PARAM).toBe('runAction');
  });

  it('is registered in the console reserved-param collision check', () => {
    // The half the private convention never had: a page that tried to claim
    // `runAction` for its own purposes now collides visibly.
    expect(RESERVED_URL_PARAMS).toContain(NAV_RUN_ACTION_PARAM);
  });

  it('urlParams re-exports the constant rather than restating the string', () => {
    const src = read('packages/app-shell/src/urlParams.ts');

    // Every other reserved param is `export const X = '<literal>'` here; this
    // one must NOT be, or there would be two spellings to drift apart.
    expect(src).not.toMatch(/NAV_RUN_ACTION_PARAM\s*=\s*['"]/);
    expect(src).toContain("from '@object-ui/layout'");
  });
});
