// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8535] `sys_capability.active` claims nothing about authorization — on ANY
// shipped surface, in ANY locale.
//
// The defect this pins: `deactivate_capability`'s confirmation dialog told the
// admin "Grants and resource requirements that reference it stop resolving until
// re-activated." Nothing enforced that. `PermissionEvaluator.getSystemPermissions()`
// unions `permissionSets[].systemPermissions` — plain strings — and a resource's
// `requiredPermissions` is matched against that string set; neither loads a
// `sys_capability` row. The table's only two production readers are seeders, which
// WRITE `active: true` on insert and never read it back. So an admin was told a
// withdrawal took effect and it silently did not — the escalation is what they
// believed they had prevented.
//
// The maintainer ruled (2026-08-13) that ENFORCEMENT is not the answer: putting the
// registry on the authorization hot path is an architectural change that needs its
// own designed card. The claim is withdrawn instead.
//
// ── Why this file is a SWEEP and not a pin ──────────────────────────────────
// Asserting the new wording would be the weak test: it passes the moment the new
// sentence exists, on the one surface it names, and says nothing about the five
// other places the old sentence was ALSO shipped. This walks every string on every
// surface — the object definition and all four locale bundles — and applies two
// independent checks to each:
//
//   NEGATIVE  the withdrawn claim's own words, per locale, appear nowhere. Catches
//             a surface that was missed, and a surface added later that copies the
//             old text back in.
//   POSITIVE  every locale's dialog and field help actually STATE the non-effect.
//             Catches the cheap non-fix — deleting the false sentence and leaving
//             an admin who remembers it to infer the rest — which the negative
//             check alone would pass.
//
// The negative check cannot catch an arbitrary paraphrase of the falsehood in a
// language it does not read; that is why the positive check carries equal weight.
//
// If capability lifecycle ever becomes genuinely enforceable (its own card, per the
// ruling), this file is what must change with it — the wording is only true while
// `active` is unread.

import { describe, it, expect } from 'vitest';
import { SysCapability } from './sys-capability.object.js';
import { enObjects } from '../translations/en.objects.generated.js';
import { esESObjects } from '../translations/es-ES.objects.generated.js';
import { jaJPObjects } from '../translations/ja-JP.objects.generated.js';
import { zhCNObjects } from '../translations/zh-CN.objects.generated.js';

