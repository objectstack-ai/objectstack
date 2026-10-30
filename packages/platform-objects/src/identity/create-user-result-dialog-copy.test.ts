// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user.create_user` and `set_user_password` — the result dialog says
 * "copy it now" only when there is a temporary password to copy.
 *
 * The endpoint (`plugin-auth`, `admin-user-endpoints.ts`) returns
 * `temporaryPassword` only when it minted one, and the dialog skips a field
 * whose path is absent from the response. `ActionSchema.resultDialog` has no
 * per-outcome copy, so a dialog-level `description` shows on both outcomes:
 * the hedged "If a temporary password was generated, copy it now" sentence
 * sat above a typed password's result, where nothing was generated and
 * nothing could be copied. The instruction now rides the `temporaryPassword`
 * field's own label, which is drawn only beside the password itself.
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

describe('create_user / set_user_password — the copy line shows only beside a generated password', () => {
  for (const name of ['create_user', 'set_user_password']) {
    it(`${name}: no dialog-level description, which would show on both outcomes`, () => {
      const rd = action(name)?.resultDialog;
      expect(rd, `${name} declares a resultDialog`).toBeDefined();
      expect(rd).not.toHaveProperty('description');
    });

    it(`${name}: the copy instruction is the temporaryPassword field's own label`, () => {
      const field = action(name)?.resultDialog?.fields?.find((f) => f.path === 'temporaryPassword');
      expect(field?.format).toBe('secret');
      expect(field?.label).toMatch(/^Temporary password: copy it now/);
    });

    it(`${name}: no other field label asks the admin to copy a password`, () => {
      const others = (action(name)?.resultDialog?.fields ?? []).filter((f) => f.path !== 'temporaryPassword');
      for (const f of others) expect(String(f.label ?? ''), f.path).not.toMatch(/copy|password/i);
    });
  }

  it('the button claims no saved password, since a typed one shows none', () => {
    const ack = action('create_user')?.resultDialog?.acknowledge ?? '';
    expect(ack).toBe('Done');
    expect(ack).not.toMatch(/saved|password/i);
  });

  it('the temporary password stays a conditional field beside the email', () => {
    expect(action('create_user')?.resultDialog?.fields?.map((f) => [f.path, f.format])).toEqual([
      ['user.email', 'text'],
      ['user.phoneNumber', 'text'],
      // #25338: present only when the request granted a permission set.
      ['permissionSet', 'text'],
      ['temporaryPassword', 'secret'],
    ]);
  });

  it('every locale drops the description and translates the field label, the same for both actions', () => {
    const source = action('create_user')?.resultDialog?.fields?.find((f) => f.path === 'temporaryPassword')?.label;
    for (const [locale, bundle] of LOCALES) {
      const created = dialog(bundle, 'create_user');
      const updated = dialog(bundle, 'set_user_password');
      for (const [name, d] of [['create_user', created], ['set_user_password', updated]] as const) {
        expect(d, `${locale} ${name} resultDialog`).toBeDefined();
        expect(d, `${locale} ${name} description`).not.toHaveProperty('description');
      }
      const label = created?.fields?.temporaryPassword;
      expect(label, `${locale} temporaryPassword label`).toBeTruthy();
      expect(updated?.fields?.temporaryPassword, `${locale} same label on both`).toBe(label);
      if (locale === 'en') expect(label).toBe(source);
      else expect(label, `${locale} temporaryPassword label is the English source`).not.toBe(source);
      expect(created.acknowledge, `${locale} acknowledge`).toBe(updated?.acknowledge);
    }
  });
});
