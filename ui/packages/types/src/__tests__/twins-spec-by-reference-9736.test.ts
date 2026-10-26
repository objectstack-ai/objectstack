/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9736 — the three hand-written TypeScript twins take the spec BY
 * REFERENCE, the way their zod mirrors do (ruling batch #167 item 4, letter 甲).
 *
 * `AppComponentSchema` / `DashboardComponentSchema` / `PageNodeSchema` each
 * extend `Omit< App | Dashboard | Page, … >` over the SAME `as const` exclusion
 * array their mirror's `specFieldsExcept` call reads (`APP_SPEC_EXCLUDED`,
 * `DASHBOARD_SPEC_EXCLUDED`, `PAGE_SPEC_EXCLUDED`), plus — on the TypeScript
 * face only — the twin member whose hand-written type is not assignable to
 * the spec's (`slots` on the page, ledgered as drift in
 * `zod-mirror-parity.test.ts`). The dashboard's `header` was a second such
 * member until objectui#7759 group A dropped the omission: the twin now
 * inherits the spec's `header` by reference. The page's `assignedProfiles`
 * was a third, a forward-compat omission, until objectui#9409 retired it:
 * `@objectstack/spec` 17.5.0 made it a `retiredKey()` tombstone, and both faces
 * now take that tombstone by reference.
 *
 * ## Why the positive pins are TYPE equalities, not assignments
 *
 * `BaseSchema` carried `[key: string]: any` when this was written, so an object
 * literal carrying ANY key compiled against these interfaces whether or not the
 * key was declared — an "it compiles" pin would have been green on the tree
 * before this change. So:
 *   - declared-ness is read through `DeclaredKeys`, which filters the index
 *     signature out (`string extends K`);
 *   - member types are compared with `Equal`, against the spec's own member;
 *   - the tombstone half is a `@ts-expect-error` on an authored value, which
 *     only sticks BECAUSE the key is now declared (the index signature would
 *     have absorbed it as `any` — `dashboard-aria-retired-contract-twins` is the
 *     record of that pin not sticking before).
 *
 * Real enforcement because `packages/types/tsconfig.test.json` is chained from
 * this package's `type-check` script; the runtime half asserts the mirror
 * gives the same verdict on the same literal.
 */

import { describe, it, expect } from 'vitest';
import type { App, Dashboard, Page } from '@objectstack/spec/ui';
import type { AppComponentSchema } from '../app';
import type { DashboardComponentSchema } from '../complex';
import type { PageNodeSchema } from '../layout';
import type { IsRetiredKeyType } from './retired-key-type';
import {
  AppComponentSchema as AppMirror,
  DashboardComponentSchema as DashboardMirror,
  PageNodeSchema as PageMirror,
} from '../zod/index.zod';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type DeclaredKeys<T> = keyof { [K in keyof T as string extends K ? never : K]: T[K] };

/** Keys the spec's document type declares that the twin does NOT declare. */
type SpecKeysUndeclaredOn<Spec, Twin> = Exclude<keyof Spec, DeclaredKeys<Twin>>;

describe('each twin declares every key its spec document type declares', () => {
  it('App / Dashboard / Page: the spec-minus-declared key set is empty', () => {
    // Before objectui#9736 these read as the MirroredUndeclared rows (20 / 11 / 10
    // keys). ⭐ Control: `DeclaredKeys` must see real members, or `never` above is
    // vacuous — `protection` / `requires` are keys ONLY the spec projection brings.
    const app: Equal<SpecKeysUndeclaredOn<App, AppComponentSchema>, never> = true;
    const dashboard: Equal<SpecKeysUndeclaredOn<Dashboard, DashboardComponentSchema>, never> = true;
    const page: Equal<SpecKeysUndeclaredOn<Page, PageNodeSchema>, never> = true;
    const controlApp: 'protection' extends DeclaredKeys<AppComponentSchema> ? true : false = true;
    const controlPage: 'requires' extends DeclaredKeys<PageNodeSchema> ? true : false = true;
    const controlNegative: 'notASpecKey9736' extends DeclaredKeys<AppComponentSchema> ? true : false = false;
    expect([app, dashboard, page, controlApp, controlPage, controlNegative]).toEqual([true, true, true, true, true, false]);
  });
});

describe('admitted spec keys land on the twin with the SPEC\'S type, not `any`', () => {
  it('the package-lock envelope and document keys equal the spec member', () => {
    const lock: Equal<AppComponentSchema['_lock'], App['_lock']> = true;
    const appProtection: Equal<AppComponentSchema['protection'], App['protection']> = true;
    const defaultAgent: Equal<AppComponentSchema['defaultAgent'], App['defaultAgent']> = true;
    const dashProtection: Equal<DashboardComponentSchema['protection'], Dashboard['protection']> = true;
    const dashPackageId: Equal<DashboardComponentSchema['_packageId'], Dashboard['_packageId']> = true;
    const pageSource: Equal<PageNodeSchema['source'], Page['source']> = true;
    const pageRequires: Equal<PageNodeSchema['requires'], Page['requires']> = true;
    const pageInterfaceConfig: Equal<PageNodeSchema['interfaceConfig'], Page['interfaceConfig']> = true;
    // Control: `Equal` tells `any` apart from a real member type. (An undeclared
    // key read `any` through the index signature until objectui#8347 removed it;
    // the control reads `any` directly now.)
    const anyControl: Equal<any, App['_lock']> = false;
    expect([lock, appProtection, defaultAgent, dashProtection, dashPackageId, pageSource, pageRequires, pageInterfaceConfig, anyControl])
      .toEqual([true, true, true, true, true, true, true, true, false]);
  });

  it('`contextSelectors` — withheld from the projection — is declared over the mirror\'s own element', () => {
    const declared: 'contextSelectors' extends DeclaredKeys<AppComponentSchema> ? true : false = true;
    const selectors: AppComponentSchema['contextSelectors'] = [
      { id: 'pkg', label: 'Package', optionsSource: { endpoint: '/api/v1/packages' } },
    ];
    expect(declared).toBe(true);
    expect(AppMirror.safeParse({ type: 'app', contextSelectors: selectors }).success).toBe(true);
  });
});

