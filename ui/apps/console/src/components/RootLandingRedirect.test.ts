// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveLandingPath, isAppListConclusive } from './RootLandingRedirect';

describe('resolveLandingPath', () => {
  it('routes to the App marked isDefault (isDefault now ROUTES, not just badges)', () => {
    expect(
      resolveLandingPath([
        { name: 'crm' },
        { name: 'cloud_control', isDefault: true },
        { name: 'setup' },
      ]),
    ).toBe('/apps/cloud_control');
  });

  it('prefers isDefault over the single-visible-app rule', () => {
    expect(
      resolveLandingPath([{ name: 'a', isDefault: true }, { name: 'b' }, { name: 'c' }]),
    ).toBe('/apps/a');
  });

  it('lands directly in the single visible App when none is isDefault', () => {
    expect(resolveLandingPath([{ name: 'only_app' }])).toBe('/apps/only_app');
  });

  it('ignores hidden/inactive Apps when counting "single visible"', () => {
    expect(
      resolveLandingPath([
        { name: 'main' },
        { name: 'secret', hidden: true },
        { name: 'off', active: false },
      ]),
    ).toBe('/apps/main');
  });

  it('⛔ counts an UNPUBLISHED App as visible — `_unpublished` is a server gate, not a landing filter', () => {
    // objectstack#6955 (#4829 A1). `hidden` and `_unpublished` split into two
    // keys with two enforcement points: the REST metadata gate already
    // withholds unpublished apps from everyone who should not see them, so an
    // app that reaches this resolver is one the viewer is entitled to. Adding
    // an `_unpublished !== true` clause above would flip this to '/apps/main' —
    // silently landing a builder somewhere other than the app they are building.
    //
    // Declared as a const rather than inline so the extra key is not
    // excess-property-checked against `LandingApp`: the resolver deliberately
    // does not declare a field it must not read.
    const apps = [{ name: 'main' }, { name: 'draft_app', _unpublished: true }];
    expect(resolveLandingPath(apps)).toBe('/home');
  });

  it('falls back to /home for a multi-app deployment with no isDefault (legacy behavior)', () => {
    expect(resolveLandingPath([{ name: 'a' }, { name: 'b' }])).toBe('/home');
  });

  // ── objectui#4048 — Setup is not a "one-app deployment" ──────────────
  //
  // A new builder arriving on a just-created environment (platform SSO, no
  // explicit target) landed on Setup's System Overview — an audit/health
  // dashboard reading all zeros, because a fresh environment HAS no audit
  // history. The chain, measured end to end:
  //
  //   `/` → RootLandingRedirect → resolveLandingPath([setup])
  //       → rule 2 "single visible app" → `/apps/setup`
  //       → AppContent.resolveLandingRoute() → first nav item
  //       → `dashboard/system_overview`
  //
  // Rule 2 is right — a one-app PRODUCT deployment shouldn't have to click
  // through a one-tile launcher (#2027). Setup is not that app: it is the
  // platform administration console shipped by @objectstack/platform-objects
  // into every deployment, so "the only app I can see is Setup" means "this
  // environment has no product apps yet", not "Setup is the product". Under
  // ADR-0075 the environment layer's home is the environment's own
  // responsibility, and `/home` — build-with-AI, start-from-a-template, Your
  // apps — is that home.
  describe('objectui#4048 — a Setup-only deployment lands on the env home', () => {
    const SETUP = { name: 'setup', _packageId: 'com.objectstack.setup' };

    it('THE FIX: Setup as the only visible app resolves /home, not the audit dashboard', () => {
      expect(resolveLandingPath([SETUP])).toBe('/home');
    });

    it('matches Setup by package id even when it carries a different name', () => {
      // ADR-0048 keys the app on its package id; the name is a per-tenant alias.
      expect(resolveLandingPath([{ name: 'platform_admin', _packageId: 'com.objectstack.setup' }])).toBe(
        '/home',
      );
    });

    it('matches a package-less Setup by name — runtime/DB apps carry no _packageId', () => {
      // Same fallback order `resolveSetupAppPath` uses, so the two resolvers
      // cannot disagree about which app is Setup.
      expect(resolveLandingPath([{ name: 'setup' }])).toBe('/home');
    });

    it('still lands in Setup when the deployment DECLARES it (ADR-0075 wins over the default)', () => {
      // The declared landing is the escape hatch: an admin-console deployment
      // that genuinely wants Setup as its first screen says so with
      // `isDefault`, and rule 1 is deliberately untouched by this fix.
      expect(resolveLandingPath([{ ...SETUP, isDefault: true }])).toBe('/apps/setup');
    });

    it('CONTROL: a one-app PRODUCT deployment still lands in its app (#2027 rule 2 intact)', () => {
      expect(resolveLandingPath([{ name: 'crm' }])).toBe('/apps/crm');
    });

    it('CONTROL: Setup alongside a product app is unchanged — this fix only reads the SINGLE-app case', () => {
      // Every real deployment ships Setup. Excluding it from the *count* would
      // silently re-route `[crm, setup]` from /home into /apps/crm — a far
      // bigger behavior change than this card asks for, and not this fix.
      expect(resolveLandingPath([{ name: 'crm' }, SETUP])).toBe('/home');
      expect(resolveLandingPath([{ name: 'crm' }, SETUP, { name: 'showcase' }])).toBe('/home');
    });

    it('CONTROL: a product app stays the landing when Setup is hidden/inactive beside it', () => {
      expect(resolveLandingPath([{ name: 'crm' }, { ...SETUP, hidden: true }])).toBe('/apps/crm');
    });

    it('Studio alone is deliberately NOT redirected — the workbench IS a builder surface', () => {
      // Scoped to Setup on purpose. Landing a builder in Studio is defensible
      // (it is where you build); landing them on an all-zero audit dashboard is
      // not. Widening this to every platform app is a separate judgment call
      // that this card does not authorize.
      expect(resolveLandingPath([{ name: 'studio', _packageId: 'com.objectstack.studio' }])).toBe(
        '/apps/studio',
      );
    });
  });

  it('falls back to /home when there are no apps', () => {
    expect(resolveLandingPath([])).toBe('/home');
    expect(resolveLandingPath(null)).toBe('/home');
    expect(resolveLandingPath(undefined)).toBe('/home');
  });

  it('ignores entries without a name', () => {
    expect(resolveLandingPath([{ isDefault: true }, { name: 'real' }])).toBe('/apps/real');
  });
});

