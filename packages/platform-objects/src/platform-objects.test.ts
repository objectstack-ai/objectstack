// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  SysAccount,
  SysApiKey,
  SysBusinessUnit,
  SysBusinessUnitMember,
  SysDeviceCode,
  SysInvitation,
  SysJwks,
  SysMember,
  SysOauthAccessToken,
  SysOauthApplication,
  SysOauthRefreshToken,
  SysOrganization,
  SysScimProvider,
  SysSession,
  SysSsoProvider,
  SysTeam,
  SysTeamMember,
  SysTwoFactor,
  SysUser,
  SysUserPreference,
  SysVerification,
} from './identity/index.js';
// RBAC objects (SysRole/SysPermissionSet/… + defaultPermissionSets) moved to
// @objectstack/plugin-security and the sharing objects to
// @objectstack/plugin-sharing per ADR-0029 K2 — see their packages' tests.
// sys_audit_log / sys_activity / sys_comment / sys_attachment moved to
// @objectstack/plugin-audit and sys_presence to @objectstack/service-realtime
// per ADR-0029 K2 — see their packages' tests.
// sys_webhook moved to @objectstack/plugin-webhooks per ADR-0029 (K2.a).
import {
  SysMetadata,
  SysMetadataHistoryObject,
} from './metadata/index.js';
import { SysSecret, SysSetting } from './system/index.js';
import { ACCOUNT_APP, SETUP_APP, SETUP_NAV_CONTRIBUTIONS, STUDIO_APP } from './apps/index.js';
import { AppSchema } from '@objectstack/spec/ui';

const systemObjects = [
  ['SysUser', SysUser, 'sys_user'],
  ['SysSession', SysSession, 'sys_session'],
  ['SysAccount', SysAccount, 'sys_account'],
  ['SysVerification', SysVerification, 'sys_verification'],
  ['SysOrganization', SysOrganization, 'sys_organization'],
  ['SysMember', SysMember, 'sys_member'],
  ['SysInvitation', SysInvitation, 'sys_invitation'],
  ['SysTeam', SysTeam, 'sys_team'],
  ['SysTeamMember', SysTeamMember, 'sys_team_member'],
  ['SysApiKey', SysApiKey, 'sys_api_key'],
  ['SysTwoFactor', SysTwoFactor, 'sys_two_factor'],
  ['SysUserPreference', SysUserPreference, 'sys_user_preference'],
  ['SysMetadata', SysMetadata, 'sys_metadata'],
  ['SysMetadataHistoryObject', SysMetadataHistoryObject, 'sys_metadata_history'],
  ['SysSetting', SysSetting, 'sys_setting'],
] as const;

