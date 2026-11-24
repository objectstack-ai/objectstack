// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Pays the first load of the egress module at collection, not inside a clocked test.
import '@objectstack/core/egress';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { authIdentityObjects } from './manifest.js';
import {
  createObjectQLAdapter,
  createObjectQLAdapterFactory,
  withSystemContext,
  withValidationErrorMapping,
  AUTH_MODEL_TO_PROTOCOL,
  resolveProtocolName,
} from './objectql-adapter';
import { isAPIError } from 'better-auth/api';
import {
  AUTH_USER_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_ACCOUNT_CONFIG,
  AUTH_VERIFICATION_CONFIG,
  AUTH_ORGANIZATION_SCHEMA,
  AUTH_MEMBER_SCHEMA,
  AUTH_INVITATION_SCHEMA,
  AUTH_TEAM_SCHEMA,
  AUTH_TEAM_MEMBER_SCHEMA,
  AUTH_TWO_FACTOR_SCHEMA,
  AUTH_ORG_SESSION_FIELDS,
  buildOrganizationPluginSchema,
  buildTwoFactorPluginSchema,
} from './auth-schema-config';
import { SystemObjectName } from '@objectstack/spec/system';
import type { IDataEngine } from '@objectstack/core';
import { sso } from '@better-auth/sso';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { organization } from 'better-auth/plugins/organization';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

describe('AUTH_MODEL_TO_PROTOCOL mapping', () => {
  it('should map all four core better-auth models to sys_ protocol names', () => {
    expect(AUTH_MODEL_TO_PROTOCOL.user).toBe('sys_user');
    expect(AUTH_MODEL_TO_PROTOCOL.session).toBe('sys_session');
    expect(AUTH_MODEL_TO_PROTOCOL.account).toBe('sys_account');
    expect(AUTH_MODEL_TO_PROTOCOL.verification).toBe('sys_verification');
  });

  it('should align with SystemObjectName constants', () => {
    expect(AUTH_MODEL_TO_PROTOCOL.user).toBe(SystemObjectName.USER);
    expect(AUTH_MODEL_TO_PROTOCOL.session).toBe(SystemObjectName.SESSION);
    expect(AUTH_MODEL_TO_PROTOCOL.account).toBe(SystemObjectName.ACCOUNT);
    expect(AUTH_MODEL_TO_PROTOCOL.verification).toBe(SystemObjectName.VERIFICATION);
  });
});

describe('resolveProtocolName', () => {
  it('should resolve core models to sys_ prefixed names', () => {
    expect(resolveProtocolName('user')).toBe('sys_user');
    expect(resolveProtocolName('session')).toBe('sys_session');
    expect(resolveProtocolName('account')).toBe('sys_account');
    expect(resolveProtocolName('verification')).toBe('sys_verification');
  });

  it('should fall back to original name for unknown models', () => {
    expect(resolveProtocolName('organization')).toBe('organization');
    expect(resolveProtocolName('custom_model')).toBe('custom_model');
  });
});

