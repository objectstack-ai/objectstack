import { describe, it, expect } from 'vitest';
import {
  SystemObjectName,
  SystemFieldName,
  StorageNameMapping,
} from './system-names';

// ============================================================================
// SystemObjectName
// ============================================================================

describe('SystemObjectName', () => {
  it('should expose all expected object names with sys_ prefix', () => {
    expect(SystemObjectName.USER).toBe('sys_user');
    expect(SystemObjectName.SESSION).toBe('sys_session');
    expect(SystemObjectName.ACCOUNT).toBe('sys_account');
    expect(SystemObjectName.VERIFICATION).toBe('sys_verification');
    expect(SystemObjectName.ORGANIZATION).toBe('sys_organization');
    expect(SystemObjectName.MEMBER).toBe('sys_member');
    expect(SystemObjectName.INVITATION).toBe('sys_invitation');
    expect(SystemObjectName.TEAM).toBe('sys_team');
    expect(SystemObjectName.TEAM_MEMBER).toBe('sys_team_member');
    expect(SystemObjectName.API_KEY).toBe('sys_api_key');
    expect(SystemObjectName.TWO_FACTOR).toBe('sys_two_factor');
    expect(SystemObjectName.OAUTH_APPLICATION).toBe('sys_oauth_application');
    expect(SystemObjectName.OAUTH_ACCESS_TOKEN).toBe('sys_oauth_access_token');
    expect(SystemObjectName.OAUTH_REFRESH_TOKEN).toBe('sys_oauth_refresh_token');
    expect(SystemObjectName.OAUTH_CONSENT).toBe('sys_oauth_consent');
    expect(SystemObjectName.DEVICE_CODE).toBe('sys_device_code');
    expect(SystemObjectName.JWKS).toBe('sys_jwks');
    expect(SystemObjectName.USER_PREFERENCE).toBe('sys_user_preference');
    expect(SystemObjectName.POSITION).toBe('sys_position');
    expect(SystemObjectName.PERMISSION_SET).toBe('sys_permission_set');
    expect(SystemObjectName.AUDIT_LOG).toBe('sys_audit_log');
    expect(SystemObjectName.METADATA).toBe('sys_metadata');
    expect(SystemObjectName.PRESENCE).toBe('sys_presence');
  });

  it('should be readonly (const assertion)', () => {
    const names: readonly string[] = Object.values(SystemObjectName);
    expect(names).toContain('sys_user');
    expect(names).toContain('sys_session');
    expect(names).toContain('sys_organization');
    expect(names).toContain('sys_team');
    expect(names).toContain('sys_team_member');
    expect(names).toContain('sys_position');
    expect(names).toContain('sys_audit_log');
    expect(names).toContain('sys_presence');
  });

  it('should have all expected keys', () => {
    const keys = Object.keys(SystemObjectName);
    expect(keys).toContain('USER');
    expect(keys).toContain('SESSION');
    expect(keys).toContain('ACCOUNT');
    expect(keys).toContain('VERIFICATION');
    expect(keys).toContain('ORGANIZATION');
    expect(keys).toContain('MEMBER');
    expect(keys).toContain('INVITATION');
    expect(keys).toContain('TEAM');
    expect(keys).toContain('TEAM_MEMBER');
    expect(keys).toContain('API_KEY');
    expect(keys).toContain('TWO_FACTOR');
    expect(keys).toContain('USER_PREFERENCE');
    expect(keys).toContain('POSITION');
    expect(keys).toContain('PERMISSION_SET');
    expect(keys).toContain('AUDIT_LOG');
    expect(keys).toContain('METADATA');
    expect(keys).toContain('PRESENCE');
  });
});

// ============================================================================
// SystemFieldName
// ============================================================================

