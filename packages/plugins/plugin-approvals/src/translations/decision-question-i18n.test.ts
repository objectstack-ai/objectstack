// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Translation-carryover guard for the two decision questions (#7278).
//
// `approval_reject` / `approval_recall` used to ask their confirm question via
// `confirmText`; the maintainer's 2026-08-10 ruling moved it to the action's
// top-level `description` so one decision opens one dialog instead of two.
// The wording did not change — but the KEY did, and `os i18n extract` treats a
// renamed key as a brand-new gap: with `--fill=default` it seeds the new leaf
// from the English source in every locale, so the curated zh-CN / ja-JP / es-ES
// strings for the very same sentence were overwritten with English by the
// regeneration that accompanied the move. They were carried across by hand.
//
// Nothing else would notice. `check:i18n` compares the bundles against a fresh
// merge-mode extract, and English-in-a-non-English-locale is perfectly "in
// sync" — the bundle is what the extractor produces. So the loss is invisible
// to the drift gate by construction, on the most irreversible surface in the
// product, in three of the four shipped locales.
//
// This turns that into a red test: each locale's decision question must be
// translated, not the English literal.

import { describe, it, expect } from 'vitest';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { enObjects } from './en.objects.generated.js';

const LOCALES = [
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

const ACTIONS = ['approval_reject', 'approval_recall'] as const;

const question = (bundle: any, action: string): string | undefined =>
  bundle?.sys_approval_request?._actions?.[action]?.description;

describe('sys_approval_request decision questions stay translated (#7278)', () => {
  it('the English bundle carries the question on `description`, not `confirmText`', () => {
    for (const action of ACTIONS) {
      const node = (enObjects as any).sys_approval_request._actions[action];
      expect(node.confirmText, `${action}.confirmText`).toBeUndefined();
      expect(node.description, `${action}.description`).toBeTruthy();
    }
    expect(question(enObjects, 'approval_reject')).toContain('final for every approver');
    expect(question(enObjects, 'approval_recall')).toContain('can no longer act on it');
  });

  it('every non-English locale translates it instead of echoing the English source', () => {
    for (const [locale, bundle] of LOCALES) {
      for (const action of ACTIONS) {
        const translated = question(bundle, action);
        expect(translated, `${locale} ${action}.description missing`).toBeTruthy();
        expect(
          translated,
          `${locale} ${action}.description is the untranslated English source — a re-run of `
            + '`os i18n extract` seeds new keys from English, so the curated string was lost. '
            + 'Restore the translation (the wording is unchanged from the old `confirmText`).',
        ).not.toBe(question(enObjects, action));
      }
    }
  });

  it('no locale left the retired `confirmText` behind on these two actions', () => {
    for (const [locale, bundle] of LOCALES) {
      for (const action of ACTIONS) {
        const node = (bundle as any).sys_approval_request._actions[action];
        expect(node.confirmText, `${locale} ${action}.confirmText`).toBeUndefined();
      }
    }
  });
});
