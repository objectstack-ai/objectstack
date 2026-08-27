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

// Objects the extract config (scripts/i18n-extract.config.ts) imports —
// keep the two lists in sync when adding/moving platform objects.
const OWNED_OBJECTS = new Set([
  // identity
  'sys_user', 'sys_session', 'sys_account', 'sys_verification', 'sys_organization',
  'sys_member', 'sys_invitation', 'sys_team', 'sys_team_member', 'sys_business_unit',
  'sys_business_unit_member', 'sys_api_key', 'sys_two_factor', 'sys_device_code',
  'sys_user_preference', 'sys_oauth_application', 'sys_oauth_access_token',
  'sys_oauth_refresh_token', 'sys_oauth_consent', 'sys_oauth_resource',
  'sys_oauth_client_resource', 'sys_oauth_client_assertion', 'sys_jwks',
  // identity — external SSO / SCIM providers (admin-facing, better-auth-managed)
  'sys_sso_provider', 'sys_scim_provider',
  // identity — stable @better-auth/scim 1.7.x model set + the ObjectStack-owned
  // credential store (#3653; sys_scim_provider above retires under #11757)
  'sys_scim_connection_binding', 'sys_scim_connection_credential', 'sys_scim_group',
  'sys_scim_group_member', 'sys_scim_identity_tombstone', 'sys_scim_projection_grant',
  'sys_scim_subject', 'sys_scim_user',
  // audit / messaging-adjacent (still owned here)
  'sys_notification', 'sys_attachment', 'sys_email', 'sys_email_template',
  'sys_saved_report', 'sys_report_schedule', 'sys_job', 'sys_job_run', 'sys_job_queue',
  'sys_import_job',
  // metadata
  'sys_metadata', 'sys_metadata_history', 'sys_view_definition', 'sys_metadata_audit',
  // system
  'sys_setting', 'sys_secret', 'sys_setting_audit', 'sys_migration',
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
