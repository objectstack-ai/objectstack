/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9012 — `@object-ui/core`'s DECLARED `@objectstack/spec` floor must
 * admit only specs that accept what this package's own fold produces.
 *
 * The sibling pin `normalize-list-view.foldOutputAuthorable-5435.test.ts` proves
 * the fold's output is authorable against the RESOLVED spec. That is a fact
 * about the lockfile, not about what a consumer installs: `dependencies`
 * declared `^17.2.0`, and a consumer resolution landing on 17.2.x — a sibling
 * pinning it exactly, an `overrides` entry, an offline mirror a minor behind —
 * satisfied that range. This file pins the other half, the DECLARED floor.
 *
 * ## The measurement (objectui#9012, re-derived against published artifacts)
 *
 * Each published 17.x was installed into its own isolated consumer project
 * (`npm install @objectstack/spec@VERSION`, no workspace resolution anywhere)
 * and the fold's real output parsed against that install's own `./ui` entry:
 *
 *   17.0.0  UserActionsConfigSchema declares  8 keys  REFUSED group/hideFields/rowColor
 *   17.1.0  UserActionsConfigSchema declares  8 keys  REFUSED group/hideFields/rowColor
 *   17.2.0  UserActionsConfigSchema declares  8 keys  REFUSED group/hideFields/rowColor
 *   17.3.0  UserActionsConfigSchema declares 11 keys  ACCEPTED
 *   17.4.0  UserActionsConfigSchema declares 11 keys  ACCEPTED
 *
 * A firing control (`zzUndeclared`) was refused by ALL FIVE, so "ACCEPTED" is
 * not the reading of a schema that accepts everything, and "REFUSED" is not the
 * reading of one that refuses everything.
 *
 * A SECOND, INDEPENDENT ROUTE landed on the same floor until objectui#11073:
 * `ListViewSchema` gained `pageName` in the same release, and `type: 'page'`
 * with it, refused by 17.0.0 / 17.1.0 / 17.2.0 and accepted from 17.3.0.
 * `@objectstack/spec` 17.5.0 RETIRED both (ADR-0049 enforce-or-remove), so that
 * route no longer props the floor: it rests on the `UserActionsConfigSchema`
 * key family alone, which is what the rows below measure. The retirement itself
 * is pinned in `normalize-list-view.pageResidual-8429.test.ts`.
 *
 * ⇒ 17.3.0 is the FIRST published version that accepts, verified across the
 * whole published 17.x stable line rather than by taking the first version that
 * happened to work. The line is exactly 17.0.0, 17.1.0, 17.2.0, 17.3.0, 17.4.0
 * — there is no unexamined gap between the last refusing and first accepting
 * release.
 *
 * ## Why this is a test and not a gate extension
 *
 * `scripts/check-spec-range-floors.mjs` judges SYMBOL PRESENCE in the floor's
 * published artifact, and `UserActionsConfigSchema` / `ListViewSchema` are
 * exported by every version above — so that gate is green at `^17.2.0` and
 * would stay green at any floor. The requirement here is BEHAVIOURAL (which
 * KEYS the symbol declares), deliberately outside that gate's criterion; its
 * header argues at length why a behaviour-based criterion there would over-name
 * symbols. Teaching the gate this class is objectui#9012's fourth question and
 * is filed separately rather than smuggled in here.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListViewSchema as SpecListViewSchema, UserActionsConfigSchema } from '@objectstack/spec/ui';

import { normalizeListViewSchema } from '../normalize-list-view.js';

/**
 * The first published `@objectstack/spec` that accepts this package's fold
 * output. Measured, not assumed — see the docblock above.
 */
const REQUIRED_FLOOR = '17.3.0';

/**
 * `[major, minor, patch]` of a plain `X.Y.Z`, or of a prerelease `X.Y.Z-tag`
 * (objectui#12030 moved the range to `^18.0.0-next.0`), or `null`. A prerelease
 * orders below its own `X.Y.Z` and above every lower release, so reading its
 * core triple is exact whenever the triples differ. The comparator below calls
 * an EQUAL triple satisfied, which a prerelease of the required floor would
 * not be — so a prerelease triple equal to the floor is refused there.
 */
const parseVersion = (v: string): [number, number, number] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

const isPrerelease = (v: string): boolean => /^\d+\.\d+\.\d+-/.test(v.trim());

/**
 * The `@objectstack/spec` this package resolves, read from the installed
 * manifest: the pinned build standalone, the workspace link to `packages/spec`
 * inside the objectstack monorepo (objectstack ruling D1). A `workspace:` range
 * publishes as `^<this version>`, so this is that range's floor.
 */
const installedSpecVersion = (): string =>
  (createRequire(import.meta.url)('@objectstack/spec/package.json') as { version: string }).version;

/**
 * The minimum version a range admits: the bare version of a `^X.Y.Z` range,
 * and the installed spec's own version for `workspace:*` / `^` / `~` / bare
 * (a `workspace:<range>` tail reads as that range).
 */
const floorOf = (range: string): string => {
  const workspace = /^workspace:(.*)$/.exec(range.trim());
  if (!workspace) return range.trim().replace(/^[\^~>=\s]+/, '');
  const tail = workspace[1].trim();
  return ['', '*', '^', '~'].includes(tail) ? installedSpecVersion() : floorOf(tail);
};

