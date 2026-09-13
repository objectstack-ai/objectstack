// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17821 — `os lint`'s `naming/namespace-prefix` advisory is evaluated PER
 * PACKAGE, so a bare name two packages each legitimately declare is not
 * reported as one package declaring it twice.
 *
 * ## The defect
 *
 * The rule read ONE flattened array per collection key — `stack[key]`, one
 * `firstSeen` map, no package boundary — while its own comment asserted "we
 * only see one package's config here". On a composed multi-package project
 * (`composeStacks(…, { manifest: 'preserve' })`, the shape the platform emits)
 * that array carries every package's items, so two packages each declaring
 * `home` produced:
 *
 *     ⚠ App "home" is declared more than once in this package (also at
 *       apps[0].name). … rename one, e.g. "alpha_home". Distinct packages may
 *       reuse the same name freely …          naming/namespace-prefix at apps[1].name
 *
 * — a prescription to rename a name that was already correct, suggesting the
 * OTHER package's namespace (`alpha_` is `com.example.a`'s; the reported item
 * belongs to `com.example.b`), under a closing sentence stating the opposite of
 * the finding. ADR-0130 D4/D5 registers artifacts per package and `compile.ts`
 * step 3b-ii already runs the author-time rule table that way, so the fix is
 * the same shape at the entry that missed it, not a new one.
 *
 * ## What this file pins, and why BOTH directions are here
 *
 * ⛔ A run of only the false-positive side is indistinguishable from turning
 * the advisory off — the one outcome `compile.ts:118`'s fence names ("This is
 * NOT 'skip the site per package' — that would silence the gate"). So every
 * false-positive case below has a true-positive twin built from the SAME items,
 * moved into one package, and the file asserts the count in both directions.
 *
 * Both ADR-0130 D4 stack shapes are exercised throughout. Since #17528 landed
 * (`8305ad6df`) the hand-written family reads a folded stack, so the
 * `packages[]`-only shape false-positived exactly like the additive one —
 * repairing one alone would have been half a fix.
 *
 * The `registryKey` composite-key hook (#5510: an action registers under
 * `<objectName>:<name>`, object-less falling back to `GLOBAL_ACTION_OBJECT_KEY`)
 * is a SECOND axis that the package axis must not swallow, so it is pinned here
 * cross-package and same-package, at the HotCRM shape that produced 12 false
 * positives per run when the bare name was the key.
 *
 * Measured through the real binary (`node packages/cli/bin/run.js lint`, exit 0
 * on every row) at `84e6b05b6` vs. this change — the numbers this file holds:
 *
 *     fixture                     shape         before  after
 *     card repro (two `home`)     additive        1       0
 *     card repro (two `home`)     packages[]      1       0
 *     two `home` in ONE package   additive        1       1
 *     two `home` in ONE package   packages[]      1       1
 *     one action per package      additive        1       0
 *     two actions, one package    additive        1       1
 */

import { describe, expect, it } from 'vitest';

import { lintConfig } from '../src/commands/lint';

const RULE = 'naming/namespace-prefix';
const prefixIssues = (config: unknown) =>
  lintConfig(config as any).filter((i) => i.rule === RULE);

// ─── Fixture vocabulary ─────────────────────────────────────────────────────
// Package entries are PARSED before any rule runs (`authoringRuleUnionStack` →
// `resolveArtifactPackageOrder`, whose ADR-0112 refusals are deliberately not
// swallowed), so every body below is schema-valid.

const A = { id: 'com.example.a', name: 'a', version: '1.0.0', type: 'app', namespace: 'alpha' };
const B = {
  id: 'com.example.b', name: 'b', version: '1.0.0', type: 'module', namespace: 'beta',
  dependencies: { 'com.example.a': '^1.0.0' },
};
const TOP = { ...A, engines: { protocol: '^17' } };

const obj = () => ({
  name: 'ob_order', label: 'Order', sharingModel: 'private', nameField: 'number',
  fields: { number: { type: 'text', label: 'Number' } },
});
const app = (name: string, label: string) => ({ name, label });
const action = (name: string, objectName?: string) => ({
  name,
  label: 'Log Call',
  target: 'logCall',
  ...(objectName === undefined ? {} : { objectName }),
});

