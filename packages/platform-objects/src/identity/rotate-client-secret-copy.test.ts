// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_oauth_application.rotate_client_secret` — the confirmation and the
 * result dialog say the same thing about the previous secret.
 *
 * The two texts once disagreed: the confirmation said the previous secret
 * "will stop working immediately", the result dialog told the admin to update
 * integrations "before the previous secret's grace period ends". Only the
 * first is true. The route is better-auth's own
 * (`@better-auth/oauth-provider` 1.7.3, `rotateClientSecretEndpoint`): it
 * overwrites the client's single stored `clientSecret`, and
 * `validateClientCredentials` checks a presented secret against that one value.
 * No previous secret is kept, so no grace period exists.
 *
 * The wording IS the contract here — it is what an admin acts on before
 * breaking every integration — so it is pinned in the source and in all four
 * shipped locales. The translated leaves are hand-written: `pnpm i18n:extract`
 * keeps them in merge mode and the source-hash table holds no entry for them
 * (they are real translations, not byte copies), so a stale translation of an
 * edited source is not flagged anywhere else.
 */

import { describe, expect, it } from 'vitest';
import { SysOauthApplication } from './index.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';

const rotate = (SysOauthApplication.actions ?? []).find((a) => a.name === 'rotate_client_secret');
const node = (bundle: any) => bundle?.sys_oauth_application?._actions?.rotate_client_secret;

/** Any promise of a window during which the previous secret still works. */
const GRACE_TERMS: readonly (readonly [string, any, RegExp])[] = [
  ['en', enObjects, /grace|window|expire/i],
  ['zh-CN', zhCNObjects, /宽限|过渡期|有效期/],
  ['ja-JP', jaJPObjects, /猶予|移行期間|有効期限/],
  ['es-ES', esESObjects, /gracia|transición|caduque|expire/i],
];

describe('rotate_client_secret — both texts state the immediate cut-off', () => {
  it('the source confirmation and result dialog both say the previous secret stops at once', () => {
    expect(rotate, 'rotate_client_secret is declared').toBeDefined();
    const confirm = rotate?.description ?? '';
    const result = rotate?.resultDialog?.description ?? '';
    expect(confirm).toMatch(/previous secret will stop working immediately/);
    expect(result).toMatch(/previous secret has already stopped working/);
    for (const [label, text] of [['description', confirm], ['resultDialog.description', result]] as const) {
      expect(text, `${label} promises a grace period the route does not keep`).not.toMatch(/grace|window|expire/i);
    }
  });

  it('the result dialog keeps its shown-once warning, acknowledgement and secret field', () => {
    expect(rotate?.resultDialog?.description).toMatch(/^Save the new secret now — it is shown only once\./);
    expect(rotate?.resultDialog?.acknowledge).toBe('I have updated my integrations');
    expect(rotate?.resultDialog?.fields?.map((f) => [f.path, f.format])).toEqual([['client_secret', 'secret']]);
  });

  it('the English bundle mirrors the source', () => {
    expect(node(enObjects)?.description).toBe(rotate?.description);
    expect(node(enObjects)?.resultDialog?.description).toBe(rotate?.resultDialog?.description);
  });

  it('no locale promises a grace period in either text, and each translates the result dialog', () => {
    for (const [locale, bundle, grace] of GRACE_TERMS) {
      const n = node(bundle);
      expect(n?.description, `${locale} description`).toBeTruthy();
      expect(n?.resultDialog?.description, `${locale} resultDialog.description`).toBeTruthy();
      expect(n.description, `${locale} description promises a grace period`).not.toMatch(grace);
      expect(n.resultDialog.description, `${locale} resultDialog.description promises a grace period`).not.toMatch(grace);
      if (locale !== 'en') {
        expect(n.resultDialog.description, `${locale} resultDialog.description is the English source`)
          .not.toBe(node(enObjects)?.resultDialog?.description);
      }
    }
  });
});
