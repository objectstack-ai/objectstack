// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Drift gate: every column the INSTALLED better-auth version can write must
 * exist on the platform object that backs it.
 *
 * ## Why this is a separate guard from ADR-0092 D7
 *
 * `managed-extension-fields.test.ts` derives better-auth's surface from
 * `getAuthTables()` too, but it answers the opposite question: *does one of
 * OUR extension fields collide with one of THEIRS?* A collision is a field
 * present on both sides. This gate catches the other half — a field present
 * only on better-auth's side, which D7 waves straight through because there is
 * nothing to collide with. A dependency bump that ADDS a model field therefore
 * built clean and failed at runtime, twice:
 *
 *  - 1.7's `oauthAccessToken.authorizationCodeId` → 500 at the token endpoint,
 *    which broke platform SSO for every environment. Closed by the per-plugin
 *    `oauth-provider-schema-parity.test.ts`, whose check this file generalizes.
 *  - 1.7.0-rc.1's `team.memberCount` / `teamMember.membershipKey` → 500 on
 *    `organization/create` (the plugin auto-creates a default team when
 *    `teams.enabled`, which is the auth-manager default), leaving a committed
 *    org row with no team behind it. #3624.
 *
 * Same failure shape both times, in a model nobody had written a per-plugin
 * gate for — so this covers the auth manager's WHOLE model surface at once
 * rather than one more plugin.
 *
 * ## What it checks
 *
 * `getAuthTables()` merges the core models with every plugin's schema and
 * applies our `fields` overrides as `fieldName`, exactly as better-auth's
 * adapter resolves a column: `field.fieldName ?? key`. Two ways to fail:
 *
 *  1. **Unmapped model** — better-auth would write a table no platform object
 *     provisions.
 *  2. **Unprovisioned column** — the resolved column is absent from the
 *     object's fields. Note that an UNMAPPED camelCase field fails here too
 *     (it resolves to `memberCount`, not `member_count`), so one assertion
 *     catches both "forgot the snake_case mapping" and "forgot the column".
 *
 * `@better-auth/oauth-provider` is deliberately absent: it ships as its own
 * package with its own pinned version and already has the dedicated gate named
 * above.
 *
 * `@better-auth/sso` / `@better-auth/scim` accept no `schema` option, so
 * `getAuthTables()` cannot see them — they were the hole this gate shipped
 * with (#3653). The second describe block below closes it by reading each
 * plugin's OWN declared schema and resolving columns the way the ADAPTER
 * does for a bridged model (mechanical camelCase → snake_case in
 * `objectql-adapter.ts`), which is the rule that actually governs their
 * writes.
 */

import { describe, expect, it } from 'vitest';
import { getAuthTables } from 'better-auth/db';
import { organization, twoFactor, admin } from 'better-auth/plugins';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { jwt } from 'better-auth/plugins/jwt';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';
import { sso } from '@better-auth/sso';
import { scim } from '@better-auth/scim';
import {
  SysAccount,
  SysDeviceCode,
  SysInvitation,
  SysJwks,
  SysMember,
  SysOrganization,
  SysSession,
  SysTeam,
  SysTeamMember,
  SysScimProvider,
  SysSsoProvider,
  SysTwoFactor,
  SysUser,
  SysVerification,
} from '@objectstack/platform-objects/identity';

import {
  AUTH_ACCOUNT_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_USER_CONFIG,
  AUTH_VERIFICATION_CONFIG,
  buildAdminPluginSchema,
  buildDeviceAuthorizationPluginSchema,
  buildJwtPluginSchema,
  buildOrganizationPluginSchema,
  buildPhoneNumberPluginSchema,
  buildTwoFactorPluginSchema,
} from './auth-schema-config.js';
import { resolveProtocolName } from './objectql-adapter.js';

type PlatformObject = { name: string; fields?: Record<string, unknown> };

/** Object name → the platform object that provisions its physical table. */
const PLATFORM_OBJECTS: Record<string, PlatformObject> = Object.fromEntries(
  ([
    SysUser, SysSession, SysAccount, SysVerification,
    SysOrganization, SysMember, SysInvitation, SysTeam, SysTeamMember,
    SysTwoFactor, SysDeviceCode, SysJwks,
    // Bridged at the adapter layer rather than via a plugin `schema` option —
    // see the sso/scim block at the bottom of this file (#3653).
    SysSsoProvider, SysScimProvider,
  ] as unknown as PlatformObject[]).map((o) => [o.name, o]),
);

/**
 * The model surface the auth manager actually configures — same option shapes
 * it passes in `auth-manager.ts`, so the tables this derives are the tables a
 * booted environment gets. Plugins that are feature-flagged off in some
 * deployments are still included: the column has to exist before the flag can
 * be turned on.
 */
function authTables() {
  return getAuthTables({
    user: AUTH_USER_CONFIG,
    session: AUTH_SESSION_CONFIG,
    account: AUTH_ACCOUNT_CONFIG,
    verification: AUTH_VERIFICATION_CONFIG,
    plugins: [
      // `teams.enabled` mirrors the auth-manager default. Without it the team
      // models drop out of the surface entirely and this gate would have gone
      // green through #3624 — the exact hole being closed.
      organization({ teams: { enabled: true }, schema: buildOrganizationPluginSchema() }),
      twoFactor({ schema: buildTwoFactorPluginSchema() }),
      admin({ schema: buildAdminPluginSchema() }),
      phoneNumber({ schema: buildPhoneNumberPluginSchema() }),
      jwt({ schema: buildJwtPluginSchema() }),
      deviceAuthorization({ schema: buildDeviceAuthorizationPluginSchema() }),
    ],
  } as never) as Record<
    string,
    { modelName?: string; fields?: Record<string, { fieldName?: string }> }
  >;
}

describe('better-auth schema ↔ platform-objects parity (#3624)', () => {
  const tables = authTables();

  it('derives a non-empty surface (the gate must not pass vacuously)', () => {
    expect(Object.keys(tables).length).toBeGreaterThan(0);
    // Teams are the regression under test: if the org plugin ever stops
    // reporting them, every team assertion below would silently vanish.
    expect(Object.keys(tables)).toContain('team');
    expect(Object.keys(tables)).toContain('teamMember');
  });

  it('every better-auth model maps to a platform object', () => {
    const unmapped = Object.entries(tables)
      .map(([model, table]) => ({ model, table: table.modelName ?? model }))
      .filter(({ table }) => !PLATFORM_OBJECTS[table])
      .map(({ model, table }) => `${model} → ${table}`);
    expect(
      unmapped,
      'better-auth would write tables no platform object provisions: '
      + `${unmapped.join(', ')} — declare the object in packages/platform-objects/src/identity/ `
      + 'and map it via a modelName in auth-schema-config.ts (or, if the model is intentionally '
      + 'unused, drop the plugin from this gate with a note).',
    ).toEqual([]);
  });

  for (const [model, table] of Object.entries(tables)) {
    const tableName = table.modelName ?? model;
    it(`every ${model} column exists on ${tableName}`, () => {
      const object = PLATFORM_OBJECTS[tableName];
      if (!object) return; // reported by the mapping assertion above
      // better-auth always owns the primary key, whatever the object declares.
      const declared = new Set(['id', ...Object.keys(object.fields ?? {})]);
      const missing = Object.entries(table.fields ?? {})
        .map(([key, field]) => field.fieldName ?? key)
        .filter((column) => !declared.has(column));
      expect(
        missing,
        `columns better-auth can write to ${tableName} but the platform object does not declare: `
        + `${missing.join(', ')} — add the field(s) to packages/platform-objects/src/identity/ and, `
        + 'when camelCase ≠ snake_case, a fieldName mapping in auth-schema-config.ts. A camelCase '
        + 'name here means the mapping is missing, not just the column.',
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// @better-auth/sso + @better-auth/scim (#3653)
// ---------------------------------------------------------------------------

/**
 * These two plugins hardcode their model names and read no `schema` option, so
 * `getAuthTables()` above is blind to them. The adapter bridges them instead:
 * `AUTH_MODEL_TO_PROTOCOL` maps the model, and `createObjectQLAdapterFactory`
 * mechanically camelCase→snake_cases every field of a bridged model on the way
 * in. That mechanical rule — not any hand-written mapping — is what decides
 * the column they actually write, so it is what this reproduces.
 *
 * Mirrors the adapter's own `camelToSnake`.
 */
function adapterColumn(field: string): string {
  return field.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/**
 * SCIM models with no platform object, acknowledged rather than silently
 * skipped. These four are SCIM **group** provisioning (`/Groups` push from the
 * IdP); ObjectStack ships only the provider row today, so an IdP pushing
 * groups would write tables that do not exist — filed as its own feature gap.
 *
 * Pinned as an exact set on purpose: a NEW unmapped model is a build failure,
 * so this list can never quietly grow the way the original hole did.
 */
const KNOWN_UNMAPPED_MODELS = new Set([
  'scimGroup',
  'scimGroupMember',
  'scimGroupRole',
  'scimGroupRoleGrant',
]);

describe('@better-auth/sso + @better-auth/scim schema ↔ platform-objects parity (#3653)', () => {
  const plugins: Array<{ label: string; schema: Record<string, { fields?: Record<string, unknown> }> }> = [
    { label: 'sso', schema: (sso() as any).schema },
    { label: 'scim', schema: (scim({} as never) as any).schema },
  ];

  it('both plugins still expose a readable schema (the gate must not pass vacuously)', () => {
    for (const { label, schema } of plugins) {
      expect(Object.keys(schema ?? {}).length, `${label} exposed no schema`).toBeGreaterThan(0);
    }
  });

  it('the set of models with no platform object is exactly the acknowledged one', () => {
    const unmapped = plugins
      .flatMap(({ schema }) => Object.keys(schema ?? {}))
      .filter((model) => !PLATFORM_OBJECTS[resolveProtocolName(model)]);
    expect(
      unmapped.sort(),
      'a model gained or lost a platform object. A NEW name here means the plugin added a table '
      + 'nothing provisions — declare the object and map it in AUTH_MODEL_TO_PROTOCOL. A name that '
      + 'DISAPPEARED means it is now provisioned — drop it from KNOWN_UNMAPPED_MODELS so it is '
      + 'covered by the column check below.',
    ).toEqual([...KNOWN_UNMAPPED_MODELS].sort());
  });

  for (const { label, schema } of [
    { label: 'sso', schema: (sso() as any).schema as Record<string, { fields?: Record<string, unknown> }> },
    { label: 'scim', schema: (scim({} as never) as any).schema as Record<string, { fields?: Record<string, unknown> }> },
  ]) {
    for (const [model, def] of Object.entries(schema ?? {})) {
      if (KNOWN_UNMAPPED_MODELS.has(model)) continue;
      const objectName = resolveProtocolName(model);
      it(`every ${label}/${model} column exists on ${objectName}`, () => {
        const object = PLATFORM_OBJECTS[objectName];
        expect(object, `${model} must map to a platform object via AUTH_MODEL_TO_PROTOCOL`).toBeDefined();
        const declared = new Set(['id', ...Object.keys(object.fields ?? {})]);
        const missing = Object.keys(def.fields ?? {})
          .map(adapterColumn)
          .filter((column) => !declared.has(column));
        expect(
          missing,
          `columns ${label} can write to ${objectName} but the platform object does not declare: `
          + `${missing.join(', ')} — add the field(s) to packages/platform-objects/src/identity/. `
          + 'These plugins take no schema option, so the adapter snake_cases their fields '
          + 'mechanically; there is no mapping to add, only the column.',
        ).toEqual([]);
      });
    }
  }
});

/**
 * Upgrade tripwires for the #3585 fix.
 *
 * `AuthManager.buildJwtPlugin` reaches into two things better-auth does not
 * version as public API: the EdDSA default it applies when `keyPairConfig` is
 * absent, and the `/get-session` `after` hook whose handler is wrapped so a
 * signing failure cannot 500 the session path. Both are pinned here so a
 * better-auth bump that moves either one fails a fast unit test instead of a
 * production login.
 */
describe('better-auth jwt plugin contract (#3585)', () => {
  it('still defaults to EdDSA/Ed25519 — the reason the fallback exists', async () => {
    // If this ever fails because better-auth changed its default to something
    // universally supported, the probe is no longer load-bearing and
    // buildJwtPlugin can be simplified. Read utils.mjs `generateExportedKeyPair`
    // before deleting anything.
    const { generateExportedKeyPair } = (await import(
      'better-auth/plugins/jwt'
    )) as unknown as {
      generateExportedKeyPair: (o?: unknown) => Promise<{ alg: string; cfg: { crv?: string } }>;
    };
    const generated = await generateExportedKeyPair(undefined);
    expect(generated.alg).toBe('EdDSA');
    expect(generated.cfg.crv).toBe('Ed25519');
  });

  it('honours an explicit ES256 keyPairConfig', async () => {
    const { generateExportedKeyPair } = (await import(
      'better-auth/plugins/jwt'
    )) as unknown as {
      generateExportedKeyPair: (o?: unknown) => Promise<{ alg: string }>;
    };
    const generated = await generateExportedKeyPair({ jwks: { keyPairConfig: { alg: 'ES256' } } });
    expect(generated.alg).toBe('ES256');
  });

  it('still exposes exactly one /get-session after-hook for the guard to wrap', () => {
    const plugin = jwt({ schema: buildJwtPluginSchema() }) as unknown as {
      hooks?: { after?: Array<{ matcher?: (c: { path?: string }) => boolean; handler?: unknown }> };
    };
    const after = plugin.hooks?.after ?? [];
    const getSessionHooks = after.filter((h) => h.matcher?.({ path: '/get-session' }));

    expect(getSessionHooks).toHaveLength(1);
    expect(typeof getSessionHooks[0]!.handler).toBe('function');
    // Not matched for other paths — the guard must not silently wrap unrelated
    // hooks if the matcher is ever broadened.
    expect(after.filter((h) => h.matcher?.({ path: '/sign-in/email' }))).toHaveLength(0);
  });

  it('exposes the adapter.getJwks keyring seam the ES256 fallback relies on', () => {
    // The seam is what lets a host without Ed25519 hide keys it cannot import,
    // so resolveSigningKey's any-algorithm `getLatestKey()` fallback cannot
    // hand it a stored EdDSA key. Removing the option would silently reinstate
    // the crash for existing deployments.
    const getJwks = async () => [];
    const plugin = jwt({ schema: buildJwtPluginSchema(), adapter: { getJwks } } as never) as {
      options?: { adapter?: { getJwks?: unknown } };
    };
    expect(plugin.options?.adapter?.getJwks).toBe(getJwks);
  });
});