/** Whether every version `range` admits is at or above `required`. */
const admitsOnlyAtOrAbove = (range: string, required: string): boolean => {
  const low = parseVersion(floorOf(range));
  const need = parseVersion(required);
  if (!low || !need) return false;
  for (let i = 0; i < 3; i += 1) {
    if (low[i] !== need[i]) return low[i] > need[i];
  }
  return !isPrerelease(floorOf(range));
};

const manifest = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { name: string; dependencies?: Record<string, string> };

/** The widest `userActions` block the fold can produce — all seven flags. */
const LEGACY_VIEW = {
  name: 'my_view',
  label: 'My View',
  type: 'grid',
  columns: [{ field: 'name' }],
  showSearch: true,
  showSort: true,
  showFilters: true,
  showDensity: true,
  showGroup: false,
  showHideFields: true,
  showColor: true,
} as const;

/** The three keys adopted in 17.3.0 that made the old floor wrong. */
const ADOPTED_KEYS = ['group', 'hideFields', 'rowColor'] as const;

describe('the DECLARED spec floor admits only specs that accept the fold (objectui#9012)', () => {
  beforeEach(() => {
    // #8372's undrawable-kind warning is developer-facing noise here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the comparator, proven able to redden before it is trusted', () => {
    it('refuses the floor this card replaced, and every floor below it', () => {
      // ⭐ FIRING CONTROLS. Without these, `admitsOnlyAtOrAbove` returning true
      // for the live manifest is equally consistent with a predicate that
      // returns true for everything.
      expect(admitsOnlyAtOrAbove('^17.2.0', REQUIRED_FLOOR)).toBe(false);
      expect(admitsOnlyAtOrAbove('^17.1.0', REQUIRED_FLOOR)).toBe(false);
      expect(admitsOnlyAtOrAbove('^17.0.0', REQUIRED_FLOOR)).toBe(false);
      expect(admitsOnlyAtOrAbove('^16.99.99', REQUIRED_FLOOR)).toBe(false);

      // ... and accepts the floor that measured clean, and later ones.
      expect(admitsOnlyAtOrAbove('^17.3.0', REQUIRED_FLOOR)).toBe(true);
      expect(admitsOnlyAtOrAbove('^17.4.0', REQUIRED_FLOOR)).toBe(true);

      // A prerelease floor reads by its core triple: above the floor when the
      // triple is, and refused when it is the floor's own prerelease.
      expect(admitsOnlyAtOrAbove('^18.0.0-next.0', REQUIRED_FLOOR)).toBe(true);
      expect(admitsOnlyAtOrAbove('^17.3.0-next.0', REQUIRED_FLOOR)).toBe(false);
      expect(admitsOnlyAtOrAbove('^17.2.0-next.0', REQUIRED_FLOOR)).toBe(false);

      // A range it cannot reason about must not read as satisfied.
      expect(admitsOnlyAtOrAbove('*', REQUIRED_FLOOR)).toBe(false);
    });

    it('reads a workspace: range as the installed spec\'s own version (objectstack ruling D1)', () => {
      // Inside the objectstack monorepo this package declares `workspace:^`,
      // which publishes as `^<the spec's version>`: that version is the floor.
      const installed = installedSpecVersion();
      expect(installed).toMatch(/^\d+\.\d+\.\d+/);
      for (const range of ['workspace:*', 'workspace:^', 'workspace:~', 'workspace:']) {
        expect(floorOf(range), range).toBe(installed);
      }
      expect(floorOf('workspace:^17.3.0')).toBe('17.3.0');
      // The comparator still fires on it: the installed spec is at or above the
      // measured floor (or this package could not build), and below a floor no
      // spec has reached.
      expect(admitsOnlyAtOrAbove('workspace:^', REQUIRED_FLOOR)).toBe(true);
      expect(admitsOnlyAtOrAbove('workspace:^', '9999.0.0')).toBe(false);
      expect(admitsOnlyAtOrAbove('workspace:^17.2.0', REQUIRED_FLOOR)).toBe(false);
    });
  });

  describe('⭐ the declared range', () => {
    it('declares the spec as a consumer-facing dependency at or above the measured floor', () => {
      const declared = manifest.dependencies?.['@objectstack/spec'];

      // `dependencies`, not `devDependencies`: a dev range floors nothing for
      // anybody, which is why this pin reads that field by name.
      expect(declared, '@objectstack/spec must stay a runtime dependency').toBeTruthy();
      expect(
        admitsOnlyAtOrAbove(declared as string, REQUIRED_FLOOR),
        `declared "${declared}" admits a spec below ${REQUIRED_FLOOR}, which refuses this package's own fold output`,
      ).toBe(true);
    });
  });

  describe('the requirement stays anchored to the spec, not to a number in this file', () => {
    it('still emits exactly the keys the measurement was taken on', () => {
      const out = normalizeListViewSchema(LEGACY_VIEW) as Record<string, unknown>;
      const ua = out.userActions as Record<string, unknown>;

      // If the fold stops emitting these, REQUIRED_FLOOR is answering a
      // question nobody is asking any more and this pin must be revisited.
      for (const key of ADOPTED_KEYS) expect(Object.keys(ua)).toContain(key);
    });

    it('requires a spec that declares every key the floor was chosen for', () => {
      const specKeys = Object.keys(UserActionsConfigSchema.shape);
      for (const key of ADOPTED_KEYS) expect(specKeys).toContain(key);
      // The second route (`pageName` on a `page` view) was retired by the spec at
      // 17.5.0 and no longer props this floor (objectui#11073).
      expect(SpecListViewSchema.safeParse({ name: 'account_page', type: 'page', pageName: 'crm_welcome', columns: [] }).success).toBe(false);
    });
  });
});