/** Today's emitted artifact: collections flattened to the top level AND in `packages[]`. */
const additive = (bodies: Array<Record<string, unknown>>) => {
  const flattened: Record<string, unknown[]> = {};
  for (const body of bodies) {
    for (const [key, value] of Object.entries(body)) {
      if (Array.isArray(value)) (flattened[key] ??= []).push(...value);
    }
  }
  return {
    manifest: { ...TOP },
    ...flattened,
    packages: bodies.map((body) => ({ manifest: body })),
  };
};

/** ADR-0130 D4 / option B: `packages[]` carries each definition exactly once. */
const packagesOnly = (bodies: Array<Record<string, unknown>>) => ({
  manifest: { ...TOP },
  packages: bodies.map((body) => ({ manifest: body })),
});

const SHAPES = [
  ['additive', additive],
  ['packages[]-only', packagesOnly],
] as const;

describe('#17821 — the duplicate-name advisory is evaluated per package', () => {
  describe.each(SHAPES)('%s stack', (_label, shape) => {
    it("THE CARD'S REPRO — two packages each declaring `home` is not a duplicate", () => {
      // The two declarations occupy distinct composite registry keys and
      // nothing shadows anything, which is what the warning's own last sentence
      // already said. 1 warning before this change, 0 after.
      const issues = prefixIssues(shape([
        { ...A, apps: [app('home', 'Home A')], objects: [obj()] },
        { ...B, apps: [app('home', 'Home B')] },
      ]));
      expect(issues).toEqual([]);
    });

    it('THE TRUE POSITIVE — the SAME two names inside ONE package still warn', () => {
      // ⛔ Without this direction the assertion above is satisfied by an
      // advisory that was simply switched off. Same items, same shape, one
      // package: exactly one finding.
      const issues = prefixIssues(shape([
        { ...A, apps: [app('portal', 'Portal One')], objects: [obj()] },
        { ...B, apps: [app('home', 'Home B'), app('home', 'Home B2')] },
      ]));
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      // Written whole, so it resolves in the file the author wrote — in BOTH
      // shapes. A bare `apps[1]` would, on the additive shape, point at a
      // different item than the one being reported.
      expect(issues[0].path).toBe('packages[1].manifest.apps[1].name');
      expect(issues[0].message).toContain('packages[1].manifest.apps[0].name');
    });

    it('THE SUGGESTION comes from the OWNING package, never from a sibling', () => {
      // The card's sharpest symptom: the prescribed rename carried `alpha_`,
      // the namespace of the package that does NOT own the reported item.
      const issues = prefixIssues(shape([
        { ...A, apps: [app('portal', 'Portal')], objects: [obj()] },
        { ...B, apps: [app('home', 'Home B'), app('home', 'Home B2')] },
      ]));
      expect(issues).toHaveLength(1);
      expect(issues[0].fix).toBe('beta_home');
      expect(issues[0].message).toContain('"beta_home"');
      expect(issues[0].message).not.toContain('alpha_');
    });

    it('a duplicate in EVERY package is reported once per package, in that package\'s coordinates', () => {
      const issues = prefixIssues(shape([
        { ...A, apps: [app('home', 'H1'), app('home', 'H2')], objects: [obj()] },
        { ...B, apps: [app('home', 'H3'), app('home', 'H4')] },
      ]));
      expect(issues.map((i) => i.path)).toEqual([
        'packages[0].manifest.apps[1].name',
        'packages[1].manifest.apps[1].name',
      ]);
    });
  });

  it('the per-package stack is handed the artifact\'s `packages[]`, and judges only its own', () => {
    // `packageBodyAsStack` passes the artifact's package list through as
    // RESOLUTION CONTEXT (#16611). It changes what a rule can RESOLVE, never
    // what it JUDGES — so a sibling's `home` must not enter this package's
    // dedup, and the finding count stays at the one real duplicate.
    const issues = prefixIssues(additive([
      { ...A, apps: [app('home', 'Home A')], objects: [obj()] },
      { ...B, apps: [app('home', 'Home B'), app('home', 'Home B2')] },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('packages[1].manifest.apps[1].name');
  });
});

describe('#17821 — the package axis does not swallow the `registryKey` composite-key axis', () => {
  const ACTIVITY = ['log_call', 'log_meeting', 'schedule_meeting'];
  const CRM_OBJECTS = ['crm_lead', 'crm_contact', 'crm_account', 'crm_opportunity', 'crm_case'];

  it('ACTIONS CROSS-PACKAGE — one `objectName:name` per package is not a duplicate', () => {
    const issues = prefixIssues(additive([
      { ...A, objects: [obj()], actions: [action('log_call', 'ob_order')] },
      { ...B, actions: [action('log_call', 'ob_order')] },
    ]));
    expect(issues).toEqual([]);
  });

  it('ACTIONS SAME-PACKAGE — two actions on one `objectName` in one package still warn', () => {
    const issues = prefixIssues(additive([
      { ...A, objects: [obj()] },
      { ...B, actions: [action('log_call', 'ob_order'), action('log_call', 'ob_order')] },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('packages[1].manifest.actions[1].name');
    // #5510's calibrated remedy survives the package split: separating the
    // objects is still offered before a rename.
    expect(issues[0].message).toContain('distinct `objectName`');
    expect(issues[0].message).toContain('objectName:name');
  });

  it('the composite key still splits WITHIN a package — the HotCRM shape stays silent', () => {
    // 5 objects × 3 activity actions = 15 declarations on 15 distinct keys,
    // all inside ONE package of a two-package artifact. Deduping these on the
    // bare name is what produced 12 false positives per run (#5510); the
    // package axis must not reintroduce it by dropping the composite key.
    const actions = CRM_OBJECTS.flatMap((objectName) =>
      ACTIVITY.map((name) => action(name, objectName)));
    expect(actions).toHaveLength(15);
    expect(prefixIssues(additive([
      { ...A, objects: [obj()] },
      { ...B, actions },
    ]))).toEqual([]);
  });

  it('the object-less fallback is still `GLOBAL_ACTION_OBJECT_KEY`, per package', () => {
    // An action on an object literally named `global` and an object-less one
    // collide for real in the engine's exact-string map (#3913) — inside one
    // package they must still be reported, and across packages they must not.
    const same = prefixIssues(additive([
      { ...A, objects: [obj()] },
      { ...B, actions: [action('sync', 'global'), action('sync')] },
    ]));
    expect(same).toHaveLength(1);
    expect(same[0].path).toBe('packages[1].manifest.actions[1].name');

    const across = prefixIssues(additive([
      { ...A, objects: [obj()], actions: [action('sync', 'global')] },
      { ...B, actions: [action('sync')] },
    ]));
    expect(across).toEqual([]);
  });
});

describe('#17821 — a single-package project is judged exactly as it was', () => {
  // The fence on the fix: neither leg may change what one package is told. With
  // fewer than two packages the flattened top level IS that package's
  // collections, so the existing read already is the per-package read and is
  // kept verbatim — including the path coordinates every other check in
  // `lintConfig` reports in.
  const oneBody = () => ({ ...A, apps: [app('home', 'H1'), app('home', 'H2')], objects: [obj()] });

  it('one `packages[]` entry is judged identically to no `packages[]` at all', () => {
    const bare = prefixIssues({ manifest: { ...TOP }, ...{ apps: oneBody().apps, objects: oneBody().objects } });
    expect(bare).toHaveLength(1);
    expect(bare[0].path).toBe('apps[1].name');

    for (const [, shape] of SHAPES) {
      expect(prefixIssues(shape([oneBody()]))).toEqual(bare);
    }
  });

  it('a clean single-package project stays clean in every shape', () => {
    const body = { ...A, apps: [app('home', 'H1'), app('portal', 'P1')], objects: [obj()] };
    expect(prefixIssues({ manifest: { ...TOP }, apps: body.apps, objects: body.objects })).toEqual([]);
    for (const [, shape] of SHAPES) expect(prefixIssues(shape([body]))).toEqual([]);
  });
});