describe('@objectstack/platform-objects', () => {
  it.each(systemObjects)('%s uses a canonical sys_ short name', (_exportName, object, name) => {
    expect(object.name).toBe(name);
  });

  it.each(systemObjects)('%s is marked as a system object', (_exportName, object) => {
    expect(object.isSystem).toBe(true);
  });

  it.each(systemObjects)('%s does not use deprecated storage identity fields', (_exportName, object) => {
    expect((object as any).namespace).toBeUndefined();
    expect((object as any).tableName).toBeUndefined();
  });

  describe('no shipped object declares a `password`-typed field (ADR-0100)', () => {
    // The generic read path masks `password` fields to SECRET_MASK; better-auth
    // objects are exempted so login reads see the stored value
    // (collectMaskedReadFields). That exemption is a safety net, not a crutch:
    // no identity object today even declares a `password`-typed field —
    // sys_account.password is a hashed `text` column. If anyone retypes it to
    // `password`, masking would apply through the better-auth adapter and silently
    // break login; this pin fails first so that change is a deliberate decision.
    it.each(systemObjects)('%s has no field of type `password`', (_exportName, object) => {
      const fields = ((object as any).fields ?? {}) as Record<string, { type?: string }>;
      const passwordFields = Object.entries(fields)
        .filter(([, def]) => def?.type === 'password')
        .map(([name]) => name);
      expect(passwordFields).toEqual([]);
    });

    it('sys_account.password is a hashed `text` column, not a `password` field', () => {
      expect((SysAccount as any).fields?.password?.type).toBe('text');
    });
  });

  describe('secure-by-default posture (ADR-0066 ④)', () => {
    // Raw secret / live-credential stores are opted OUT of the wildcard `'*'`
    // grant: only an explicit per-object grant or the posture-gated superuser
    // bypass (viewAllRecords/modifyAllRecords) reaches them. These assertions
    // PIN the rollout — dropping the flag from any of these objects silently
    // re-exposes signing keys / reset tokens / bearer credentials to every
    // authenticated member, so a removal must fail here first (ADR-0078:
    // no silent regression to the inert/exposed state).
    const privateObjects = [
      ['SysSecret', SysSecret],               // encrypted settings/datasource secrets
      ['SysJwks', SysJwks],                   // JWT signing private keys
      ['SysVerification', SysVerification],   // password-reset / verify tokens
      ['SysOauthAccessToken', SysOauthAccessToken],   // live bearer tokens
      ['SysOauthRefreshToken', SysOauthRefreshToken], // live refresh tokens
      ['SysDeviceCode', SysDeviceCode],       // pending device-grant codes
    ] as const;

    it.each(privateObjects)('%s declares access.default = private', (_exportName, object) => {
      expect((object as any).access?.default).toBe('private');
    });

    it('SysScimProvider is capability-gated like its sibling sys_sso_provider', () => {
      // Admin config with an embedded live credential (scim_token) — the D3
      // capability gate (not the private posture) is the sso/scim pattern.
      expect((SysScimProvider as any).requiredPermissions).toEqual(['manage_platform_settings']);
    });

    it('member self-service objects deliberately stay on the public posture', () => {
      // Account app ("My Sessions" / "My API Keys" / "My Apps") and the 2FA
      // "My Enrollment" view read these via the generic data layer with a
      // MEMBER context — flipping them private would break self-service.
      // Row scoping (owner/tenant RLS + _self carve-outs) is their guard.
      for (const object of [SysSession, SysApiKey, SysOauthApplication, SysTwoFactor]) {
        expect((object as any).access?.default).not.toBe('private');
      }
    });
  });

  describe('sysadmin row actions', () => {
    // Setup-App admins must be able to drive the access-control lifecycle
    // without dropping to SQL. These assertions lock in the high-traffic
    // affordances (activate/deactivate/clone for RBAC objects; unlink
    // for identity links) so they cannot silently regress.
    it('SysAccount exposes an unlink-account row action wired to better-auth', () => {
      const unlink = (SysAccount.actions ?? []).find((a) => a.name === 'unlink_account');
      expect(unlink).toBeDefined();
      expect(unlink?.target).toBe('/api/v1/auth/unlink-account');
      const paramNames = (unlink?.params ?? []).map((p) => p.name);
      expect(paramNames).toEqual(['providerId', 'accountId']);
    });

    it('SysOauthApplication routes all mutations through better-auth, not the data layer', () => {
      const actions = SysOauthApplication.actions ?? [];
      const names = actions.map((a) => a.name).sort();
      expect(names).toEqual([
        'create_oauth_application',
        'delete_oauth_application',
        'disable_oauth_application',
        'enable_oauth_application',
        'rotate_client_secret',
      ]);

      const create = actions.find((a) => a.name === 'create_oauth_application');
      expect(create?.target).toBe('/api/v1/auth/sys-oauth-application/register');
      expect(create?.method).toBe('POST');
      expect(create?.mode).toBe('create');
      expect(create?.resultDialog?.fields?.map((f) => f.path)).toEqual([
        'client.client_id',
        'client.client_secret',
      ]);

      const rotate = actions.find((a) => a.name === 'rotate_client_secret');
      const del = actions.find((a) => a.name === 'delete_oauth_application');
      const disable = actions.find((a) => a.name === 'disable_oauth_application');
      const enable = actions.find((a) => a.name === 'enable_oauth_application');

      expect(rotate?.target).toBe('/api/v1/auth/oauth2/client/rotate-secret');
      expect(rotate?.method).toBe('POST');
      expect((rotate?.params ?? []).map((p) => p.field)).toEqual(['client_id']);

      expect(del?.target).toBe('/api/v1/auth/oauth2/delete-client');
      expect(del?.method).toBe('POST');
      expect(del?.mode).toBe('delete');

      // Enable/disable both hit the ObjectStack-added bridge route on
      // /api/v1/auth (since better-auth 1.6.11's stock admin endpoint
      // does not accept `disabled` in its update schema). They differ
      // only in the static `disabled` body field and the visibility
      // predicate, so exactly one is active at any time.
      expect(disable?.target).toBe('/api/v1/auth/admin/oauth2/toggle-disabled');
      expect(disable?.bodyExtra).toEqual({ disabled: true });
      expect((disable?.visible as any)?.source).toBe('(!record.disabled) && features.oidcProvider != false');
      expect(enable?.target).toBe('/api/v1/auth/admin/oauth2/toggle-disabled');
      expect(enable?.bodyExtra).toEqual({ disabled: false });
      expect((enable?.visible as any)?.source).toBe('(record.disabled) && features.oidcProvider != false');

      // Generic CRUD must NOT expose mutating methods — all writes are
      // reserved for better-auth wrappers above so OAuth-specific
      // invariants (token revocation on delete, consent invalidation,
      // disabled checks at runtime) always run.
      expect(SysOauthApplication.enable?.apiMethods).not.toContain('delete');
      expect(SysOauthApplication.enable?.apiMethods).not.toContain('update');
      expect(SysOauthApplication.enable?.apiMethods).not.toContain('create');
    });

    it('SysSsoProvider request_domain_verification resultDialog paths address the inner data payload (no `data.` prefix)', () => {
      // The console action runtime unwraps the `{ success, data }` envelope
      // before resolving resultDialog field paths (same as create_user,
      // two-factor and OAuth). These paths must therefore be relative to the
      // INNER data — a `data.` prefix double-nests and blanks the dialog.
      // Regression guard for the "temporary password / DNS record shows empty"
      // class of bug.
      const action = (SysSsoProvider.actions ?? []).find(
        (a) => a.target === '/api/v1/auth/admin/sso/request-domain-verification',
      );
      expect(action?.resultDialog?.fields?.map((f) => f.path)).toEqual([
        'dnsRecordType',
        'dnsRecordName',
        'dnsRecordValue',
      ]);
    });

    it('SysUser admin actions surface on the record-detail header, not just the row menu', () => {
      // An admin viewing an open user record must be able to run the same
      // account-management actions available from the Users list row menu —
      // otherwise they have to navigate back to the list. Each admin action is
      // therefore declared on BOTH `list_item` and `record_header` (the detail
      // header overflows extras into the ⋯ "More" menu). `record_header` is the
      // only detail-surface location objectui consumes (it does NOT read
      // `record_more`), so these must use `record_header` specifically.
      const adminActions = ['ban_user', 'unban_user', 'unlock_user', 'set_user_password', 'set_user_role', 'impersonate_user'];
      for (const name of adminActions) {
        const a = (SysUser.actions ?? []).find((x) => x.name === name);
        expect(a, `${name} action must exist`).toBeTruthy();
        expect(a?.locations, `${name} locations`).toContain('list_item');
        expect(a?.locations, `${name} must also surface on the detail header`).toContain('record_header');
      }
    });
  });

  describe('data portability whitelist (#3025)', () => {
    it('sys_business_unit allows import/export so the org tree can be batch-synced', () => {
      // The Business Units list exposes Import/Export buttons and the object's
      // schema (external_ref, effective_from/to) is designed for HRIS batch
      // sync. The REST data plane gates these routes on `enable.apiMethods`
      // (ADR-0049), so both verbs must be present or the buttons 405 with
      // OBJECT_API_METHOD_NOT_ALLOWED. Regression guard for #3025.
      expect(SysBusinessUnit.enable?.apiMethods).toContain('import');
      expect(SysBusinessUnit.enable?.apiMethods).toContain('export');
      // The five CRUD verbs it already granted must remain — import writes
      // reuse the create/update affordances.
      for (const verb of ['get', 'list', 'create', 'update', 'delete'] as const) {
        expect(SysBusinessUnit.enable?.apiMethods).toContain(verb);
      }
    });

    it('sys_business_unit_member allows import/export and keeps CRUD (#3391 P0)', () => {
      // HRIS org-tree sync imports TWO tables together — the units (above) AND
      // their memberships. The sibling membership table carries the same kind
      // of restrictive whitelist, so it needs import/export too or the
      // membership import path 405s (OBJECT_API_METHOD_NOT_ALLOWED). #3391's P0
      // checklist pairs both tables; this is the half #3392 did not cover.
      const methods = SysBusinessUnitMember.enable?.apiMethods ?? [];
      expect(methods).toContain('import');
      expect(methods).toContain('export');
      // CRUD must remain — import writes reuse create/update; the membership
      // grid depends on the rest.
      for (const verb of ['get', 'list', 'create', 'update', 'delete'] as const) {
        expect(methods).toContain(verb);
      }
      // Transitional: #3391 P2 derives import/export (import ⊆ create/update,
      // export ⊆ list) and reclaims both objects' explicit entries together.
      // Reconcile-safe: import/export are not generic write verbs, so
      // reconcileManagedApiMethods (managedBy:'platform') never strips them —
      // this static whitelist IS what apiAccessDenialFromEnable enforces.
    });
  });

  describe('SETUP_APP (ADR-0029 D7 shell)', () => {
    it('parses cleanly through AppSchema', () => {
      expect(() => AppSchema.parse(SETUP_APP)).not.toThrow();
    });

    it('is a shell of group anchors with no enumerated objects', () => {
      const nav = SETUP_APP.navigation ?? [];
      expect(nav.length).toBeGreaterThan(0);
      for (const item of nav) {
        expect(item.type).toBe('group');
        // Shell groups carry no children — entries come from contributions.
        expect((item as { children?: unknown[] }).children).toEqual([]);
      }
    });

    it('keeps the group_integrations anchor (filled by plugin-webhooks contribution)', () => {
      const group = SETUP_APP.navigation?.find((n) => n.id === 'group_integrations');
      expect(group).toBeDefined();
      expect(group?.type).toBe('group');
      // The webhooks entries are no longer static here — plugin-webhooks
      // contributes them into this slot (ADR-0029 D7 / K2.a).
      expect((group as { children?: unknown[] }).children).toEqual([]);
    });
  });

  describe('platform app protection (ADR-0010 §3.7)', () => {
    // All three platform apps are core UI shipped by this package: a
    // tenant overlay that breaks Setup/Studio locks admins/implementers
    // out of the repair surface, and Account is every user's only
    // self-service security surface. The loader translates `protection`
    // into the `_lock` envelope; clients (e.g. objectui's
    // isNavigationSyncableApp) rely on `_lock` to skip automatic
    // navigation writes into these apps.
    it.each([
      ['SETUP_APP', SETUP_APP],
      ['STUDIO_APP', STUDIO_APP],
      ['ACCOUNT_APP', ACCOUNT_APP],
    ])('%s declares a full lock', (_name, app) => {
      expect(app.protection?.lock).toBe('full');
      expect(() => AppSchema.parse(app)).not.toThrow();
    });
  });

  describe('SETUP_NAV_CONTRIBUTIONS (ADR-0029 D7)', () => {
    const shellGroupIds = new Set(
      (SETUP_APP.navigation ?? []).map((n) => n.id),
    );

    it('all target the setup app and an existing shell group', () => {
      expect(SETUP_NAV_CONTRIBUTIONS.length).toBeGreaterThan(0);
      for (const c of SETUP_NAV_CONTRIBUTIONS) {
        expect(c.app).toBe('setup');
        expect(c.group).toBeDefined();
        expect(shellGroupIds.has(c.group!)).toBe(true);
        expect(Array.isArray(c.items)).toBe(true);
        expect(c.items.length).toBeGreaterThan(0);
      }
    });

    it('does not contribute slots owned by capability plugins', () => {
      // group_integrations → @objectstack/plugin-webhooks (K2.a)
      // group_approvals    → @objectstack/plugin-approvals (K2.b)
      for (const ownedSlot of ['group_integrations', 'group_approvals']) {
        const contrib = SETUP_NAV_CONTRIBUTIONS.find((c) => c.group === ownedSlot);
        expect(contrib).toBeUndefined();
      }
    });
  });
});

