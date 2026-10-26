/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7256 — `/`'s landing and the chrome's Home affordances must never
 * name two different homes.
 *
 * ## Why this file exists at all
 *
 * The declaration (`app.isDefault`) has two readers by construction:
 *
 *   - `resolveLandingPath` here, which layers a single-visible-app EMPTINESS
 *     heuristic on top of it for the `/` entry (objectui#4048);
 *   - `resolveDeclaredHomePath` in `@object-ui/app-shell`, which the top-bar
 *     logo and every "Home" row read through `useHomePath()` — no heuristic,
 *     because a persistent "go home" affordance must not change target with the
 *     number of visible apps.
 *
 * Collapsing them into one import is not available: this module's routing tests
 * (`RootLandingRedirect.route.test.tsx`, `SetupRoute.test.tsx`) replace
 * `@object-ui/app-shell` wholesale with a chrome-free hand-rolled mock, so an
 * import would put the FIXTURE under test instead of the shipped function.
 * A behavioural matrix is the honest substitute, and it is strictly stronger
 * than a source scan: it compares the two shipped answers.
 *
 * The defect it guards is measured. cloud's control plane lands a signed-in
 * customer on `/apps/cloud_control` (its Welcome page), while the logo said
 * `/home` — the environment launcher, whose "Build an app" / "Start from a
 * template" cards act on an environment the control plane does not have, and
 * whose "Your apps" tiles are the control plane's own internal management apps.
 */
import { describe, it, expect } from 'vitest';
import { HOME_LAUNCHER_PATH, resolveDeclaredHomePath } from '@object-ui/app-shell';
import { resolveLandingPath } from './RootLandingRedirect';

const SETUP = { name: 'setup', _packageId: 'com.objectstack.setup' };

/** Lists a real deployment can present, declared and undeclared alike. */
const LISTS: ReadonlyArray<{ label: string; apps: any[] }> = [
  { label: 'control plane (cloud_control declares, Account beside it)', apps: [{ name: 'cloud_control', isDefault: true }, { name: 'account' }] },
  { label: 'control plane, declaration listed second', apps: [{ name: 'account' }, { name: 'cloud_control', isDefault: true }] },
  { label: 'declared app alongside Setup', apps: [{ name: 'crm', isDefault: true }, SETUP] },
  { label: 'declared app that is hidden from the launcher', apps: [{ name: 'crm', isDefault: true, hidden: true }, { name: 'ops' }, SETUP] },
  { label: 'ordinary multi-app environment, nothing declared', apps: [{ name: 'crm' }, { name: 'ops' }, SETUP] },
  { label: 'one product app + Setup, nothing declared', apps: [{ name: 'crm' }, SETUP] },
  { label: 'Setup only — a fresh environment', apps: [SETUP] },
  { label: 'empty list', apps: [] },
];

describe('objectui#7256 — one declaration, one home', () => {
  it.each(LISTS)('$label: a declaration decides BOTH answers', ({ apps }) => {
    const declared = resolveDeclaredHomePath(apps);
    if (declared === null) return; // covered by the undeclared case below
    expect(resolveLandingPath(apps)).toBe(declared);
  });

  it.each(LISTS)('$label: no declaration leaves `/` free to apply its own rules', ({ apps }) => {
    if (resolveDeclaredHomePath(apps) !== null) return;
    // Whatever `/` picks here (the launcher, or a lone product app) is its own
    // policy — the only thing this file forbids is a declared-looking answer
    // appearing on one side and not the other.
    const landing = resolveLandingPath(apps);
    expect(typeof landing).toBe('string');
    expect(landing.startsWith('/')).toBe(true);
  });

  it('the launcher is what BOTH fall back to on an ordinary environment', () => {
    const apps = [{ name: 'crm' }, { name: 'ops' }, SETUP];
    expect(resolveDeclaredHomePath(apps)).toBeNull();
    expect(resolveLandingPath(apps)).toBe(HOME_LAUNCHER_PATH);
  });

  it('DRIFT CANARY: a second isDefault app moves both answers together', () => {
    // If either side ever changed which declaration wins (first vs last), this
    // is where the two would silently disagree.
    const apps = [{ name: 'alpha', isDefault: true }, { name: 'beta', isDefault: true }];
    expect(resolveDeclaredHomePath(apps)).toBe('/apps/alpha');
    expect(resolveLandingPath(apps)).toBe('/apps/alpha');
  });

  it('DRIFT CANARY: a nameless declaration is a declaration to neither', () => {
    const apps = [{ isDefault: true }, { name: 'crm' }, SETUP];
    expect(resolveDeclaredHomePath(apps)).toBeNull();
    expect(resolveLandingPath(apps)).toBe(HOME_LAUNCHER_PATH);
  });
});
