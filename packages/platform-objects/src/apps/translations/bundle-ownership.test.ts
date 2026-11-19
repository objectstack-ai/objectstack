// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Bundle-ownership guard (#2834 ⑤ / ADR-0029 D8): this package's generated
// object-translation bundles must carry ONLY objects this package's extract
// config actually imports. When an object moves to another package (audit,
// realtime, …), its translations move to that package's own bundles — a
// leftover copy here silently DIES on the next `os i18n extract` run, taking
// curated translations with it (the sys_audit_log incident). This test turns
// that silent loss into a red build: an object present in the bundle but not
// in the ownership list below means either (a) the extract config gained an
// object — add it here — or (b) a moved object's keys were left behind —
// migrate them to the owning package's bundles, then regenerate.

import { describe, it, expect } from 'vitest';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { arObjects } from './ar.objects.generated.js';
import { deObjects } from './de.objects.generated.js';
import { frObjects } from './fr.objects.generated.js';
import { koObjects } from './ko.objects.generated.js';
import { ptBRObjects } from './pt-BR.objects.generated.js';
import { ruObjects } from './ru.objects.generated.js';
import { zhHantObjects } from './zh-Hant.objects.generated.js';
import * as identityObjects from '../../identity/index.js';
import * as auditObjects from '../../audit/index.js';
import * as metadataObjects from '../../metadata/index.js';
import * as systemObjects from '../../system/index.js';
import { SysMetadataCommitObject } from '@objectstack/metadata-core';

// Objects the extract config (scripts/i18n-extract.config.ts) imports —
// keep the two lists in sync when adding/moving platform objects.
const OWNED_OBJECTS = new Set([
  // identity
  'sys_user', 'sys_session', 'sys_account', 'sys_verification', 'sys_organization',
  'sys_member', 'sys_invitation', 'sys_team', 'sys_team_member', 'sys_business_unit',
  'sys_business_unit_member', 'sys_api_key', 'sys_two_factor', 'sys_device_code',
  'sys_user_preference', 'sys_personal_view', 'sys_oauth_application', 'sys_oauth_access_token',
  'sys_oauth_refresh_token', 'sys_oauth_consent', 'sys_oauth_resource',
  'sys_oauth_client_resource', 'sys_oauth_client_assertion', 'sys_jwks',
  // identity — external SSO provider (admin-facing, better-auth-managed)
  'sys_sso_provider',
  // identity — stable @better-auth/scim 1.7.x model set + the ObjectStack-owned
  // credential store (#3653; the rc.1-era sys_scim_provider retired under commit 4d25d22d4)
  'sys_scim_connection_binding', 'sys_scim_connection_credential', 'sys_scim_group',
  'sys_scim_group_member', 'sys_scim_identity_tombstone', 'sys_scim_projection_grant',
  'sys_scim_subject', 'sys_scim_user',
  // identity — IdP group → permission set mapping (#30959; SCIM now, SSO group claims later)
  'sys_idp_group_mapping',
  // audit / messaging-adjacent (still owned here)
  'sys_notification', 'sys_attachment', 'sys_email', 'sys_email_template',
  // (sys_saved_report / sys_report_schedule retired with the saved-report stack, #20102)
  'sys_job', 'sys_job_run', 'sys_job_queue', 'sys_import_job',
  // metadata (sys_view_definition retired as inert, ADR-0131 D13)
  'sys_metadata', 'sys_metadata_history', 'sys_metadata_audit', 'sys_metadata_commit',
  // system
  'sys_setting', 'sys_platform_setting', 'sys_secret', 'sys_setting_audit', 'sys_platform_setting_audit', 'sys_migration', 'sys_exchange_rate',
  'sys_work_calendar', 'sys_work_calendar_exception',
]);

describe('objects translation bundle ownership (ADR-0029 D8)', () => {
  it('the en bundle contains no objects owned by other packages', () => {
    const strays = Object.keys(enObjects).filter((o) => !OWNED_OBJECTS.has(o));
    expect(
      strays,
      `bundle carries objects this package's extract config does not own: ${strays.join(', ')} — ` +
        'their curated translations would be silently deleted on the next `os i18n extract`. ' +
        'Migrate them to the owning package (cf. plugin-audit / service-realtime translations) or add them to the extract config + this list.',
    ).toEqual([]);
  });

  it('every owned object is present in the bundle (extract config regression)', () => {
    const missing = [...OWNED_OBJECTS].filter((o) => !(o in enObjects));
    expect(
      missing,
      `objects the extract config should emit are missing from the bundle: ${missing.join(', ')} — was an import dropped from scripts/i18n-extract.config.ts?`,
    ).toEqual([]);
  });
});