describe('AUTH_*_CONFIG schema mappings', () => {
  it('should define correct modelName for all core models', () => {
    expect(AUTH_USER_CONFIG.modelName).toBe('sys_user');
    expect(AUTH_SESSION_CONFIG.modelName).toBe('sys_session');
    expect(AUTH_ACCOUNT_CONFIG.modelName).toBe('sys_account');
    expect(AUTH_VERIFICATION_CONFIG.modelName).toBe('sys_verification');
  });

  it('should map user camelCase fields to snake_case', () => {
    expect(AUTH_USER_CONFIG.fields).toEqual({
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  });

  it('should map session camelCase fields to snake_case', () => {
    expect(AUTH_SESSION_CONFIG.fields).toEqual({
      userId: 'user_id',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
    });
  });

  // Lookups key on (providerId, accountId), so a missing mapping for either
  // reads as "no such account" on every sign-in. The id field's NAME
  // flip-flopped mid pre-release — `1.7.0-rc.2` called it
  // `providerAccountId`, stable 1.7 calls it `accountId` again (#3002) —
  // which is why it is pinned here.
  //
  // [#17440] `issuer` is deliberately ABSENT: 1.7.3 removed the column and the
  // key it served. `toEqual` (not `objectContaining`) is what makes that
  // absence an assertion — a stray mapping for a column better-auth no longer
  // declares would fail here rather than sit inert.
  it('should map account camelCase fields to snake_case', () => {
    expect(AUTH_ACCOUNT_CONFIG.fields).toEqual({
      userId: 'user_id',
      providerId: 'provider_id',
      accountId: 'account_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  });

  it('should map verification camelCase fields to snake_case', () => {
    expect(AUTH_VERIFICATION_CONFIG.fields).toEqual({
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  });
});

describe('AUTH_*_SCHEMA plugin table mappings', () => {
  it('should define organization model mapping', () => {
    expect(AUTH_ORGANIZATION_SCHEMA.modelName).toBe('sys_organization');
    expect(AUTH_ORGANIZATION_SCHEMA.fields).toEqual({
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  });

  it('should define member model mapping', () => {
    expect(AUTH_MEMBER_SCHEMA.modelName).toBe('sys_member');
    expect(AUTH_MEMBER_SCHEMA.fields).toEqual({
      organizationId: 'organization_id',
      userId: 'user_id',
      createdAt: 'created_at',
    });
  });

  it('should define invitation model mapping', () => {
    expect(AUTH_INVITATION_SCHEMA.modelName).toBe('sys_invitation');
    expect(AUTH_INVITATION_SCHEMA.fields).toEqual({
      organizationId: 'organization_id',
      inviterId: 'inviter_id',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      teamId: 'team_id',
    });
  });

  it('should define team model mapping', () => {
    expect(AUTH_TEAM_SCHEMA.modelName).toBe('sys_team');
    expect(AUTH_TEAM_SCHEMA.fields).toEqual({
      organizationId: 'organization_id',
      // 1.7.0-rc.1's seat counter — unmapped, better-auth wrote a camelCase
      // `memberCount` column and every org create 500'd (#3624).
      memberCount: 'member_count',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  });

  it('should define team member model mapping', () => {
    expect(AUTH_TEAM_MEMBER_SCHEMA.modelName).toBe('sys_team_member');
    expect(AUTH_TEAM_MEMBER_SCHEMA.fields).toEqual({
      teamId: 'team_id',
      userId: 'user_id',
      // Derived uniqueness digest, same 1.7.0-rc.1 addition (#3624).
      membershipKey: 'membership_key',
      createdAt: 'created_at',
    });
  });

  it('should define two-factor model mapping', () => {
    expect(AUTH_TWO_FACTOR_SCHEMA.modelName).toBe('sys_two_factor');
    expect(AUTH_TWO_FACTOR_SCHEMA.fields).toEqual({
      backupCodes: 'backup_codes',
      userId: 'user_id',
      // 1.7's 2FA lockout pair — same unprovisioned-column class as #3624,
      // on the wrong-code path.
      failedVerificationCount: 'failed_verification_count',
      lockedUntil: 'locked_until',
    });
  });

  it('should define org session additional fields', () => {
    expect(AUTH_ORG_SESSION_FIELDS).toEqual({
      activeOrganizationId: 'active_organization_id',
      activeTeamId: 'active_team_id',
    });
  });
});

describe('buildOrganizationPluginSchema', () => {
  it('should compose all org plugin table schemas', () => {
    const schema = buildOrganizationPluginSchema();
    expect(schema.organization).toBe(AUTH_ORGANIZATION_SCHEMA);
    expect(schema.member).toBe(AUTH_MEMBER_SCHEMA);
    expect(schema.invitation).toBe(AUTH_INVITATION_SCHEMA);
    expect(schema.team).toBe(AUTH_TEAM_SCHEMA);
    expect(schema.teamMember).toBe(AUTH_TEAM_MEMBER_SCHEMA);
    expect(schema.session.fields).toBe(AUTH_ORG_SESSION_FIELDS);
  });
});

describe('buildTwoFactorPluginSchema', () => {
  it('should compose two-factor model + user field schema', () => {
    const schema = buildTwoFactorPluginSchema();
    expect(schema.twoFactor).toBe(AUTH_TWO_FACTOR_SCHEMA);
    expect(schema.user.fields).toEqual({
      twoFactorEnabled: 'two_factor_enabled',
    });
  });
});

describe('createObjectQLAdapterFactory', () => {
  it('should return a function (adapter factory)', () => {
    const mockEngine = {
      insert: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as IDataEngine;

    const factory = createObjectQLAdapterFactory(mockEngine);
    expect(typeof factory).toBe('function');
  });
});

describe('createObjectQLAdapter – legacy model name mapping', () => {
  let mockEngine: IDataEngine;

  beforeEach(() => {
    mockEngine = {
      insert: vi.fn().mockResolvedValue({ id: '1' }),
      findOne: vi.fn().mockResolvedValue({ id: '1' }),
      find: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as IDataEngine;
  });

  it('create: should call dataEngine.insert with sys_ protocol name', async () => {
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.create({ model: 'user', data: { email: 'a@b.com' } });
    // #3164 — adapter writes run as system so the #2948 readonly strip doesn't
    // drop better-auth's own writes to readonly identity columns.
    expect(mockEngine.insert).toHaveBeenCalledWith('sys_user', { email: 'a@b.com' }, { context: { isSystem: true } });
  });

  it('findOne: should call dataEngine.findOne with sys_ protocol name', async () => {
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.findOne({
      model: 'session',
      where: [{ field: 'token', value: 'abc', operator: 'eq', connector: 'AND' }],
    });
    expect(mockEngine.findOne).toHaveBeenCalledWith('sys_session', expect.objectContaining({
      where: { token: 'abc' },
    }));
  });

  it('findMany: should call dataEngine.find with sys_ protocol name', async () => {
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.findMany({ model: 'account', limit: 10 });
    expect(mockEngine.find).toHaveBeenCalledWith('sys_account', expect.objectContaining({
      limit: 10,
    }));
  });

  it('count: should call dataEngine.count with sys_ protocol name', async () => {
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.count({ model: 'verification' });
    expect(mockEngine.count).toHaveBeenCalledWith('sys_verification', expect.anything());
  });

  it('update: should call dataEngine with sys_ protocol name', async () => {
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.update({
      model: 'user',
      where: [{ field: 'id', value: '1', operator: 'eq', connector: 'AND' }],
      update: { name: 'New' },
    });
    expect(mockEngine.findOne).toHaveBeenCalledWith('sys_user', expect.anything());
    // #3164 — the update carries system context (readonly identity writes survive).
    expect(mockEngine.update).toHaveBeenCalledWith('sys_user', expect.objectContaining({ name: 'New', id: '1' }), { context: { isSystem: true } });
  });

  it('delete: should call dataEngine with sys_ protocol name', async () => {
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.delete({
      model: 'session',
      where: [{ field: 'id', value: '1', operator: 'eq', connector: 'AND' }],
    });
    expect(mockEngine.findOne).toHaveBeenCalledWith('sys_session', expect.anything());
    expect(mockEngine.delete).toHaveBeenCalledWith('sys_session', expect.anything());
  });

  it('should pass through unknown model names unchanged', async () => {
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.create({ model: 'organization', data: { name: 'Acme' } });
    expect(mockEngine.insert).toHaveBeenCalledWith('organization', { name: 'Acme' }, { context: { isSystem: true } });
  });
});

describe('createObjectQLAdapterFactory – adapter-layer plugin bridging (@better-auth/sso)', () => {
  // The auth manager passes the sso plugin no `schema` option, so its
  // `ssoProvider` table + camelCase fields are bridged at the adapter layer
  // instead. (Not because the plugin "exposes no `schema` option" — that was
  // true of 1.6.20 and expired with the pin: measured 2026-08-19, the installed
  // `@better-auth/sso@1.7.1` accepts `schema.ssoProvider.{modelName,fields,
  // additionalFields}`. #8224.) Pass the plugin so
  // better-auth's wrapper recognises the model (it validates against the
  // merged schema before delegating to our adapter methods).
  const makeAdapter = (findOneRow: any = { id: '1', provider_id: 'okta', oidc_config: '{"clientId":"x"}', domain: 'acme.com' }) => {
    const engine = {
      insert: vi.fn().mockImplementation((_m: string, d: any) => Promise.resolve({ id: '1', ...d })),
      findOne: vi.fn().mockResolvedValue(findOneRow),
      find: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as IDataEngine;
    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({ plugins: [sso()] } as any);
    return { engine, adapter };
  };

  it('resolveProtocolName bridges ssoProvider -> sys_sso_provider', () => {
    expect(resolveProtocolName('ssoProvider')).toBe('sys_sso_provider');
    expect(AUTH_MODEL_TO_PROTOCOL.ssoProvider).toBe('sys_sso_provider');
  });

  it('maps the ssoProvider model + camelCase fields to sys_sso_provider snake columns on insert', async () => {
    const { engine, adapter } = makeAdapter();
    await adapter.create({ model: 'ssoProvider', data: { providerId: 'okta', oidcConfig: '{"clientId":"x"}', domain: 'acme.com' } });
    const [tbl, payload] = (engine.insert as any).mock.calls[0];
    expect(tbl).toBe('sys_sso_provider');
    expect(payload).toMatchObject({ provider_id: 'okta', oidc_config: '{"clientId":"x"}', domain: 'acme.com' });
    expect(payload).not.toHaveProperty('oidcConfig');
  });

  it('maps snake columns back to camelCase on read', async () => {
    const { adapter } = makeAdapter();
    const row: any = await adapter.findOne({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: 'okta', operator: 'eq', connector: 'AND' }],
    });
    // The blob also carries `allowIdpInitiated`, written from the provider's
    // `allow_idp_initiated` column on every read (`sso-sign-in-options.ts`);
    // this row has none, so it reads off.
    expect(row).toMatchObject({ providerId: 'okta', oidcConfig: '{"clientId":"x","allowIdpInitiated":false}' });
    expect(row).not.toHaveProperty('oidc_config');
  });
});

describe('withSystemContext – system-scoped reads AND writes', () => {
  let mockEngine: IDataEngine;

  beforeEach(() => {
    mockEngine = {
      insert: vi.fn().mockResolvedValue({ id: '1' }),
      findOne: vi.fn().mockResolvedValue({ id: '1' }),
      find: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as IDataEngine;
  });

  it('injects context.isSystem into find / findOne / count', async () => {
    const e = withSystemContext(mockEngine);
    await e.find('sys_member', { where: { user_id: 'u1' } } as any);
    await e.findOne('sys_organization', { where: { id: 'o1' } } as any);
    await e.count('sys_member', { where: { user_id: 'u1' } } as any);
    expect(mockEngine.find).toHaveBeenCalledWith('sys_member', expect.objectContaining({ context: { isSystem: true } }));
    expect(mockEngine.findOne).toHaveBeenCalledWith('sys_organization', expect.objectContaining({ context: { isSystem: true } }));
    expect(mockEngine.count).toHaveBeenCalledWith('sys_member', expect.objectContaining({ context: { isSystem: true } }));
  });

  it('merges isSystem with a caller-supplied context', async () => {
    const e = withSystemContext(mockEngine);
    await e.find('sys_member', { where: {}, context: { transaction: 'tx1' } } as any);
    expect(mockEngine.find).toHaveBeenCalledWith('sys_member', expect.objectContaining({ context: { transaction: 'tx1', isSystem: true } }));
  });

  it('runs WRITES as system too — insert/update carry isSystem, delete merges it into the query (#3164)', async () => {
    const e = withSystemContext(mockEngine);
    await e.insert('sys_member', { id: 'm1' } as any);
    await e.update('sys_member', { id: 'm1' } as any);
    await e.delete('sys_member', { where: { id: 'm1' } } as any);
    // Without this the #2948 readonly-UPDATE strip silently drops better-auth's
    // own writes to readonly identity columns (sys_user.email, banned, …).
    expect(mockEngine.insert).toHaveBeenCalledWith('sys_member', { id: 'm1' }, { context: { isSystem: true } });
    expect(mockEngine.update).toHaveBeenCalledWith('sys_member', { id: 'm1' }, { context: { isSystem: true } });
    expect(mockEngine.delete).toHaveBeenCalledWith('sys_member', { where: { id: 'm1' }, context: { isSystem: true } });
  });
});

describe('createObjectQLAdapter – reads bypass control-plane org-scope (regression)', () => {
  it('findMany on member runs as a system read so org-scope hooks pass through', async () => {
    const mockEngine = {
      insert: vi.fn(), findOne: vi.fn(), find: vi.fn().mockResolvedValue([]),
      count: vi.fn(), update: vi.fn(), delete: vi.fn(),
    } as unknown as IDataEngine;
    const adapter = createObjectQLAdapter(mockEngine);
    await adapter.findMany({ model: 'account', limit: 10 });
    expect(mockEngine.find).toHaveBeenCalledWith('sys_account', expect.objectContaining({ context: { isSystem: true } }));
  });
});

describe('withValidationErrorMapping – ObjectQL ValidationError → better-auth APIError', () => {
  // Faithful mimic of ObjectQL's record-validator ValidationError
  // (packages/objectql/src/validation/record-validator.ts): plugin-auth does
  // not depend on @objectstack/objectql, and the mapping is duck-typed by
  // `code` / `name`, so a same-shape stand-in exercises the exact code path.
  class FakeValidationError extends Error {
    readonly code = 'VALIDATION_FAILED';
    readonly fields: Array<Record<string, unknown>>;
    constructor(fields: Array<Record<string, unknown>>) {
      super(fields.map((f) => f.message).join('; '));
      this.name = 'ValidationError';
      this.fields = fields;
    }
  }

  const IMAGE_ERR = () =>
    new FakeValidationError([
      { field: 'image', code: 'invalid_url', message: 'image must be a valid URL (scheme://...)' },
    ]);

  it('maps a thrown ValidationError to a 400 APIError carrying message + fields', async () => {
    const adapter = withValidationErrorMapping({
      update: async () => {
        throw IMAGE_ERR();
      },
    });

    let caught: any;
    try {
      await adapter.update();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(isAPIError(caught)).toBe(true);
    // better-call maps the 'BAD_REQUEST' status string to HTTP 400.
    expect(caught.statusCode).toBe(400);
    expect(caught.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'image must be a valid URL (scheme://...)',
    });
    expect(caught.body.fields).toEqual([
      { field: 'image', code: 'invalid_url', message: 'image must be a valid URL (scheme://...)' },
    ]);
  });

  // "Unclassified" — an error carrying neither the validation envelope nor the
  // `PERMISSION_DENIED` policy-refusal code the break-glass guards throw
  // (ADR-0135 D5.2; the 403 arm is pinned in `last-admin-guard.test.ts`).
  // A driver fault is exactly that, and it must NOT be dressed up as a 4xx.
  it('re-throws unclassified errors verbatim (not remapped to an APIError)', async () => {
    const boom = new Error('driver exploded');
    const adapter = withValidationErrorMapping({
      update: async () => {
        throw boom;
      },
    });

    await expect(adapter.update()).rejects.toBe(boom);
  });

  // [#7724] The third arm. A referential veto is raised by the ENGINE, well
  // below the layers that know better-auth exists, so it carried neither the
  // validation envelope nor the policy-refusal code and fell through to
  // `throw err` — reaching an admin as a 500 with an EMPTY body for a refusal
  // the engine had explained in full.
  describe('a referential delete restriction (DELETE_RESTRICTED) → 409', () => {
    // Faithful mimic of the engine's envelope (`packages/objectql/src/engine.ts`,
    // ADR-0112 + #7307's message split).
    const restricted = () => {
      const err: any = new Error('Cannot delete User: 1 or more Member records still reference it.');
      err.code = 'DELETE_RESTRICTED';
      err.status = 409;
      err.object = 'sys_user';
      err.dependentObject = 'sys_member';
      err.dependentCount = 3;
      err.developerMessage =
        'Cannot delete sys_user: 3 dependent sys_member record(s) reference it via user_id ' +
        "(user_id is required, so it cannot be cleared). Delete or reassign them first, " +
        "or set deleteBehavior:'cascade' on sys_member.user_id.";
      return err;
    };

    it('maps it to a 409 APIError instead of letting it escape as a bodyless 500', async () => {
      const adapter = withValidationErrorMapping({
        delete: async () => {
          throw restricted();
        },
      });

      let caught: any;
      try {
        await adapter.delete();
      } catch (e) {
        caught = e;
      }

      // Both halves of the envelope, per ADR-0112: a throw alone cannot tell
      // "refused with the wrong envelope" apart from "refused correctly" —
      // the unfixed path throws too, it just throws something better-auth
      // cannot render.
      expect(isAPIError(caught)).toBe(true);
      expect(caught.statusCode).toBe(409);
      expect(caught.body).toMatchObject({
        code: 'DELETE_RESTRICTED',
        message: 'Cannot delete User: 1 or more Member records still reference it.',
      });
    });

    it('carries the structured half through — the remedy stays reachable', async () => {
      // #7307's reasoning at the REST mapping, applied to this transport:
      // dropping `developerMessage` here would move the defect rather than fix
      // it, and it discloses nothing `dependentObject` does not already.
      const adapter = withValidationErrorMapping({
        delete: async () => {
          throw restricted();
        },
      });

      const caught: any = await adapter.delete().catch((e: unknown) => e);
      expect(caught.body.dependentObject).toBe('sys_member');
      expect(caught.body.dependentCount).toBe(3);
      expect(caught.body.developerMessage).toContain("deleteBehavior:'cascade'");
    });

    it('omits the structured keys when the engine did not supply them', async () => {
      // A bare `DELETE_RESTRICTED` must still map — the arm keys off `code`,
      // not off the optional detail — and must not invent `dependentCount: 0`,
      // which would read as "no dependents" on the error that exists to say
      // there are some.
      const bare: any = new Error('Cannot delete: dependent records exist');
      bare.code = 'DELETE_RESTRICTED';
      const adapter = withValidationErrorMapping({
        delete: async () => {
          throw bare;
        },
      });

      const caught: any = await adapter.delete().catch((e: unknown) => e);
      expect(caught.statusCode).toBe(409);
      expect(caught.body.code).toBe('DELETE_RESTRICTED');
      expect(caught.body).not.toHaveProperty('dependentObject');
      expect(caught.body).not.toHaveProperty('dependentCount');
      expect(caught.body).not.toHaveProperty('developerMessage');
      expect(caught.body).not.toHaveProperty('dependents');
    });

    it('[#24948] carries an organization refusal\'s dependents list to the wire, a withheld count staying absent', async () => {
      const org: any = new Error('Cannot delete this organization: it still owns records in crm_account (2), crm_note.');
      org.code = 'DELETE_RESTRICTED';
      org.status = 409;
      org.dependentObject = 'crm_account';
      org.dependentCount = 2;
      org.dependents = [{ object: 'crm_account', count: 2 }, { object: 'crm_note' }];
      const adapter = withValidationErrorMapping({
        delete: async () => {
          throw org;
        },
      });

      const caught: any = await adapter.delete().catch((e: unknown) => e);
      expect(caught.statusCode).toBe(409);
      expect(caught.body.dependents).toEqual([{ object: 'crm_account', count: 2 }, { object: 'crm_note' }]);
    });
  });

  it('passes successful results through untouched and leaves non-function props alone', async () => {
    const adapter = withValidationErrorMapping({
      create: async (x: number) => x + 1,
      options: { adapterId: 'objectql' },
    });

    await expect(adapter.create(41)).resolves.toBe(42);
    expect(adapter.options).toEqual({ adapterId: 'objectql' });
  });

  it('factory adapter surfaces engine ValidationError on update as a 400 APIError', async () => {
    // End-to-end through the production factory: a real ObjectQL engine that
    // rejects an invalid `image` on update must reach better-auth as a 400,
    // not a raw 500 (the update-user regression).
    const engine = {
      insert: vi.fn(),
      findOne: vi.fn().mockResolvedValue({ id: 'u1' }),
      find: vi.fn(),
      count: vi.fn(),
      update: vi.fn().mockRejectedValue(IMAGE_ERR()),
      delete: vi.fn(),
    } as unknown as IDataEngine;

    const adapter: any = (createObjectQLAdapterFactory(engine) as any)({} as any);

    let caught: any;
    try {
      await adapter.update({
        model: 'user',
        where: [{ field: 'id', value: 'u1', operator: 'eq', connector: 'AND' }],
        update: { image: 'notaurl' },
      });
    } catch (e) {
      caught = e;
    }

    expect(isAPIError(caught)).toBe(true);
    expect(caught.statusCode).toBe(400);
    expect(caught.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('an unbounded ssoProvider read reads every row (the 100-row factory default does not apply)', () => {
  // `@better-auth/sso` reads `ssoProvider` with no `limit` and treats the
  // answer as the whole table; better-auth's adapter factory turns that into
  // `defaultFindManyLimit ?? 100` before this adapter runs. End of the chain:
  // a real AuthManager with the real `sso()` plugin over the in-memory engine
  // (which honours `limit`), driven through its HTTP surface.
  const SECRET = 'test-secret-at-least-32-chars-long-sso-provider-rows';
  const BASE = 'http://localhost:3000';
  const AUTH = `${BASE}/api/v1/auth`;

  const oidcRow = (providerId: string, domain: string, userId?: string) => {
    const idp = `https://${providerId}.idp.example.test`;
    return {
      providerId,
      domain,
      issuer: idp,
      ...(userId ? { userId } : {}),
      oidcConfig: JSON.stringify({
        issuer: idp,
        clientId: `client-${providerId}`,
        clientSecret: 'secret',
        authorizationEndpoint: `${idp}/authorize`,
        tokenEndpoint: `${idp}/token`,
        jwksEndpoint: `${idp}/jwks`,
        discoveryEndpoint: `${idp}/.well-known/openid-configuration`,
        pkce: true,
        scopes: ['openid', 'email'],
        mapping: { id: 'sub', email: 'email', name: 'name' },
      }),
    };
  };

  /** `fillers` unrelated providers first, then `acme` (domain `acme.com`) at row `fillers + 1`. */
  const boot = async (fillers: number, ownerId?: string) => {
    const engine = createMemoryEngine();
    (engine as any).resolveSecretField = async () => 'secret';
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: BASE,
      dataEngine: engine,
      trustedOrigins: [BASE],
      plugins: { sso: true },
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    } as never);
    const ctx = await ((await manager.getAuthInstance()) as any).$context;
    for (let i = 0; i < fillers; i++) {
      await ctx.adapter.create({ model: 'ssoProvider', data: oidcRow(`filler-${i}`, `filler-${i}.example`, ownerId) });
    }
    await ctx.adapter.create({ model: 'ssoProvider', data: oidcRow('acme', 'acme.com', ownerId) });
    expect((engine as any).tables.get('sys_sso_provider')).toHaveLength(fillers + 1);
    return { manager, engine, ctx };
  };

  const signInSso = async (manager: AuthManager, email: string) => {
    const res = await manager.handleRequest(
      new Request(`${AUTH}/sign-in/sso`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email, callbackURL: `${BASE}/after` }),
      }),
    );
    const body: any = await res.json().catch(() => null);
    return {
      status: res.status,
      body,
      clientId: body?.url ? new URL(body.url).searchParams.get('client_id') : null,
    };
  };

  for (const row of [101, 151]) {
    it(`a provider matched only by domainMatches (a subdomain) at row ${row} routes`, async () => {
      const { manager } = await boot(row - 1);
      const res = await signInSso(manager, 'mia@eng.acme.com');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.clientId).toBe('client-acme');
    });
  }

  it('CONTROL: an exact-domain address routes by the step-1 findOne at row 151, unchanged', async () => {
    const { manager } = await boot(150);
    const res = await signInSso(manager, 'mia@acme.com');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.clientId).toBe('client-acme');
  });

  it('CONTROL: an address no provider matches gets the same refusal past 100 rows', async () => {
    const { manager } = await boot(150);
    const res = await signInSso(manager, 'mia@nobody.example');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: 'No provider found for the issuer' });
  });

  it('/sso/providers lists the caller\'s own provider past row 100', async () => {
    const engine0 = await boot(0);
    // Sign a user up first so the providers can be owned by that user.
    const signUp = await engine0.manager.handleRequest(
      new Request(`${AUTH}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ email: 'owner@acme.com', password: 'S3cure!Passw0rd-32388', name: 'Owner' }),
      }),
    );
    expect(signUp.status, await signUp.clone().text()).toBeLessThan(300);
    const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const ownerId = (await signUp.json()).user.id as string;
    for (let i = 0; i < 150; i++) {
      await engine0.ctx.adapter.create({ model: 'ssoProvider', data: oidcRow(`owned-${i}`, `owned-${i}.example`, ownerId) });
    }
    const res = await engine0.manager.handleRequest(
      new Request(`${AUTH}/sso/providers`, { headers: { cookie, origin: BASE } }),
    );
    const body: any = await res.json().catch(() => null);
    expect(res.status, JSON.stringify(body)).toBe(200);
    const ids = (body.providers as Array<{ providerId: string }>).map((p) => p.providerId);
    expect(ids).toHaveLength(150);
    expect(ids).toContain('owned-149');
  });

  it('an explicit limit, and every other model, keep the bound the caller or the factory gave', async () => {
    const { engine, ctx } = await boot(150);
    const find = vi.spyOn(engine as any, 'find');
    await ctx.adapter.findMany({ model: 'ssoProvider', limit: 5 });
    await ctx.adapter.findMany({ model: 'user' });
    await ctx.adapter.findMany({ model: 'ssoProvider' });
    expect(find.mock.calls.map(([name, q]: any) => [name, q.limit])).toEqual([
      ['sys_sso_provider', 5],
      ['sys_user', 100],
      ['sys_sso_provider', 151],
    ]);
  });
});

describe('a single-use auth value is redeemed at most once, even across processes sharing a database', () => {
  // Each "process" is its own ObjectQL engine with its own SQL driver
  // connection, both opened on ONE SQLite file, and its own factory-wrapped
  // adapter: nothing in memory is shared between the two, only the database.
  const VERIFICATION = 'sys_verification';
  type Adapter = {
    create(a: { model: string; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    consumeOne(a: { model: string; where: Array<Record<string, unknown>> }): Promise<Record<string, unknown> | null>;
  };
  /** A pause point: every caller waits until `parties` callers have arrived. */
  type Gate = () => Promise<void>;
  const gate = (parties: number): Gate => {
    let arrived = 0;
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    return async () => {
      if (++arrived === parties) open();
      await opened;
    };
  };

  const dirs: string[] = [];
  const engines: ObjectQL[] = [];
  afterEach(async () => {
    while (engines.length) {
      try { await engines.pop()!.destroy(); } catch { /* noop */ }
    }
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  /**
   * One replica over `file`. `atRead` runs once, after its adapter's first
   * read of a verification row; `atDelete` before each of its driver's
   * verification deletes. Both default to no pause.
   */
  const replica = async (
    file: string,
    pauses: { atRead?: () => Promise<void>; atDelete?: () => Promise<void> } = {},
  ): Promise<{ adapter: Adapter; driver: SqlDriver }> => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    const engine = new ObjectQL();
    engines.push(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
    await engine.syncSchemas();

    const driverDelete = driver.delete.bind(driver);
    driver.delete = (async (object: string, id: string | number, options?: unknown) => {
      if (object === VERIFICATION) await pauses.atDelete?.();
      return driverDelete(object, id, options as never);
    }) as typeof driver.delete;

    let read = false;
    const seen = new Proxy(engine, {
      get(target, prop) {
        const member = Reflect.get(target, prop, target);
        if (prop !== 'findOne') return typeof member === 'function' ? member.bind(target) : member;
        return async (object: string, ...rest: unknown[]) => {
          const row = await (member as (...a: unknown[]) => Promise<unknown>).call(target, object, ...rest);
          if (object === VERIFICATION && !read) {
            read = true;
            await pauses.atRead?.();
          }
          return row;
        };
      },
    });
    const adapter = (createObjectQLAdapterFactory(seen as unknown as IDataEngine) as unknown as (o: unknown) => Adapter)({});
    return { adapter, driver };
  };

  const sharedFile = () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-auth-single-use-'));
    dirs.push(dir);
    return join(dir, 'auth.db');
  };

  const issue = (adapter: Adapter, identifier: string) =>
    adapter.create({
      model: 'verification',
      data: { identifier, value: `value-of-${identifier}`, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });

  const redeem = (adapter: Adapter, id: unknown) =>
    adapter.consumeOne({ model: 'verification', where: [{ field: 'id', value: id, operator: 'eq', connector: 'AND' }] });

  const stored = async (driver: SqlDriver, identifier: string) =>
    (await driver.find(VERIFICATION, { object: VERIFICATION, where: { identifier } } as never)) as unknown[];

  it('of two concurrent redemptions on two engines over one database, exactly one receives the value', async () => {
    const file = sharedFile();
    const atRead = gate(2);
    const atDelete = gate(2);
    const a = await replica(file, { atRead, atDelete });
    const b = await replica(file, { atRead, atDelete });
    const row = await issue(a.adapter, 'race-both-paused');

    const answers = await Promise.all([redeem(a.adapter, row.id), redeem(b.adapter, row.id)]);

    expect(answers.filter((r) => r !== null), 'redemptions that received the value').toHaveLength(1);
    expect(answers.filter((r) => r === null), 'redemptions answered null').toHaveLength(1);
    expect(answers.find((r) => r !== null)).toMatchObject({ id: row.id, value: 'value-of-race-both-paused' });
    expect(await stored(a.driver, 'race-both-paused')).toHaveLength(0);
  });

  it('a redemption of a value already redeemed elsewhere receives null', async () => {
    const file = sharedFile();
    const bothRead = gate(2);
    let aDone!: Promise<unknown>;
    const a = await replica(file, { atRead: bothRead });
    const b = await replica(file, { atRead: async () => { await bothRead(); await aDone; } });
    const row = await issue(a.adapter, 'race-late-delete');

    aDone = redeem(a.adapter, row.id);
    const [first, second] = await Promise.all([aDone, redeem(b.adapter, row.id)]);

    expect(first).toMatchObject({ id: row.id, value: 'value-of-race-late-delete' });
    expect(second).toBeNull();
    expect(await stored(b.driver, 'race-late-delete')).toHaveLength(0);
  });

  it('a single redemption receives the value and removes it', async () => {
    const { adapter, driver } = await replica(sharedFile());
    const row = await issue(adapter, 'single');

    expect(await redeem(adapter, row.id)).toMatchObject({ id: row.id, identifier: 'single', value: 'value-of-single' });
    expect(await stored(driver, 'single')).toHaveLength(0);
    expect(await redeem(adapter, row.id), 'the same value a second time').toBeNull();
  });

  it('redeeming a value that does not exist receives null and removes nothing', async () => {
    const { adapter, driver } = await replica(sharedFile());
    await issue(adapter, 'bystander');

    expect(await redeem(adapter, 'no-such-value')).toBeNull();
    expect(await stored(driver, 'bystander')).toHaveLength(1);
  });
});

describe('a guarded increment is one atomic conditional write, even across processes sharing a database', () => {
  // The same two-replica shape as the single-use suite above: two ObjectQL
  // engines, each with its own SQL driver connection to ONE SQLite file and
  // its own factory-wrapped adapter. Each replica pauses once, right after its
  // first read of a guarded row, until both replicas have read — so both
  // calls see the guard pass before either one writes. The three call shapes
  // are ones better-auth 1.7.12 itself issues against `incrementOne`.
  const GUARDED = new Set(['sys_two_factor', 'sys_team']);
  type Where = { field: string; value: unknown; operator?: string; connector?: string };
  type Adapter = {
    create(a: { model: string; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findOne(a: { model: string; where: Where[] }): Promise<Record<string, unknown> | null>;
    incrementOne(a: {
      model: string; where: Where[]; increment: Record<string, number>; set?: Record<string, unknown>;
    }): Promise<Record<string, unknown> | null>;
  };
  const gate = (parties: number) => {
    let arrived = 0;
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    return async () => {
      if (++arrived === parties) open();
      await opened;
    };
  };

  const dirs: string[] = [];
  const engines: ObjectQL[] = [];
  afterEach(async () => {
    while (engines.length) {
      try { await engines.pop()!.destroy(); } catch { /* noop */ }
    }
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const replica = async (file: string, atRead?: () => Promise<void>): Promise<{ adapter: Adapter; driver: SqlDriver }> => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    const engine = new ObjectQL();
    engines.push(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
    await engine.syncSchemas();

    let read = false;
    const seen = new Proxy(engine, {
      get(target, prop) {
        const member = Reflect.get(target, prop, target);
        if (prop !== 'findOne') return typeof member === 'function' ? member.bind(target) : member;
        return async (object: string, ...rest: unknown[]) => {
          const row = await (member as (...a: unknown[]) => Promise<unknown>).call(target, object, ...rest);
          if (GUARDED.has(object) && !read) {
            read = true;
            await atRead?.();
          }
          return row;
        };
      },
    });
    const options = {
      plugins: [
        twoFactor({ schema: buildTwoFactorPluginSchema() }),
        organization({ schema: buildOrganizationPluginSchema(), teams: { enabled: true } }),
      ],
    };
    const adapter = (createObjectQLAdapterFactory(seen as unknown as IDataEngine) as unknown as (o: unknown) => Adapter)(options);
    return { adapter, driver };
  };

  /** Two replicas over one fresh file, both paused at their first guarded read. */
  const twoReplicas = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-auth-guarded-increment-'));
    dirs.push(dir);
    const file = join(dir, 'auth.db');
    const bothRead = gate(2);
    return [await replica(file, bothRead), await replica(file, bothRead)] as const;
  };
  /** One replica, no pause: the sequential control. */
  const oneReplica = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-auth-guarded-increment-'));
    dirs.push(dir);
    return replica(join(dir, 'auth.db'));
  };

  const eq = (field: string, value: unknown): Where => ({ field, value, operator: 'eq', connector: 'AND' });
  const stored = async (driver: SqlDriver, object: string, id: unknown) =>
    ((await driver.find(object, { object, where: { id } } as never)) as Array<Record<string, unknown>>)[0];

  const twoFactorRow = async (adapter: Adapter, backupCodes = 'codes-v1') => {
    const user = await adapter.create({ model: 'user', data: { email: `u${Math.random()}@example.com`, name: 'U', emailVerified: false } });
    return adapter.create({ model: 'twoFactor', data: { userId: user.id, secret: 'totp-secret', backupCodes } });
  };
  const teamRow = async (adapter: Adapter) => {
    const org = await adapter.create({ model: 'organization', data: { name: 'Org', slug: `org-${Math.random()}`.replace('.', '') } });
    return adapter.create({ model: 'team', data: { name: 'Team', organizationId: org.id, memberCount: 0 } });
  };

  // A guard on a stored value, and an absolute `set` that moves it.
  const swapGuardedValue = (adapter: Adapter, id: unknown, from: string, to: string) =>
    adapter.incrementOne({ model: 'twoFactor', where: [eq('id', id), eq('backupCodes', from)], increment: {}, set: { backupCodes: to } });
  // No guard beyond the row: +1.
  const incrementUnguarded = (adapter: Adapter, id: unknown) =>
    adapter.incrementOne({ model: 'twoFactor', where: [eq('id', id)], increment: { failedVerificationCount: 1 } });
  // A guard on the counter itself (below a bound), +1.
  const incrementBelowBound = (adapter: Adapter, id: unknown, maximum: number) =>
    adapter.incrementOne({
      model: 'team',
      where: [eq('id', id), { field: 'memberCount', value: maximum, operator: 'lt', connector: 'AND' }],
      increment: { memberCount: 1 },
    });

  it('a guard on a stored value admits exactly one of two concurrent conditional writes on two engines over one database', async () => {
    const [a, b] = await twoReplicas();
    const row = await twoFactorRow(a.adapter);

    const answers = await Promise.all([
      swapGuardedValue(a.adapter, row.id, 'codes-v1', 'codes-v2-by-a'),
      swapGuardedValue(b.adapter, row.id, 'codes-v1', 'codes-v2-by-b'),
    ]);

    expect(answers.filter((r) => r !== null), 'conditional writes applied').toHaveLength(1);
    const accepted = answers.find((r) => r !== null)!;
    expect((await stored(a.driver, 'sys_two_factor', row.id)).backup_codes).toBe(accepted.backupCodes);
  });

  it('two concurrent unguarded increments on two engines over one database are both applied', async () => {
    const [a, b] = await twoReplicas();
    const row = await twoFactorRow(a.adapter);

    const answers = await Promise.all([incrementUnguarded(a.adapter, row.id), incrementUnguarded(b.adapter, row.id)]);

    expect(answers.map((r) => r?.failedVerificationCount).sort()).toEqual([1, 2]);
    expect((await stored(a.driver, 'sys_two_factor', row.id)).failed_verification_count).toBe(2);
  });

  it('a guard on the counter admits exactly one of two concurrent increments up to its bound on two engines over one database', async () => {
    const [a, b] = await twoReplicas();
    const team = await teamRow(a.adapter);

    const answers = await Promise.all([incrementBelowBound(a.adapter, team.id, 1), incrementBelowBound(b.adapter, team.id, 1)]);

    expect(answers.filter((r) => r !== null), 'increments applied').toHaveLength(1);
    expect(answers.find((r) => r !== null)).toMatchObject({ id: team.id, memberCount: 1 });
    expect((await stored(a.driver, 'sys_team', team.id)).member_count).toBe(1);
  });

  it('one caller at a time: each guarded increment applies, and a guard that no longer holds changes nothing', async () => {
    const { adapter, driver } = await oneReplica();
    const row = await twoFactorRow(adapter);
    const team = await teamRow(adapter);

    expect(await swapGuardedValue(adapter, row.id, 'codes-v1', 'codes-v2')).toMatchObject({ id: row.id, backupCodes: 'codes-v2' });
    expect(await swapGuardedValue(adapter, row.id, 'codes-v1', 'codes-v3'), 'the same guard a second time').toBeNull();
    expect((await stored(driver, 'sys_two_factor', row.id)).backup_codes).toBe('codes-v2');

    expect((await incrementUnguarded(adapter, row.id))?.failedVerificationCount).toBe(1);
    expect((await incrementUnguarded(adapter, row.id))?.failedVerificationCount).toBe(2);

    expect(await incrementBelowBound(adapter, team.id, 2)).toMatchObject({ memberCount: 1 });
    expect(await incrementBelowBound(adapter, team.id, 2)).toMatchObject({ memberCount: 2 });
    expect(await incrementBelowBound(adapter, team.id, 2), 'the bound is reached').toBeNull();
    expect((await stored(driver, 'sys_team', team.id)).member_count).toBe(2);

    expect(await incrementUnguarded(adapter, 'no-such-row'), 'a row that does not exist').toBeNull();
  });

  it('the row a guarded increment answers carries the fields a read of that row carries, internal columns included', async () => {
    const { adapter } = await oneReplica();
    const row = await twoFactorRow(adapter);
    const team = await teamRow(adapter);
    const fieldsOf = (r: Record<string, unknown> | null) => Object.keys(r ?? {}).sort();
    const read = (model: string, id: unknown) => adapter.findOne({ model, where: [eq('id', id)] });

    const counted = await incrementUnguarded(adapter, row.id);
    expect(counted).toMatchObject({ id: row.id, secret: 'totp-secret', backupCodes: 'codes-v1', failedVerificationCount: 1 });
    expect(fieldsOf(counted)).toEqual(fieldsOf(await read('twoFactor', row.id)));

    const swapped = await swapGuardedValue(adapter, row.id, 'codes-v1', 'codes-v2');
    expect(swapped).toMatchObject({ id: row.id, secret: 'totp-secret', backupCodes: 'codes-v2' });
    expect(fieldsOf(swapped)).toEqual(fieldsOf(await read('twoFactor', row.id)));

    const reserved = await incrementBelowBound(adapter, team.id, 5);
    expect(reserved).toMatchObject({ id: team.id, memberCount: 1 });
    expect(fieldsOf(reserved)).toEqual(fieldsOf(await read('team', team.id)));
  });

  it('a counter stored as null counts from zero', async () => {
    const { adapter, driver } = await oneReplica();
    const row = await twoFactorRow(adapter);
    await driver.update('sys_two_factor', row.id as string, { failed_verification_count: null });

    expect((await incrementUnguarded(adapter, row.id))?.failedVerificationCount).toBe(1);
    expect((await stored(driver, 'sys_two_factor', row.id)).failed_verification_count).toBe(1);
  });
});
