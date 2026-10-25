/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#10042 — `/` has ONE resolver, and this package does not publish a
 * second one.
 *
 * ## The defect
 *
 * `/` had two answers in this repo. `packages/app-shell` published a
 * `RootRedirect` that sent `/` to the launcher unconditionally, while
 * `apps/console` — the console that actually ships — mounted its own
 * `RootLandingRedirect`, which resolves the landing from the app metadata:
 * `isDefault` routes (objectui#7256's declaration), a single visible app that
 * is not the platform Setup console lands straight in that app
 * (objectui#4048), and an app list that never loaded refuses to conclude
 * anything at all (objectui#4233). Same route, two answers, and the published
 * one was the poorer: it ignored the declaration every other Home affordance in
 * the chrome follows.
 *
 * The ruling on that card removed the unguarded published twin rather than
 * moving the guarded one: the console's `/` behaviour is the fixed point, and
 * its routing tests mock `@object-ui/app-shell` wholesale, so a resolver hosted
 * inside this package would be a resolver those tests can no longer reach —
 * measured, not assumed (the same reason
 * `homeAffordancesFollowDeclaration-7256.test.ts` states for keeping the two
 * readings apart).
 *
 * ## ⚠ WHAT THIS FILE CANNOT ASSERT — read before adding a case here
 *
 * A SOURCE SCAN. It proves this package ships no `/` element of its own and
 * that the surviving resolver still carries both guards in its source; it does
 * not prove that resolver ANSWERS correctly. That is
 * `apps/console/src/components/RootLandingRedirect.test.ts` (the policy),
 * `RootLandingRedirect.route.test.tsx` (the entry path) and
 * `landingHomeParity-7256.test.ts` (the landing and the chrome agreeing).
 * None of the four replaces another.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

/**
 * Drop comments before scanning, for the reason the #7256 and #7373 scans give:
 * prose legitimately names a component while explaining why it is gone, and a
 * rule that forbids documenting its own subject only pressures the next author
 * to delete the explanation.
 */
const stripComments = (src: string): string => mask(src);

/** The removed twin, in code — any quoting, any position. */
const REMOVED_TWIN = /\bRootRedirect\b/;

/** The sibling redirect this package still publishes — the control's subject. */
const SURVIVING_SIBLING = /\bSystemRedirect\b/;

const SHELL = 'packages/app-shell/src/console/ConsoleShell.tsx';
const BARREL = 'packages/app-shell/src/index.ts';
const CONSOLE_RESOLVER = 'apps/console/src/components/RootLandingRedirect.tsx';

describe('objectui#10042 — `/` has one resolver', () => {
  it('the package defines no `/` landing element of its own', () => {
    expect(stripComments(read(SHELL))).not.toMatch(REMOVED_TWIN);
  });

  it('the package barrel publishes no `/` landing element', () => {
    expect(stripComments(read(BARREL))).not.toMatch(REMOVED_TWIN);
  });

  it('CONTROL — the same reader finds the redirect this package DOES publish', () => {
    // Without this, a `maskComments` that started returning '' — or a typo in
    // the pattern above — would pass both absences as a scan of nothing.
    expect(stripComments(read(SHELL))).toMatch(SURVIVING_SIBLING);
    expect(stripComments(read(BARREL))).toMatch(SURVIVING_SIBLING);
  });

  it('the surviving resolver is the console one, and it still carries both guards', () => {
    // Read RAW: the guard citations live in the doc comments beside the rules
    // they explain, which is the only place a reader of those rules will look.
    const src = read(CONSOLE_RESOLVER);
    expect(src).toMatch(/export function resolveLandingPath\(/);
    expect(src).toMatch(/export function isAppListConclusive\(/);
    expect(src).toMatch(/objectui#4048/);
    expect(src).toMatch(/objectui#4233/);
  });
});
