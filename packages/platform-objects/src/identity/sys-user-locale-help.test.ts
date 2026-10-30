// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user.locale` help says what the setting does: it sets the language the
 * user sees the interface in, as well as their notifications (#27869).
 *
 * The console applies the signed-in user's `sys_user.locale` to the whole UI
 * (`useUserLocale`, and the globe switcher writes the same column), while the
 * help said "Preferred language for this user's notifications", so a user
 * reading it did not expect the interface to switch. Pinned in the source and
 * in every shipped pack, because a translated leaf is hand-written and a stale
 * one is not flagged anywhere else.
 */

import { describe, expect, it } from 'vitest';
import { SysUser } from './sys-user.object.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';

const help = (bundle: any): string => bundle?.sys_user?.fields?.locale?.help ?? '';

/** Per pack: the word for the interface, and the old notifications-only opening that must be gone. */
const PACKS: readonly (readonly [string, any, RegExp, RegExp])[] = [
  ['en', enObjects, /interface/, /^Preferred language for this user's notifications/],
  ['zh-CN', zhCNObjects, /界面/, /^该用户接收通知时使用的首选语言/],
  ['ja-JP', jaJPObjects, /画面/, /^このユーザーへの通知に使用する優先言語/],
  ['es-ES', esESObjects, /interfaz/, /^Idioma preferido para las notificaciones/],
];

describe('sys_user.locale help — it sets the interface language (#27869)', () => {
  it('the source description names the interface', () => {
    const d = String(SysUser.fields?.locale?.description ?? '');
    expect(d).toMatch(/^The language this user sees the interface in and receives notifications in/);
  });

  for (const [locale, bundle, names, old] of PACKS) {
    it(`${locale} pack says it sets the interface language`, () => {
      expect(help(bundle)).toMatch(names);
      expect(help(bundle)).not.toMatch(old);
    });
  }
});
