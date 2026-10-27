/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Page / App / Dashboard ↔ `@objectstack/spec` drift guard (objectstack#4115).
 *
 * These three renderer nodes extend `BaseSchema`, which is `.passthrough()`,
 * while their spec counterparts are strict. That combination is the objectui
 * equivalent of the objectstack#4120 silent-drop failure: every spec-only key
 * — `branding`, `sharing`, `interfaceConfig`, `source`, `header`,
 * `performance`, the whole `_lock*` package envelope — rode through
 * *completely unvalidated*, so `brading: {…}` was indistinguishable from
 * `branding: {…}` and a spec-authored `kind: 'html'` page could not even
 * express its body (`source` was never declared).
 *
 * The fix is NOT `.strict()` — these are component nodes and the open envelope
 * is deliberate. It is to let the spec's own fields flow in by reference
 * (`SpecXFields = SpecXSchema.omit({…}).partial()`), the pattern
 * `zod/objectql.zod.ts`'s `ListViewSchema` already uses.
 *
 * The derivation picks up new spec fields automatically, but can still break
 * silently in three ways, which these tests catch:
 *
 *   1. The spec grows a field objectui never triaged. Asserted: every spec key
 *      is present in the objectui shape, or envelope-owned by BaseSchema.
 *   2. The spec renames/removes a field objectui deliberately omits and
 *      re-declares locally — the local override would then shadow nothing.
 *      Asserted: every omitted anchor still exists upstream.
 *   3. Someone adds an objectui-local key that should have been a spec field.
 *      Asserted: every objectui-only key is in the sanctioned set below.
 *
 * When one fails, do NOT edit the sets to make it green — decide whether the
 * field belongs upstream in `@objectstack/spec` or is a genuine objectui-only
 * extension, and record the reason.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { RETIRED_KEY_UPGRADE_GUIDE_SENTENCE } from '@objectstack/spec/shared';
import {
  AppSchema as SpecAppSchema,
  DashboardSchema as SpecDashboardSchema,
  PageSchema as SpecPageSchema,
} from '@objectstack/spec/ui';
import { AppComponentSchema as OuiAppSchema } from '../zod/app.zod.js';
import { DashboardComponentSchema as OuiDashboardSchema } from '../zod/complex.zod.js';
import { PageNodeSchema as OuiPageSchema } from '../zod/layout.zod.js';
import { BaseSchema } from '../zod/base.zod.js';

const shapeOf = (s: unknown) => (s as { shape: Record<string, unknown> }).shape;

/** Component-envelope keys owned by BaseSchema — derived, never hand-listed. */
const ENVELOPE = new Set(Object.keys(shapeOf(BaseSchema)));

interface Case {
  spec: unknown;
  oui: unknown;
  /** Spec keys objectui deliberately omits and re-declares locally. */
  omitted: string[];
  /** objectui-only keys, each a conscious local-vs-upstream decision. */
  local: string[];
}

/** The App keys whose spec tombstones aged out at 18.2 (objectstack#25767); the twin's own refusals. */
const AGED_OUT_APP_KEYS = ['version', 'homePageId', 'objects', 'apis', 'sharing', 'embed', 'mobileNavigation', 'aria'] as const;
/** The Dashboard keys of the same cut. */
const AGED_OUT_DASHBOARD_KEYS = ['aria', 'performance'] as const;

const CASES: Record<string, Case> = {
  Page: {
    spec: SpecPageSchema,
    oui: OuiPageSchema,
    // `type` collides semantically (spec = page kind, objectui = component
    // discriminator, kind lives on `pageType`); `regions` is a local fork.
    omitted: ['type', 'regions'],
    // `actions` is the odd one out and is listed HERE deliberately rather than
    // exempted: it is not a local CAPABILITY, it is a local REFUSAL. The spec
    // does not declare it, no renderer reads it, and objectui#7926 (maintainer
    // ruling 2026-09-09, batch #107 item 2, option A) ruled that `page` grows no
    // reader — so the key is DECLARED as an ADR-0049 tombstone precisely so an
    // authored value is refused by name instead of being kept in silence by
    // `BaseSchema`'s `.passthrough()`. That makes it an objectui-only key on
    // this shape, and this ledger is the right place for the decision to be
    // visible. `../__tests__/page-actions-refusal-7926.test.ts` owns the
    // behaviour; this row owns the fact that the key exists at all.
    //
    // `breadcrumbs` is the SECOND of that kind and joins for the same reason,
    // under the same gate (objectui#8871, ADR-0049 enforce-or-remove). Its
    // authority is not objectui#7926's ruling — that one covers `actions` only —
    // but the standing enforce-or-remove discipline this package applies to this
    // face. Same shape, same helper, same reason to be visible here rather than
    // exempted: a local REFUSAL, not a local capability.
    // `../__tests__/page-breadcrumbs-refusal-8871.test.ts` owns the behaviour.
    //
    // `maxWidth` and `padding` are the THIRD and FOURTH (objectui#11318, same
    // gate, same helper). They are `container` members the layout guide taught
    // on this node, and that census is the one this note asked for: no other
    // `type: 'page'` object in the tree carried either key, and the node's open
    // envelope stays pinned below, so the answer was two more named refusals and
    // not a strict node. `../__tests__/page-width-padding-refusal-11318.test.ts`
    // owns the behaviour.
    //
    // ⚠️ These four are the ONLY members of this row that are refusals. Adding a
    // fifth means another undeclared key was found surviving `.passthrough()` on
    // this node — which is the census that decides between one more named refusal
    // and finally making the node strict. ⛔ Do not grow this list reflexively.
    local: ['title', 'pageType', 'body', 'children', 'actions', 'breadcrumbs', 'maxWidth', 'padding'],
  },
  App: {
    spec: SpecAppSchema,
    oui: OuiAppSchema,
    omitted: ['navigation', 'areas', 'contextSelectors'],
    // `actions` (objectui#7469), `logo` (objectui#10827) and `favicon`
    // (objectui#10842) are local REFUSALS, not capabilities: each is declared
    // only so an authored value is refused by name instead of kept in silence
    // by `.passthrough()`. `logo` and `favicon` were second spellings of the
    // spec's `branding.logo` and `branding.favicon`. `mobileNavMode`
    // (objectui#11363) is a refusal of the same kind: the spec refuses it, and
    // the mode is read only from `AppSchemaRenderer`'s prop or an
    // `app-schema-renderer` node, never from this document.
    // The eight `AGED_OUT_APP_KEYS` are refusals of the same kind, since spec
    // 18.2 (objectstack#25767): each was a spec tombstone the twin inherited
    // by reference through 18.1, aged out of `AppSchema` one major on, and is
    // declared here only so an authored value is refused by name instead of
    // kept in silence. Pinned below.
    local: ['title', 'logo', 'favicon', 'mobileNavMode', 'layout', 'menu', 'actions', ...AGED_OUT_APP_KEYS],
  },
  Dashboard: {
    spec: SpecDashboardSchema,
    oui: OuiDashboardSchema,
    // `dateRange` left this list with objectui#10334: it now flows in by reference.
    omitted: ['widgets', 'globalFilters'],
    // Refusals, not capabilities — the aged-out spec tombstones of
    // objectstack#25767, declared so an authored value is refused by name
    // (`AGED_OUT_DASHBOARD_KEYS`, pinned below).
    local: [...AGED_OUT_DASHBOARD_KEYS],
  },
};

/**
 * Pins one aged-out key on a twin: declared, unwritable (`invalid_type` at its
 * own path, the console's refusal naming the key and the guide), and refused
 * by the spec as an unknown key at the container's root — the control that
 * the twin's refusal is not standing in for a spec member.
 */
const expectAgedOutRefusal = (
  oui: z.ZodType, spec: z.ZodType, container: string, key: string, legal: Record<string, unknown>, specLegal: Record<string, unknown>,
) => {
  expect(Object.keys(shapeOf(oui)), `'${key}' is no longer declared — an authored value would be KEPT in silence`).toContain(key);
  const twin = oui.safeParse({ ...legal, [key]: 'x' });
  expect(twin.success, `'${key}' is accepted again`).toBe(false);
  const issue = twin.success ? undefined : twin.error.issues.find((i) => i.path.join('.') === key);
  expect(issue, `no issue at path '${key}'`).toBeTruthy();
  expect(issue!.code).toBe('invalid_type');
  expect(issue!.message).toContain(`Unrecognized key(s) on this ${container}: \`${key}\``);
  // The guide sentence is the spec's own: `zod/tombstone.zod.ts` imports it from
  // `@objectstack/spec/shared` (a declared TEXT exception of the mirrors' import
  // boundary, imported-defaults-8317), so the twin's refusal carries the spec's words.
  expect(issue!.message).toContain(RETIRED_KEY_UPGRADE_GUIDE_SENTENCE);
  expect(RETIRED_KEY_UPGRADE_GUIDE_SENTENCE).toContain('https://objectstack.ai/docs/protocol-upgrade');
  expect(issue!.message).toContain('objectstack#25767');
  const specResult = spec.safeParse({ ...specLegal, [key]: 'x' });
  expect(specResult.success, `the spec accepts '${key}' again — the twin's refusal would then hide a live member`).toBe(false);
  const root = specResult.success ? '' : specResult.error.issues.filter((i) => i.path.length === 0).map((i) => i.message).join('\n');
  expect(root).toMatch(new RegExp(`Unrecognized key\\(s\\)[^\\n]*\`${key}\``));
  expect(root).toContain('https://objectstack.ai/docs/protocol-upgrade');
};

describe.each(Object.keys(CASES))('%s spec parity (objectstack#4115 drift guard)', (name) => {
  const { spec, oui, omitted, local } = CASES[name];
  const specShape = shapeOf(spec);
  const ouiShape = shapeOf(oui);
  const ouiKeys = new Set(Object.keys(ouiShape));

  it('covers every spec field — the spec cannot grow a key objectui ignores', () => {
    const missing = Object.keys(specShape).filter((k) => !ouiKeys.has(k) && !ENVELOPE.has(k));
    expect(missing).toEqual([]);
  });

  it('keeps the upstream anchors it deliberately omits and re-declares', () => {
    // A rename upstream would orphan the local override, silently reopening
    // the very drift this derivation closed.
    for (const key of omitted) {
      expect(specShape, `spec no longer declares '${key}'`).toHaveProperty(key);
    }
  });

  it('declares no objectui-only key outside the sanctioned set', () => {
    const rogue = [...ouiKeys].filter(
      (k) => !(k in specShape) && !ENVELOPE.has(k) && !local.includes(k),
    );
    expect(rogue).toEqual([]);
  });
});

describe('spec-only keys are now VALIDATED, not passed through (objectstack#4115)', () => {
  it('Page declares the five keys that used to ride through unchecked', () => {
    const keys = Object.keys(shapeOf(OuiPageSchema));
    for (const key of ['interfaceConfig', 'kind', 'slots', 'source', 'requires']) {
      expect(keys, `'${key}' is still undeclared`).toContain(key);
    }
  });

  it('Page can finally express a source-authored page (kind html/react)', () => {
    // Before the derivation `source` was not declared at all, so `kind: 'html'`
    // was unauthorable — the body had nowhere to live.
    const ok = OuiPageSchema.safeParse({ type: 'page', kind: 'html', source: '<h1>hi</h1>' });
    expect(ok.success).toBe(true);
    expect(ok.success && (ok.data as { source?: string }).source).toBe('<h1>hi</h1>');
  });

  it('Page rejects a bad `kind` instead of waving it through', () => {
    expect(OuiPageSchema.safeParse({ type: 'page', kind: 'nonsense' }).success).toBe(false);
  });

  it('App declares the package-lock and access keys that used to ride through', () => {
    const keys = Object.keys(shapeOf(OuiAppSchema));
    // `homePageId` was in this list until spec 17.0.0 retired it, and
    // `sharing`, `embed`, `objects` and `apis` until spec 18.2 aged their
    // tombstones out: all four are refusals now, pinned in the leg below, and
    // listing one here would read as "still authorable".
    for (const key of ['branding', 'requiredPermissions', '_packageId']) {
      expect(keys, `'${key}' is still undeclared`).toContain(key);
    }
  });

  it.each(AGED_OUT_APP_KEYS)('App `%s`: a spec tombstone that aged out at 18.2 is the twin\'s OWN refusal now, not a silent keep (objectstack#25767)', (key) => {
    // objectstack#4667 / #4709 retired `homePageId` at spec 17.0.0 (an ID
    // cross-reference with no referential integrity: a dangling id fell back
    // to the first nav item in silence; the landing page is the first
    // reachable nav item by `order`, the root landing follows `isDefault`),
    // and the 2026-06 liveness audit retired the other seven with it. All
    // eight were `retiredKey()` tombstones through 18.1, flowing into this
    // twin by reference, so the twin REFUSED each at its own path.
    //
    // At 18.2 the tombstones aged out (objectstack#25767, ADR-0087): the
    // spec's strict `AppSchema` refuses the key as an unknown one at the app's
    // own path, naming it and the protocol upgrade guide — that is where an
    // author is told at every door that parses with the spec (the client
    // validator, the server's 422). The twin inherits nothing under the name,
    // and is `.passthrough()`, so without an arm of its own it would KEEP the
    // value in silence: a refusal the console gave for two majors would
    // vanish. So each key is declared here as the console's own refusal
    // (`agedOutSpecKeyRefusal`, `zod/tombstone.zod.ts`), the TS twin is
    // `?: never` (`../app.ts`), and this pin holds both the twin's verdict and
    // the spec's — a twin whose refusal outlived a key the spec re-admitted
    // goes red on the control.
    expectAgedOutRefusal(OuiAppSchema, SpecAppSchema, 'app', key, { type: 'app', name: 'app_x' }, { name: 'app_x', label: 'App X' });
    expect(OuiAppSchema.safeParse({ type: 'app', name: 'app_x' }).success).toBe(true);
    expect(SpecAppSchema.safeParse({ name: 'app_x', label: 'App X' }).success).toBe(true);
  });

  it('App validates branding instead of accepting any shape', () => {
    expect(OuiAppSchema.safeParse({ type: 'app', branding: { primaryColor: '#fff' } }).success).toBe(true);
    // A wrong-typed branding used to be indistinguishable from a correct one.
    expect(OuiAppSchema.safeParse({ type: 'app', branding: 'blue' }).success).toBe(false);
  });

  it('Dashboard declares header/refreshIntervalSeconds/protection', () => {
    const keys = Object.keys(shapeOf(OuiDashboardSchema));
    // `refreshIntervalSeconds` is the post-rename spelling (objectui#7783); the
    // spec still carries `refreshInterval` as a `retiredKey` tombstone, so
    // asserting the OLD name here would pass on the tombstone and prove nothing.
    // `performance` left this list at spec 18.2: it was a tombstone through
    // 18.1, aged out of `DashboardSchema` one major on (objectstack#25767),
    // and is the twin's own refusal now — pinned in the leg below.
    for (const key of ['header', 'refreshIntervalSeconds', 'protection']) {
      expect(keys, `'${key}' is still undeclared`).toContain(key);
    }
  });

  it.each(AGED_OUT_DASHBOARD_KEYS)('Dashboard `%s`: a spec tombstone that aged out at 18.2 is the twin\'s OWN refusal now, not a silent keep (objectstack#25767)', (key) => {
    // The #3896 audit close-out retired both at spec 17.0.0 (no dashboard
    // renderer applied `aria`; nothing read `performance`); the twin refused
    // each by reference through 18.1. The rule and the posture are the App
    // leg's above; `dashboard-aria-retired-contract-twins.test.ts` pins the
    // `aria` face pair in detail.
    expectAgedOutRefusal(
      OuiDashboardSchema, SpecDashboardSchema, 'dashboard', key,
      { type: 'dashboard', widgets: [] }, { name: 'ops', label: 'Ops', widgets: [] },
    );
    expect(OuiDashboardSchema.safeParse({ type: 'dashboard', widgets: [] }).success).toBe(true);
    expect(SpecDashboardSchema.safeParse({ name: 'ops', label: 'Ops', widgets: [] }).success).toBe(true);
  });

  it('Dashboard validates header instead of accepting any shape', () => {
    expect(
      OuiDashboardSchema.safeParse({ type: 'dashboard', widgets: [], header: { showTitle: true } }).success,
    ).toBe(true);
    expect(
      OuiDashboardSchema.safeParse({ type: 'dashboard', widgets: [], header: 'yes' }).success,
    ).toBe(false);
  });
});

describe('the derivation stays permissive where objectui needs it', () => {
  it('no spec field became required — stored payloads keep validating', () => {
    // `.partial()` on the imported shape is what guarantees this; without it a
    // spec field gaining `required` would invalidate every stored node.
    expect(OuiPageSchema.safeParse({ type: 'page' }).success).toBe(true);
    expect(OuiAppSchema.safeParse({ type: 'app' }).success).toBe(true);
    expect(OuiDashboardSchema.safeParse({ type: 'dashboard', widgets: [] }).success).toBe(true);
  });

  it('the local vocabulary still parses', () => {
    expect(
      OuiPageSchema.safeParse({ type: 'page', pageType: 'record', title: 'T', regions: [] }).success,
    ).toBe(true);
    expect(
      OuiAppSchema.safeParse({ type: 'app', title: 'T', layout: 'sidebar' }).success,
    ).toBe(true);
  });

  it('the component envelope still passes unknown renderer props through', () => {
    // BaseSchema is deliberately open for type-specific extensions; the fix
    // narrows what the SPEC owns, it does not close the node.
    const r = OuiPageSchema.safeParse({ type: 'page', someRendererProp: 42 });
    expect(r.success).toBe(true);
  });
});
