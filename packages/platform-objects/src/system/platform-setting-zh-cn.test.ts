// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The settings global rung's two objects read in Chinese under zh-CN.
 *
 * `sys_platform_setting` (the stored global value) and
 * `sys_platform_setting_audit` (its trail) are the objects a global-scope
 * `config_change` row on Setup's 审计日志 names, and the trail is listed on
 * the same screen. Both were missing from this package's extract config, so no
 * bundle carried them in any locale and the screen read
 * `Platform Setting Audit Entry` in a Chinese console. Judged on what the
 * platform SERVES (`SetupAppTranslations`, after the source-hash fallback),
 * not on the generated file alone.
 */

import { describe, it, expect } from 'vitest';
import { SetupAppTranslations } from '../apps/translations/setup.translation.js';
import { SysPlatformSetting } from './sys-platform-setting.object.js';
import { SysPlatformSettingAudit } from './sys-platform-setting-audit.object.js';

const CJK = /[一-鿿]/;
/** Leaves this bundle already keeps as the bare initialism, like `sys_setting_audit`. */
const ECHOES = new Set(['ID', 'UI', 'API']);

type ObjectEntry = {
  label?: string;
  pluralLabel?: string;
  fields?: Record<string, { label?: string; options?: Record<string, string> }>;
};

const served = (SetupAppTranslations['zh-CN'] as { objects?: Record<string, ObjectEntry> }).objects ?? {};

const chinese = (text: string | undefined) => !!text && (CJK.test(text) || ECHOES.has(text));

describe('zh-CN — the settings global rung on the audit screens', () => {
  for (const object of [SysPlatformSetting, SysPlatformSettingAudit] as any[]) {
    describe(object.name, () => {
      const entry = served[object.name];

      it('the object is named in Chinese', () => {
        expect(entry?.label, `${object.name}.label`).toMatch(CJK);
        expect(entry?.pluralLabel, `${object.name}.pluralLabel`).toMatch(CJK);
      });

      it('every declared field, and every option, is named in Chinese', () => {
        const untranslated: string[] = [];
        for (const [name, field] of Object.entries<any>(object.fields)) {
          const leaf = entry?.fields?.[name];
          if (!chinese(leaf?.label)) untranslated.push(`${name}.label = ${leaf?.label}`);
          for (const option of field.options ?? []) {
            const text = leaf?.options?.[option.value];
            if (!chinese(text)) untranslated.push(`${name}.options.${option.value} = ${text}`);
          }
        }
        expect(untranslated).toEqual([]);
      });
    });
  }
});
