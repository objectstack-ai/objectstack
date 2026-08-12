// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  // better-auth 1.7 renamed `accountId` → `providerAccountId` and added the
  // required `issuer`. Lookups key on (issuer, providerAccountId), so a
  // missing mapping here reads as "no such account" on every sign-in.
  it('should map account camelCase fields to snake_case', () => {
    expect(AUTH_ACCOUNT_CONFIG.fields).toEqual({
      userId: 'user_id',
      providerId: 'provider_id',
      issuer: 'issuer',
      providerAccountId: 'account_id',
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

describe('createObjectQLAdapterFactory – schema-less plugin bridging (@better-auth/sso)', () => {
  // The sso plugin exposes no `schema` option, so its `ssoProvider` table +
  // camelCase fields are bridged at the adapter layer. Pass the plugin so
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
    expect(row).toMatchObject({ providerId: 'okta', oidcConfig: '{"clientId":"x"}' });
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
  // (ADR-0024 D5.2; the 403 arm is pinned in `last-admin-ban-guard.test.ts`).
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