// ── objectui#4233 — "empty" and "unknown" are different facts ────────────
//
// Note what is NOT changed above: every `resolveLandingPath` pin, including
// `[]` → `/home`, still holds. `[]` remains a legitimate input with a
// legitimate answer — the fallthrough is correct when the emptiness is REAL.
// What the resolver never had was the ability to tell a real emptiness from a
// `GET /meta/app` that 401'd or 5xx'd, because `MetadataProvider.ensureType`
// catches and resolves `[]`: nothing rejects, `loading` goes false, and the
// error arrives wearing the same shape as the answer.
//
// This predicate is the seam, and it deliberately reads the metadata context's
// OWN per-type status rather than introducing a second dialect of
// loading/auth state for the landing path to consult.
describe('isAppListConclusive — is this list an answer, or an unknown?', () => {
  it('trusts a settled `ready` list — the fetch happened and this is what came back', () => {
    expect(isAppListConclusive('ready')).toBe(true);
  });

  it('THE FIX: refuses an `error` list — empty-because-401 is UNKNOWN, not "no apps"', () => {
    expect(isAppListConclusive('error')).toBe(false);
  });

  it('refuses a list that is still in flight or was never asked for', () => {
    expect(isAppListConclusive('loading')).toBe(false);
    expect(isAppListConclusive('idle')).toBe(false);
  });

  it('treats an absent status as ready — the context documents `getTypeStatus` as optional', () => {
    // `MetadataContextValue.getTypeStatus` is declared optional so hand-rolled
    // context values (tests, embedders) keep working, and its own doc comment
    // states "absent means always ready". Reading `undefined` as inconclusive
    // would hang every such consumer on the loading fallback forever.
    expect(isAppListConclusive(undefined)).toBe(true);
  });
});