/**
 * `sys_metadata_commit` (ADR-0067, the package commit log) was left out of the
 * extract config while its three `sys_metadata*` siblings were in it, so its
 * label reached a zh-CN admin as "Metadata Commit". The extractor fills a new
 * key with the English source; this pins the three hand-translated locales to
 * their own words for the object's label, plural and every field label.
 */
describe('sys_metadata_commit reads in the translated locales', () => {
  const locales = [
    ['zh-CN', zhCNObjects, '元数据提交'],
    ['ja-JP', jaJPObjects, 'メタデータコミット'],
    ['es-ES', esESObjects, 'Confirmación de metadatos'],
  ] as const;
  const en = enObjects.sys_metadata_commit as any;

  for (const [locale, bundle, label] of locales) {
    it(`${locale} carries its own label, plural and field labels`, () => {
      const entry = (bundle as Record<string, any>).sys_metadata_commit;
      expect(entry?.label).toBe(label);
      expect(entry?.pluralLabel).not.toBe(en.pluralLabel);
      // `id` reads "ID" in every locale; every other field label is translated.
      const echoed = Object.keys(en.fields)
        .filter((f) => f !== 'id')
        .filter((f) => entry?.fields?.[f]?.label === undefined || entry.fields[f].label === en.fields[f].label);
      // es-ES "Actor" is the Spanish word too.
      expect(echoed.filter((f) => !(locale === 'es-ES' && f === 'actor'))).toEqual([]);
    });
  }
});

/**
 * Two visible fields of one object under one label are two columns a reader
 * cannot tell apart. The author-time rule `field-label-duplicate` judges app
 * metadata, not these platform objects, so this walks the same comparison over
 * every owned object in every locale bundle here: the label a reader is served
 * is the bundle leaf when there is one, else the authored label, and a field
 * declared `hidden: true` is not compared. Three translated leaves broke it at
 * once (ru `sys_import_job` count vs timestamp, ar `sys_oauth_resource` id vs
 * identifier, fr `sys_user` accountable owner vs manager).
 */
describe('no two visible fields of one platform object share a label in any locale', () => {
  const bundles = {
    '(authored)': {}, en: enObjects, 'zh-CN': zhCNObjects, 'ja-JP': jaJPObjects, 'es-ES': esESObjects,
    ar: arObjects, de: deObjects, fr: frObjects, ko: koObjects, 'pt-BR': ptBRObjects, ru: ruObjects,
    'zh-Hant': zhHantObjects,
  } as Record<string, Record<string, any>>;
  const defs = [identityObjects, auditObjects, metadataObjects, systemObjects, { SysMetadataCommitObject }]
    .flatMap((mod) => Object.values(mod as Record<string, any>))
    .filter((v) => v && typeof v === 'object' && typeof v.name === 'string' && OWNED_OBJECTS.has(v.name) && v.fields);

  it('reads every owned object definition', () => {
    expect(new Set(defs.map((d) => d.name))).toEqual(OWNED_OBJECTS);
  });

  for (const [locale, bundle] of Object.entries(bundles)) {
    it(`${locale}`, () => {
      const clashes: string[] = [];
      for (const def of defs) {
        const leaves = bundle[def.name]?.fields ?? {};
        const byLabel = new Map<string, string[]>();
        for (const [name, field] of Object.entries<any>(def.fields)) {
          if (field.hidden === true) continue;
          const label = typeof leaves[name]?.label === 'string' ? leaves[name].label : field.label;
          if (typeof label !== 'string' || !label.trim()) continue;
          byLabel.set(label.trim(), [...(byLabel.get(label.trim()) ?? []), name]);
        }
        for (const [label, names] of byLabel) {
          if (names.length > 1) clashes.push(`${def.name}: ${names.join(' and ')} both read "${label}"`);
        }
      }
      expect(clashes).toEqual([]);
    });
  }
});
