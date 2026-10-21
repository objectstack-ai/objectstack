// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user.create_user` — the result dialog reads true whether the admin
 * typed the password or left it empty to generate one.
 *
 * The endpoint (`plugin-auth`, `admin-user-endpoints.ts`) returns
 * `temporaryPassword` only when it minted one, and the dialog skips a field
 * whose path is absent from the response. So after a typed password the
 * dialog shows the email alone; a sentence ordering the admin to "copy the
 * temporary password now" beside an "I have saved this password" button then
 * describes a password that was never shown. `ActionSchema.resultDialog` has
 * no per-outcome copy, so one sentence must hold for both outcomes — the
 * hedged shape `set_user_password` in the same file already uses.
 *
 * Pinned in the source and in all four shipped locales: the translated leaves
 * are hand-written and carry no source-hash entry, so a stale translation of
 * an edited source is not flagged anywhere else.
 */

import { describe, expect, it } from 'vitest';
import { SysUser } from './index.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';

const action = (name: string) => (SysUser.actions ?? []).find((a) => a.name === name);
const dialog = (bundle: any, name: string) => bundle?.sys_user?._actions?.[name]?.resultDialog;

const LOCALES: readonly (readonly [string, any])[] = [
  ['en', enObjects],
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
];

describe('create_user — the result dialog holds for a typed and a generated password', () => {
  it('the source sentence is conditional on a password having been generated', () => {
    const rd = action('create_user')?.resultDialog;
    expect(rd, 'create_user declares a resultDialog').toBeDefined();
    expect(rd?.description).toBe(
      'If a temporary password was generated, copy it now — it is shown only once and never stored.',
    );
  });

  it('the button claims no saved password, since a typed one shows none', () => {
    const ack = action('create_user')?.resultDialog?.acknowledge ?? '';
    expect(ack).toBe('Done');
    expect(ack).not.toMatch(/saved|password/i);
  });

  it('the temporary password stays a conditional field beside the email', () => {
    expect(action('create_user')?.resultDialog?.fields?.map((f) => [f.path, f.format])).toEqual([
      ['user.email', 'text'],
      ['user.phoneNumber', 'text'],
      ['temporaryPassword', 'secret'],
    ]);
  });

  it('every locale says the same thing as set_user_password, whose dialog has the same two outcomes', () => {
    for (const [locale, bundle] of LOCALES) {
      const created = dialog(bundle, 'create_user');
      const updated = dialog(bundle, 'set_user_password');
      expect(created?.description, `${locale} create_user description`).toBeTruthy();
      expect(created.description, `${locale} description`).toBe(updated?.description);
      expect(created.acknowledge, `${locale} acknowledge`).toBe(updated?.acknowledge);
    }
  });
});
