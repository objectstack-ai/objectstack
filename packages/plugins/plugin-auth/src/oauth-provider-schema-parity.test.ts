// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Drift gate: every column the INSTALLED `@better-auth/oauth-provider`
 * version can write must exist on the corresponding `sys_oauth_*` platform
 * object.
 *
 * Why this exists: the 1.7 upgrade added fields (e.g. `authorizationCodeId`)
 * that were missing from both the snake_case mappings in
 * `auth-schema-config.ts` AND the platform-object schemas. The result was a
 * runtime 500 at the token endpoint — `table sys_oauth_access_token has no
 * column named authorizationCodeId` — which broke platform SSO end-to-end
 * (cloud#: every environment login). A better-auth bump that introduces new
 * model fields must fail HERE, at test time, not in production.
 *
 * The check resolves each model field exactly like better-auth's adapter
 * does: `field.fieldName ?? key` (mergeSchema applies our fields overrides
 * as `fieldName`). The resolved column must be declared on the platform
 * object.
 */

import { describe, expect, it } from 'vitest';
import { oauthProvider } from '@better-auth/oauth-provider';
import {
  SysOauthAccessToken,
  SysOauthApplication,
  SysOauthClientAssertion,
  SysOauthClientResource,
  SysOauthConsent,
  SysOauthRefreshToken,
  SysOauthResource,
} from '@objectstack/platform-objects';
import { buildOauthProviderPluginSchema } from './auth-schema-config.js';

const PLATFORM_OBJECTS: Record<string, { name: string; fields: Record<string, unknown> }> = {
  sys_oauth_application: SysOauthApplication as any,
  sys_oauth_access_token: SysOauthAccessToken as any,
  sys_oauth_refresh_token: SysOauthRefreshToken as any,
  sys_oauth_consent: SysOauthConsent as any,
  sys_oauth_resource: SysOauthResource as any,
  sys_oauth_client_resource: SysOauthClientResource as any,
  sys_oauth_client_assertion: SysOauthClientAssertion as any,
};

describe('oauth-provider plugin schema ↔ platform-objects parity', () => {
  const plugin = oauthProvider({
    loginPage: '/login',
    schema: buildOauthProviderPluginSchema() as any,
  });
  const schema = (plugin as any).schema as Record<
    string,
    { modelName?: string; fields: Record<string, { fieldName?: string }> }
  >;

  it('declares the seven oauth models', () => {
    expect(Object.keys(schema ?? {}).sort()).toEqual([
      'oauthAccessToken',
      'oauthClient',
      'oauthClientAssertion',
      'oauthClientResource',
      'oauthConsent',
      'oauthRefreshToken',
      'oauthResource',
    ]);
  });

  for (const [model, def] of Object.entries(schema ?? {})) {
    it(`every ${model} column exists on ${def.modelName ?? model}`, () => {
      const tableName = def.modelName ?? model;
      const object = PLATFORM_OBJECTS[tableName];
      expect(object, `model "${model}" must map to a known sys_oauth_* object, got "${tableName}"`).toBeDefined();
      const declaredColumns = new Set(['id', ...Object.keys(object.fields ?? {})]);
      const missing = Object.entries(def.fields)
        .map(([key, field]) => field.fieldName ?? key)
        .filter((column) => !declaredColumns.has(column));
      expect(
        missing,
        `columns better-auth can write to ${tableName} but the platform object does not declare — `
        + 'add the field(s) to packages/platform-objects/src/identity/ and, when camelCase ≠ snake_case, '
        + 'a fieldName mapping in auth-schema-config.ts',
      ).toEqual([]);
    });
  }
});