/** Every `[path, value]` string reachable in a plain-data tree. */
function walkStrings(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => walkStrings(v, `${path}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      walkStrings(v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

/**
 * The withdrawn claim, in the exact words each locale shipped it in (taken
 * verbatim from the pre-fix bundles). A surface carrying any of these is
 * re-asserting that deactivation withdraws access.
 */
const WITHDRAWN_CLAIM: Record<string, RegExp[]> = {
  en: [/stop resolving/i, /until re-activated/i],
  'es-ES': [/dejar[áa]n de resolverse/i, /hasta que se reactive/i],
  'ja-JP': [/解決されなくなります/],
  'zh-CN': [/无法解析/],
};

/** The honest statement each locale must actually make (not merely omit the lie). */
const NON_EFFECT_MARKER: Record<string, RegExp> = {
  en: /authorization is not affected|no authorization effect/i,
  'es-ES': /no se ve afectada|no tiene ning[úu]n efecto sobre la autorizaci[óo]n/i,
  'ja-JP': /認可には(影響しません|一切影響しません)/,
  'zh-CN': /授权(不受影响|没有任何影响)/,
};

const BUNDLES: Array<[string, Record<string, any>]> = [
  ['en', enObjects],
  ['es-ES', esESObjects],
  ['ja-JP', jaJPObjects],
  ['zh-CN', zhCNObjects],
];

describe('[#8535] sys_capability deactivation claims no authorization effect', () => {
  // ── NEGATIVE sweep ────────────────────────────────────────────────────────
  it('the object definition carries the withdrawn claim on no string at all', () => {
    const offenders = walkStrings(SysCapability)
      .filter(([, v]) => WITHDRAWN_CLAIM.en.some((re) => re.test(v)))
      .map(([p, v]) => `${p}: ${v}`);
    expect(
      offenders,
      'a string on SysCapability states that deactivation stops grants/requirements resolving. ' +
        'Nothing enforces that (getSystemPermissions unions permission-set strings; no row is ever ' +
        'read). Either withdraw the claim, or land enforcement as its own card first.',
    ).toEqual([]);
  });

  it.each(BUNDLES)('the %s bundle carries the withdrawn claim on no string at all', (locale, bundle) => {
    const patterns = WITHDRAWN_CLAIM[locale];
    expect(patterns, `no withdrawn-claim patterns registered for locale ${locale}`).toBeDefined();
    const offenders = walkStrings(bundle.sys_capability, `${locale}.sys_capability`)
      .filter(([, v]) => patterns.some((re) => re.test(v)))
      .map(([p, v]) => `${p}: ${v}`);
    expect(
      offenders,
      `the ${locale} bundle still ships the withdrawn claim. Editing the source object does NOT ` +
        'rewrite shipped bundles — `check-i18n-bundles.mjs --write` reports "regenerated" and leaves ' +
        'changed leaf values untouched, so this locale must be corrected by hand.',
    ).toEqual([]);
  });

  // ── POSITIVE sweep ────────────────────────────────────────────────────────
  it('the source dialog states the non-effect outright', () => {
    const action: any = (SysCapability.actions ?? []).find((a: any) => a.name === 'deactivate_capability');
    expect(action, 'deactivate_capability action exists').toBeDefined();
    expect(
      action.confirmText,
      'the dialog must SAY authorization is unaffected, not merely stop lying about it — an admin ' +
        'who remembers the old wording has to be told it was wrong.',
    ).toMatch(NON_EFFECT_MARKER.en);
  });

  it.each(BUNDLES)('the %s dialog states the non-effect outright', (locale, bundle) => {
    const confirmText = bundle.sys_capability?._actions?.deactivate_capability?.confirmText;
    expect(confirmText, `${locale} bundle has a deactivate_capability confirmText`).toBeTruthy();
    expect(confirmText).toMatch(NON_EFFECT_MARKER[locale]);
  });

  it('the active field documents its own inertness at the source', () => {
    const active: any = (SysCapability.fields as any).active;
    expect(active, 'active field exists').toBeDefined();
    expect(
      active.description,
      'the field carried NO description at all, which is how the dialog became the only place its ' +
        'meaning was stated — and that statement was false.',
    ).toMatch(NON_EFFECT_MARKER.en);
  });

  it.each(BUNDLES)('the %s bundle translates the active field help', (locale, bundle) => {
    const help = bundle.sys_capability?.fields?.active?.help;
    expect(help, `${locale} bundle has help for the active field`).toBeTruthy();
    expect(
      help,
      `${locale} still carries the English fill for active.help — 'os i18n extract' seeds a NEW key ` +
        'with the default-locale string, and leaving it is how a locale ships an untranslated surface.',
    ).toMatch(NON_EFFECT_MARKER[locale]);
  });

  // ── Demotion from prominence (the other half of the ruling) ────────────────
  it('active is not a highlight field', () => {
    expect(
      SysCapability.highlightFields ?? [],
      'record-header prominence beside scope/managed_by is itself a claim that the flag belongs to ' +
        'the authorization posture — a truthful dialog under a first-class field still says it matters.',
    ).not.toContain('active');
  });

  it.each(['platform', 'org'])('the %s list view does not surface active as a column', (view) => {
    const columns: string[] = ((SysCapability.listViews as any)[view]?.columns ?? []) as string[];
    expect(columns.length, `${view} view has columns`).toBeGreaterThan(0);
    expect(columns).not.toContain('active');
  });

  it('the full-catalogue view DOES still surface active', () => {
    // Deliberately asserted: hiding a flag the product still lets an admin set is
    // the opposite error, not a stronger fix. A catalogue attribute stays visible
    // in the catalogue view.
    expect((SysCapability.listViews as any).all_capabilities?.columns ?? []).toContain('active');
  });
});
