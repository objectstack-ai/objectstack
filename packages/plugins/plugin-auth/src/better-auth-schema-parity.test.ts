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
 * above. `@better-auth/sso` / `@better-auth/scim` are absent because they
 * expose no `schema` option at all — their mapping is applied at the adapter
 * layer (see `objectql-adapter.ts`), so `getAuthTables()` cannot report the
 * columns they actually write.
 */

import { describe, expect, it } from 'vitest';
import { getAuthTables } from 'better-auth/db';
import { organization, twoFactor, admin } from 'better-auth/plugins';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { jwt } from 'better-auth/plugins/jwt';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';
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

type PlatformObject = { name: string; fields?: Record<string, unknown> };

/** Object name → the platform object that provisions its physical table. */
const PLATFORM_OBJECTS: Record<string, PlatformObject> = Object.fromEntries(
  ([
    SysUser, SysSession, SysAccount, SysVerification,
    SysOrganization, SysMember, SysInvitation, SysTeam, SysTeamMember,
    SysTwoFactor, SysDeviceCode, SysJwks,
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