describe('spec tombstones surface on the twin as a refusal — the verdict the mirror gives', () => {
  it('App `version` / Dashboard `refreshInterval`: authoring a value is a compile error AND a parse failure', () => {
    // @ts-expect-error — `version` is the spec's `retiredKey()` tombstone.
    const app: AppComponentSchema = { type: 'app', version: '1.0.0' };
    // @ts-expect-error — `refreshInterval` is the #15680 rename's tombstone.
    const dashboard: DashboardComponentSchema = { type: 'dashboard', widgets: [], refreshInterval: 30 };
    expect(AppMirror.safeParse(app).success).toBe(false);
    expect(DashboardMirror.safeParse(dashboard).success).toBe(false);
  });

  it('the controls: the same documents without the tombstone key pass both faces', () => {
    const app: AppComponentSchema = { type: 'app' };
    const dashboard: DashboardComponentSchema = { type: 'dashboard', widgets: [], refreshIntervalSeconds: 30 };
    expect(AppMirror.safeParse(app).success).toBe(true);
    expect(DashboardMirror.safeParse(dashboard).success).toBe(true);
  });

  it('Page `assignedProfiles` (objectui#9409): authoring a value is a compile error AND a parse failure AT the key', () => {
    // The spec's `retiredKey()` tombstone since @objectstack/spec 17.5.0
    // (ADR-0090 D2 deleted the Profile concept). Both faces take it by
    // reference, so the twin's member IS the spec's, and it admits no value.
    const isSpecMember: Equal<PageNodeSchema['assignedProfiles'], Page['assignedProfiles']> = true;
    // The spec's retired-key type: the branded `[REMOVED]` mark at the pinned
    // 17.6.0 and on objectstack `main`, bare `undefined` through 17.5.0
    // (objectui#11330).
    const admitsNoValue: Equal<IsRetiredKeyType<PageNodeSchema['assignedProfiles']>, true> = true;
    // The control for the line above, through the same helper: an admitted
    // spec key on the same twin is NOT a retired-key type.
    const sourceIsLive: Equal<IsRetiredKeyType<PageNodeSchema['source']>, false> = true;
    // The `@ts-expect-error` below stuck only because the key is DECLARED while
    // the index signature would have absorbed an undeclared one as `any`; since
    // objectui#8347 an undeclared key is refused too, so `declared` here is what
    // tells the two apart.
    const declared: 'assignedProfiles' extends DeclaredKeys<PageNodeSchema> ? true : false = true;
    expect([isSpecMember, admitsNoValue, sourceIsLive, declared]).toEqual([true, true, true, true]);

    // @ts-expect-error — `assignedProfiles` is the spec's `retiredKey()` tombstone.
    const page: PageNodeSchema = { type: 'page', assignedProfiles: ['admin'] };
    const verdict = PageMirror.safeParse(page);
    expect(verdict.success).toBe(false);
    // The refusal is this key's, and the only issue: the rest of the document is valid.
    const issues = verdict.success ? [] : verdict.error.issues;
    expect(issues.map((i) => ({ code: i.code, path: i.path }))).toEqual([
      { code: 'invalid_type', path: ['assignedProfiles'] },
    ]);
    expect(issues[0]?.message).toContain('assignedProfiles');

    // A tombstone refuses ANY value, an empty list included: the key is gone,
    // not narrowed.
    // @ts-expect-error — the same tombstone.
    const emptyList: PageNodeSchema = { type: 'page', assignedProfiles: [] };
    const emptyVerdict = PageMirror.safeParse(emptyList);
    expect(emptyVerdict.success ? [] : emptyVerdict.error.issues.map((i) => i.path)).toEqual([['assignedProfiles']]);
  });

  it('the Page control: the same document without `assignedProfiles`, and the admitted spec keys, pass both faces', () => {
    const bare: PageNodeSchema = { type: 'page' };
    // `kind: 'html'`: since `@objectstack/spec` 17.7.0 `requires` is admitted only on
    // the kinds the platform compiles at save (`checkPageRequiresKind`, chained on
    // this mirror by objectui#11717), and an absent `kind` is `full`.
    const admitted: PageNodeSchema = { type: 'page', kind: 'html', source: 'pages/home.tsx', requires: ['crm'] };
    expect(PageMirror.safeParse(bare).success).toBe(true);
    expect(PageMirror.safeParse(admitted).success).toBe(true);
  });
});

describe('the twin-only omissions keep the twin\'s own member, unwidened', () => {
  it('Page `slots` is the hand-written type, not the spec\'s', () => {
    const slotsNotSpec: Equal<PageNodeSchema['slots'], Page['slots']> = false;
    expect(slotsNotSpec).toBe(false);
  });

  it('Dashboard `header` is no longer a twin-only omission: it IS the spec\'s member (objectui#7759)', () => {
    // It was the hand-written restatement until objectui#7759 group A, with
    // `actions[].label` typed `string`. The spec declares the key, so the twin
    // follows it; `dashboard-header-global-filters-spec-7759.test.ts` pins the
    // accept set on both faces.
    const headerIsSpec: Equal<DashboardComponentSchema['header'], Dashboard['header']> = true;
    expect(headerIsSpec).toBe(true);
  });
});
