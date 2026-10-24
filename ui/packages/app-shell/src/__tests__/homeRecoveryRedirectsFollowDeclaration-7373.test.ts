/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7373 — the "this app is gone / you may not be here" RECOVERY exits
 * follow the declared landing too, and no longer name `/home` literally.
 *
 * ## The defect, and why it is a separate card from objectui#7256
 *
 * #7256 (PR #7372) moved the four chrome Home AFFORDANCES — top-bar logo, both
 * sidebar Home rows, the app-switcher Home entry — onto `useHomePath()`, and
 * `homeAffordancesFollowDeclaration-7256.test.ts` pins them. It deliberately
 * left the recovery redirects alone, in those words, because retargeting them
 * moves a `/home` expectation that existing tests pin — a measurement this card
 * did first and ships beside the change.
 *
 * What was left behind: a control-plane customer refused an app, or landed on a
 * surface their runtime does not serve, was dropped on the ENVIRONMENT launcher
 * (ADR-0075) — "Build an app" / "Start from a template" cards acting on an
 * environment the control plane does not have, and "Your apps" tiles that are
 * the control plane's own internal management apps. The declaration was already
 * read by `/` and by the chrome; only the error paths still disagreed.
 *
 * ## ⚠ WHAT THIS FILE CANNOT ASSERT — read before adding a case here
 *
 * A SOURCE SCAN, in the shape of its #7256 sibling. It proves each site stopped
 * naming the launcher and reads the shipped policy; it does not prove where any
 * of them lands. Those are behavioural, one per site, and they are what fails on
 * the pre-#7373 implementation:
 *
 *   - `console/__tests__/AppContent.deniedVsUnpublished.test.tsx` — the denial
 *     screen's way back;
 *   - `console/__tests__/AppContent.inaccessibleAppStrand.test.tsx` — the
 *     no-app-to-enter bounce;
 *   - `console/__tests__/RequireAiSurface.test.tsx` — a runtime serving no
 *     agent;
 *   - `console/ai/__tests__/resolveCollapseToDockTarget.test.ts` — the dock
 *     landing on a cold deep link;
 *   - `views/studio-design/StudioDesignSurface.packageDeletionInference.test.tsx`
 *     — eviction when the edited package is deleted;
 *   - `apps/console/src/components/StudioRoute.test.tsx` — the `/studio` entry
 *     gate and the front door's wordmark;
 *   - `apps/console/src/pages/auth/__tests__/AcceptInvitationRoute.test.tsx` —
 *     accepting an invitation, which lands on the console ROOT rather than
 *     reading the hook (see below).
 *
 * That the hook ANSWERS correctly is `hooks/__tests__/useHomePath.test.tsx`, and
 * that the declaration is read correctly is `utils/__tests__/homePath.test.ts`.
 * None of these replaces another.
 *
 * ## ⭐ One site follows the declaration WITHOUT the hook, on purpose
 *
 * `console/organizations/manage/AcceptInvitationPage.tsx` runs immediately
 * after `switchOrganization`, so the app list it could read still belongs to
 * the organization the user is LEAVING (`MetadataProvider` drops its cache on
 * an org change, objectui#4486, and refetches after that line has run). Reading
 * the hook there would name the PREVIOUS org's app. It lands on the console
 * root instead and lets `RootLandingRedirect` resolve the declaration for the
 * NEW org — the shape `layout/WorkspaceSwitcher.tsx` and
 * `console/organizations/OrganizationsPage.tsx` already take for this same
 * transition. Its row below is keyed on THAT expression, so a later edit that
 * folds it onto `useHomePath()` fails here rather than passing quietly.
 *
 * ## ⛔ One site in this file's own subject matter deliberately still names the
 * launcher, and this file must not grow a case for it
 *
 *   - `utils/homePath.ts` — `HOME_LAUNCHER_PATH` IS the launcher, and the `??`
 *     fallback every site above resolves through. Making it anything else is
 *     option C (redirecting `/home` itself), which the card's ruling excluded:
 *     it would strip the environment layer of its real launcher (ADR-0075).
 *
 * `console/ConsoleShell.tsx`'s `RootRedirect` was a second such site — the `/`
 * LANDING rather than a recovery exit, held out of the launcher scan by a
 * cut-out region. objectui#10042 removed it, because `/` had two answers in
 * this repo and the published one ignored the declaration the chrome follows.
 * `/`'s one remaining resolver is `apps/console`'s `resolveLandingPath`, with
 * its emptiness heuristic (objectui#4048) and its refusal to conclude from an
 * unresolved list (objectui#4233). The cut-out went with the function, so the
 * scan below now reads that file whole; that `/` still has exactly ONE resolver
 * is pinned by `rootLandingHasOneResolver-10042.test.ts`.
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
 * Drop block and line comments before scanning, for the reason the #7256 file
 * gives: doc comments legitimately NAME the launcher while explaining which
 * screen it is and why a site no longer points there, and a rule that forbids
 * documenting its own subject only applies pressure to delete the explanation.
 */
function stripComments(src: string): string {
  return mask(src);
}

/**
 * The recovery exits: file → the expression each must resolve its target by.
 */
const RECOVERY_SITES: ReadonlyArray<{
  file: string;
  site: string;
  expression: RegExp;
}> = [
  {
    file: 'packages/app-shell/src/console/AppContent.tsx',
    site: 'access-denied screen + the no-app-to-enter bounce',
    expression: /const homePath = useHomePath\(\)/,
  },
  {
    file: 'packages/app-shell/src/console/ConsoleShell.tsx',
    site: 'RequireAiSurface — a runtime that serves no agent',
    expression: /redirectTo \?\? homePath/,
  },
  {
    file: 'packages/app-shell/src/console/ai/AiChatPage.tsx',
    site: 'the AI page: no-agent screen + collapse-to-dock landing',
    expression: /const homePath = useHomePath\(\)/,
  },
  {
    file: 'packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx',
    site: 'Studio: deleted-package eviction + header Home',
    expression: /const homePath = useHomePath\(\)/,
  },
  {
    file: 'apps/console/src/components/StudioRoute.tsx',
    site: 'the /studio entry gate + the front door wordmark',
    expression: /const homePath = useHomePath\(\)/,
  },
  {
    file: 'packages/app-shell/src/console/organizations/manage/AcceptInvitationPage.tsx',
    site: 'accepting an invitation — the org-switch landing',
    // ⭐ The ONE site here that may not read `useHomePath()`, and the expression
    // says which policy it reads instead. Its app list belongs to the org being
    // LEFT, so it resolves the declaration by landing on the console root and
    // letting `RootLandingRedirect` read the new org's list — the shape both
    // other org-switch paths take. A future edit that "unified" this onto the
    // hook would pass a scan keyed on the hook; this one refuses it.
    expression: /window\.location\.href = resolveRootUrl\(\)/,
  },
];

/** `'/home'`, `"/home"` or `` `/home` `` — the literal in any quoting. */
const LAUNCHER_LITERAL = /['"`]\/home['"`]/;

describe('objectui#7373 — recovery redirects follow the declared landing', () => {
  it.each(RECOVERY_SITES)('$site does not hard-code the launcher path', ({ file }) => {
    expect(stripComments(read(file))).not.toMatch(LAUNCHER_LITERAL);
  });

  it.each(RECOVERY_SITES)('$site resolves its target through the policy', ({ file, expression }) => {
    expect(stripComments(read(file))).toMatch(expression);
  });

  it('the scan can still fail — the literal is what it is looking for', () => {
    // Without this, a `maskComments` that started returning '' would pass every
    // case above as a scan of nothing. Same source, same masker, same regex.
    expect(stripComments(`const x = '/home';`)).toMatch(LAUNCHER_LITERAL);
    expect(stripComments(read('packages/app-shell/src/utils/homePath.ts'))).toMatch(
      LAUNCHER_LITERAL,
    );
  });

  it('⛔ the launcher constant itself is untouched — option C stays excluded', () => {
    // `HOME_LAUNCHER_PATH` is the fallback every site above resolves through.
    // A card that "fixed" this line would redirect `/home` itself and strip the
    // environment layer of its launcher (ADR-0075) — excluded by the ruling.
    const src = stripComments(read('packages/app-shell/src/utils/homePath.ts'));
    expect(src).toMatch(/export const HOME_LAUNCHER_PATH = '\/home';/);
  });

  it('⛔ the `/` landing is not a site in this file at all', () => {
    // `/`'s answer is `apps/console`'s `resolveLandingPath`, whose extra rules
    // the chrome hook does not have — it may not be quietly folded into the
    // hook, and since objectui#10042 there is no second `/` element in this
    // package to fold. Kept as a case so removing the last trace of that
    // reasoning is a visible act rather than a silent one; the "exactly one
    // resolver" invariant itself lives in `rootLandingHasOneResolver-10042`.
    const src = stripComments(read('packages/app-shell/src/console/ConsoleShell.tsx'));
    expect(src).not.toMatch(/export function RootRedirect\(\)/);
  });
});