// #2874 P2a — behavior-equivalence lock for the requiresFeature migration.
// Every hand-written `visible: 'features.*'` gate was replaced by the
// declarative `requiresFeature` sugar; these rows pin the LOWERED predicate
// to the exact CEL string that was previously hand-written, so the migration
// is provably behavior-neutral. (transfer_ownership composes a residual row
// predicate with the gate — parenthesized but operand/order-identical to the
// old `record.role != 'owner' && features.organization != false`.)
describe('feature-gate lowering matrix (#2874)', () => {
  const ORG = 'features.organization != false';
  const MULTI_ORG = 'features.multiOrgEnabled != false';

  const rows: Array<[string, { actions?: readonly { name?: string; visible?: unknown; params?: readonly unknown[] }[] }, string, string]> = [
    ['SysOrganization', SysOrganization, 'create_organization', MULTI_ORG],
    ['SysOrganization', SysOrganization, 'update_organization', MULTI_ORG],
    ['SysOrganization', SysOrganization, 'delete_organization', MULTI_ORG],
    ['SysOrganization', SysOrganization, 'set_active_organization', MULTI_ORG],
    ['SysOrganization', SysOrganization, 'leave_organization', MULTI_ORG],
    ['SysOrganization', SysOrganization, 'change_slug', MULTI_ORG],
    ['SysUser', SysUser, 'invite_user', ORG],
    ['SysUser', SysUser, 'create_user', 'features.admin == true'],
    ['SysMember', SysMember, 'add_member', ORG],
    ['SysMember', SysMember, 'update_member_role', ORG],
    ['SysMember', SysMember, 'remove_member', ORG],
    ['SysMember', SysMember, 'transfer_ownership', `(record.role != 'owner') && ${ORG}`],
    ['SysInvitation', SysInvitation, 'invite_user', ORG],
    ['SysInvitation', SysInvitation, 'cancel_invitation', ORG],
    ['SysInvitation', SysInvitation, 'resend_invitation', ORG],
    ['SysTeam', SysTeam, 'create_team', ORG],
    ['SysTeam', SysTeam, 'update_team', ORG],
    ['SysTeam', SysTeam, 'remove_team', ORG],
    ['SysTeamMember', SysTeamMember, 'add_team_member', ORG],
    ['SysTeamMember', SysTeamMember, 'remove_team_member', ORG],
    // #2874 P2b — audit gates: capability-dependent actions that previously
    // shipped UNGATED (rendered even with the backing plugin off, then 404'd).
    ['SysUser', SysUser, 'ban_user', 'features.admin == true'],
    ['SysUser', SysUser, 'unban_user', 'features.admin == true'],
    ['SysUser', SysUser, 'unlock_user', 'features.admin == true'],
    ['SysUser', SysUser, 'set_user_password', 'features.admin == true'],
    ['SysUser', SysUser, 'set_user_role', 'features.admin == true'],
    ['SysUser', SysUser, 'impersonate_user', 'features.admin == true'],
    ['SysUser', SysUser, 'enable_two_factor', '(record.id == ctx.user.id && record.two_factor_enabled != true) && features.twoFactor == true'],
    ['SysUser', SysUser, 'disable_two_factor', '(record.id == ctx.user.id && record.two_factor_enabled == true) && features.twoFactor == true'],
    ['SysUser', SysUser, 'generate_backup_codes', '(record.id == ctx.user.id && record.two_factor_enabled == true) && features.twoFactor == true'],
    ['SysTwoFactor', SysTwoFactor, 'enable_two_factor', 'features.twoFactor == true'],
    ['SysTwoFactor', SysTwoFactor, 'disable_two_factor', 'features.twoFactor == true'],
    ['SysTwoFactor', SysTwoFactor, 'regenerate_backup_codes', 'features.twoFactor == true'],
    ['SysOauthApplication', SysOauthApplication, 'create_oauth_application', 'features.oidcProvider != false'],
    ['SysOauthApplication', SysOauthApplication, 'delete_oauth_application', 'features.oidcProvider != false'],
    ['SysOauthApplication', SysOauthApplication, 'disable_oauth_application', '(!record.disabled) && features.oidcProvider != false'],
    ['SysOauthApplication', SysOauthApplication, 'enable_oauth_application', '(record.disabled) && features.oidcProvider != false'],
    ['SysOauthApplication', SysOauthApplication, 'rotate_client_secret', 'features.oidcProvider != false'],
  ];

  it.each(rows)('%s.%s#%s lowers to the previous hand-written predicate', (_export, object, actionName, expected) => {
    const action = (object.actions ?? []).find((a) => a.name === actionName);
    expect(action, `${actionName} exists`).toBeDefined();
    expect((action?.visible as { source?: string })?.source).toBe(expected);
  });

  it('SysUser.create_user#phoneNumber param lowers to the previous hand-written predicate', () => {
    const create = (SysUser.actions ?? []).find((a) => a.name === 'create_user');
    const phone = (create?.params ?? []).find((p) => (p as { name?: string }).name === 'phoneNumber');
    expect(phone).toBeDefined();
    expect(((phone as { visible?: { source?: string } }).visible)?.source).toBe('features.phoneNumber == true');
  });

  it('the requiresFeature sugar never survives into parsed objects', () => {
    for (const [, object] of systemObjects) {
      for (const action of object.actions ?? []) {
        expect(action).not.toHaveProperty('requiresFeature');
        for (const param of (action as { params?: readonly unknown[] }).params ?? []) {
          expect(param).not.toHaveProperty('requiresFeature');
        }
      }
    }
  });
});
