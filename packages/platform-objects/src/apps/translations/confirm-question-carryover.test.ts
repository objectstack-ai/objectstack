// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7309 — translation-carryover guard for the confirm questions moved from
 * `confirmText` to `description` (14 then, 13 the platform still declares).
 *
 * The wording did not change; the KEY did. `os i18n extract` treats a renamed
 * key as a brand-new gap, and this repo's `i18n:extract` script runs with
 * `--fill=default`, which seeds every new leaf from the English source in every
 * locale. So a regeneration that accompanies the move overwrites the curated
 * zh-CN / ja-JP / es-ES strings for the very same sentence with English. They
 * were carried across by hand here.
 *
 * Nothing else would notice. `check:i18n` compares the bundles against a fresh
 * extract, and English-in-a-non-English-locale is perfectly "in sync" — the
 * bundle is exactly what the extractor produces. The loss is invisible to the
 * drift gate BY CONSTRUCTION, on destructive surfaces (`ban_user`,
 * `delete_my_account`, `rotate_client_secret`), in three of the four shipped
 * locales. This is the same trap #7278 hit and pinned for its two actions; the
 * mechanism is identical, so the pin is too.
 */

import { describe, it, expect } from 'vitest';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';

const LOCALES = [
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

/**
 * The (object, action) pairs #7309 converted that this package still
 * declares: 13 of its 14. `sys_organization.change_slug` left the platform
 * object (its door is the cloud orchestrator's, and the composition that
 * mounts it declares it), so its strings left these bundles with it.
 */
const PAIRS: readonly (readonly [string, string])[] = [
  ['sys_user', 'ban_user'],
  ['sys_user', 'delete_my_account'],
  ['sys_user', 'disable_two_factor'],
  ['sys_user', 'generate_backup_codes'],
  ['sys_two_factor', 'disable_two_factor'],
  ['sys_two_factor', 'regenerate_backup_codes'],
  ['sys_account', 'unlink_account'],
  ['sys_team_member', 'remove_team_member'],
  ['sys_oauth_application', 'enable_oauth_application'],
  ['sys_oauth_application', 'disable_oauth_application'],
  ['sys_oauth_application', 'rotate_client_secret'],
  ['sys_oauth_application', 'delete_oauth_application'],
  ['sys_sso_provider', 'delete_sso_provider'],
] as const;

const node = (bundle: any, obj: string, act: string) => bundle?.[obj]?._actions?.[act];

describe('#7309 — the moved confirm questions stay translated', () => {
  it('the English bundle carries each question on `description`, not `confirmText`', () => {
    for (const [obj, act] of PAIRS) {
      const n = node(enObjects, obj, act);
      expect(n, `${obj}.${act} missing from en bundle`).toBeDefined();
      expect(n.confirmText, `en ${obj}.${act}.confirmText`).toBeUndefined();
      expect(n.description, `en ${obj}.${act}.description`).toBeTruthy();
    }
  });

  it('every non-English locale translates it instead of echoing the English source', () => {
    for (const [locale, bundle] of LOCALES) {
      for (const [obj, act] of PAIRS) {
        const translated = node(bundle, obj, act)?.description;
        expect(translated, `${locale} ${obj}.${act}.description missing`).toBeTruthy();
        expect(
          translated,
          `${locale} ${obj}.${act}.description is the untranslated English source — a re-run of `
            + '`pnpm i18n:extract` seeds new keys from English (`--fill=default`), so the curated '
            + 'string was lost. Restore the translation (the wording is unchanged from the old '
            + '`confirmText`).',
        ).not.toBe(node(enObjects, obj, act)?.description);
      }
    }
  });

  it('the pinned set is 13 pairs, and no locale still carries sys_organization.change_slug', () => {
    expect(PAIRS).toHaveLength(13);
    for (const [locale, bundle] of [['en', enObjects] as const, ...LOCALES]) {
      expect(node(bundle, 'sys_organization', 'change_slug'), `${locale} sys_organization.change_slug`).toBeUndefined();
      // The control: the sibling actions of the same object are still there.
      expect(node(bundle, 'sys_organization', 'rename_organization'), `${locale} sys_organization.rename_organization`).toBeDefined();
    }
  });

  it('no locale left the retired `confirmText` behind on these actions', () => {
    for (const [locale, bundle] of LOCALES) {
      for (const [obj, act] of PAIRS) {
        expect(node(bundle, obj, act)?.confirmText, `${locale} ${obj}.${act}.confirmText`).toBeUndefined();
      }
    }
  });

  it('param-LESS actions keep their translated `confirmText` in every locale', () => {
    // The over-application guard, mirrored on the translation side: these have
    // no param dialog, so the confirm is the only dialog and the key is correct.
    for (const [locale, bundle] of [['en', enObjects] as const, ...LOCALES]) {
      for (const [obj, act] of [
        ['sys_organization', 'delete_organization'],
        ['sys_organization', 'leave_organization'],
        ['sys_user', 'impersonate_user'],
      ] as const) {
        expect(node(bundle, obj, act)?.confirmText, `${locale} ${obj}.${act}.confirmText`).toBeTruthy();
      }
    }
  });
});