describe('SystemFieldName', () => {
  it('should expose all expected field names', () => {
    expect(SystemFieldName.ID).toBe('id');
    expect(SystemFieldName.CREATED_AT).toBe('created_at');
    expect(SystemFieldName.CREATED_BY).toBe('created_by');
    expect(SystemFieldName.UPDATED_AT).toBe('updated_at');
    expect(SystemFieldName.UPDATED_BY).toBe('updated_by');
    expect(SystemFieldName.OWNER_ID).toBe('owner_id');
    expect(SystemFieldName.ORGANIZATION_ID).toBe('organization_id');
    expect(SystemFieldName.TENANT_ID).toBe('tenant_id');
    expect(SystemFieldName.USER_ID).toBe('user_id');
    expect(SystemFieldName.DELETED_AT).toBe('deleted_at');
    expect(SystemFieldName.OWNING_BUSINESS_UNIT_ID).toBe('owning_business_unit_id');
  });

  // [#4611 / ADR-0117 D1] The BU ownership stamp's canonical spelling is
  // reserved here BEFORE open-core injects it, so consumers stop inventing
  // `business_unit_id` / `bu_id` / `dept_id` — the same drift that put
  // `tenant_id`/`org_id`/`space` into three hand-copied lists (cloud#982).
  //
  // This table is a NAME registry, not the injected set, so a reserved-but-not-
  // injected entry is a legitimate row (tenant_id / user_id / deleted_at are the
  // precedents). The gate that keeps the classification honest lives in objectql
  // (`system-managed-fields-conformance.test.ts`): it pins the public-form
  // denylist to exactly (actively-injected ∪ documented-reserved), and this name
  // is currently in the RESERVED half.
  it('reserves the ADR-0117 business-unit ownership stamp without claiming injection (#4611)', () => {
    expect(SystemFieldName.OWNING_BUSINESS_UNIT_ID).toBe('owning_business_unit_id');
    // Guard the naming discipline ADR-0117 D10 spells out: the record stamp must
    // NOT be confused with `sys_user.primary_business_unit_id`, which is a USER
    // attribute projected from BU membership — different object, different concept.
    expect(SystemFieldName.OWNING_BUSINESS_UNIT_ID).not.toBe('primary_business_unit_id');
    const names: readonly string[] = Object.values(SystemFieldName);
    expect(names).not.toContain('primary_business_unit_id');
  });

  it('should be readonly (const assertion)', () => {
    const names: readonly string[] = Object.values(SystemFieldName);
    expect(names).toContain('id');
    expect(names).toContain('owner_id');
  });

  // The gap this table carried until #4443: `applySystemFields` injects
  // `organization_id` as THE tenant key and `created_by` / `updated_by` as
  // audit provenance, yet none of the three had a canonical constant — while
  // `tenant_id`, which open-core never injects, was documented as "Tenant
  // isolation key". Consumers hand-copying a system-field list read that as
  // gospel and drifted: cloud#982 found three copies carrying `tenant_id`,
  // `org_id` and `space`, none of which any injection site produces.
  it('names every column the registry actually injects', () => {
    const names: readonly string[] = Object.values(SystemFieldName);
    // Mirrors applySystemFields' injection set (objectql registry). That
    // package's own conformance test enumerates the set from the live code;
    // this one only asserts the protocol table has a spelling for each member.
    for (const injected of [
      'organization_id',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
      'owner_id',
    ]) {
      expect(names, injected).toContain(injected);
    }
  });
});

// ============================================================================
// StorageNameMapping
// ============================================================================

describe('StorageNameMapping', () => {
  describe('resolveTableName', () => {
    it('should return short name when name is not FQN', () => {
      expect(StorageNameMapping.resolveTableName({ name: 'user' })).toBe('user');
    });

    it('should return name as-is (canonical name = table name)', () => {
      expect(StorageNameMapping.resolveTableName({ name: 'account' })).toBe('account');
    });

    it('should keep system table names as-is (single underscore)', () => {
      expect(StorageNameMapping.resolveTableName({ name: 'sys_user' })).toBe('sys_user');
    });

    it('should return ai-prefixed names as-is', () => {
      expect(StorageNameMapping.resolveTableName({ name: 'sys_audit_log' })).toBe('sys_audit_log');
    });
  });
});
