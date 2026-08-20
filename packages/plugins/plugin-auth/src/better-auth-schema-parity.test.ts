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
 * `@better-auth/sso` / `@better-auth/scim` are excluded from the call above
 * for a narrower reason than this header used to give. The previous wording —
 * "accept no `schema` option, so `getAuthTables()` cannot see them" — was
 * measured false and is corrected here (#8224). Re-measured 2026-08-19 against
 * the installed `@better-auth/sso@1.7.1` / `@better-auth/scim@1.7.0-rc.1` (the
 * 2026-08-18 stamp this block carried named `sso@1.7.0-rc.2`, a pin that has
 * since moved — the very drift this card is about):
 *
 *  - Both DECLARE a schema `getAuthTables()` reads. Passing `sso()` yields the
 *    `ssoProvider` model; `scim({})` yields `scimProvider` plus the four
 *    `scimGroup*` models. The library is not hiding them.
 *  - `@better-auth/sso` also ACCEPTS a `schema` option now:
 *    `SSOOptions.schema.ssoProvider.{modelName,fields,additionalFields}`, honoured
 *    at runtime (`modelName: options?.modelName ?? options?.schema?.ssoProvider
 *    ?.modelName ?? 'ssoProvider'`, plus a per-field `fieldName` fallback each).
 *    `@better-auth/scim` still accepts none — `SCIMOptions` declares no
 *    `schema` / `modelName` / `fields` — so that half of the old sentence
 *    survives for scim alone.
 *  - What holds for both, and is the actual reason: **the auth manager passes
 *    them no `schema` option.** Their models are bridged at the ADAPTER layer
 *    instead (`AUTH_MODEL_TO_PROTOCOL` + a mechanical camelCase → snake_case in
 *    `objectql-adapter.ts`). So the column `sso` really writes is `oidc_config`,
 *    while `getAuthTables()` — given no `fields` mapping — reports `oidcConfig`
 *    under a model name (`ssoProvider`) that is not a platform object name
 *    (`sys_sso_provider`). Deriving them above would compare a column nothing
 *    writes against a table nothing provisions, and fail on both counts.
 *
 * The second describe block below is what covers them, by reading each plugin's
 * OWN declared schema and resolving columns the way the ADAPTER does for a
 * bridged model — the rule that actually governs their writes (#3653). Their
 * `skip` reasons in {@link AUTH_MANAGER_PLUGINS} carry the same statement, and
 * the "excluded for the reason this file states" assertion in that block pins
 * it, so this rationale cannot expire silently a second time.
 *
 * ## The plugin set is reconciled against `auth-manager.ts` (#8122)
 *
 * The list this gate derives from used to be six factories written out by
 * hand and reconciled against nothing, while its sibling `managed-extension-
 * fields.test.ts` (ADR-0092 D7) had carried a drift tripwire since #7820. Both
 * now account for every factory `auth-manager.ts` can assemble: an entry either
 * carries a `construct` thunk or a written `skip` reason, and an unaccounted
 * factory fails {@link AUTH_MANAGER_PLUGINS}'s reconciliation. Note what that
 * does and does not buy — it catches a plugin arriving in `auth-manager.ts`
 * unaccounted for, which is one drift path into this gate, not every one.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAuthTables } from 'better-auth/db';
import { organization, twoFactor, admin } from 'better-auth/plugins';
import { bearer } from 'better-auth/plugins/bearer';
import { customSession } from 'better-auth/plugins/custom-session';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { magicLink } from 'better-auth/plugins/magic-link';
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
 * Locate this package by walking up from the CWD — the idiom
 * `rate-limit-storage-isolation.test.ts` established here and states the reason
 * for: plugin-auth is CJS-typed (no `"type": "module"`, it publishes
 * `dist/index.js` as CommonJS), so under `module: NodeNext` `import.meta` is a
 * TS1470 in this package however well it runs under vitest. Measured on this
 * change: seeding from `import.meta.url` instead adds exactly that error to the
 * package's shrink-only TEST_DEBT count (111 → 112), which is the gate saying
 * the same thing.
 */
function findUp(predicate: (dir: string) => boolean, what: string): string {
  let dir = process.cwd();
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${what}`);
    dir = parent;
  }
}

const PKG = findUp((dir) => {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
  return name === '@objectstack/plugin-auth';
}, 'the @objectstack/plugin-auth package root');

/**
 * Every better-auth plugin factory `auth-manager.ts` can assemble, keyed by the
 * name it imports, with how this gate accounts for it (#8122).
 *
 * The plugin SET is derived from this map rather than written beside it, which
 * is what makes the accounting real: an entry carrying a `construct` IS in the
 * derived surface, because that thunk is what builds it. There is no way to
 * declare a plugin covered and not load it. `skip` is the other disposition and
 * costs a written reason; "it is off by default" is not one — the column has to
 * exist before the flag can be turned on, which is why the feature-flagged-off
 * plugins below are all constructed.
 *
 * Several contribute no model surface at all on the pinned version — measured
 * 2026-08-18, `bearer` / `haveIBeenPwned` / `magicLink` / `genericOAuth` /
 * `customSession` each add no model and no column to the derived tables. They
 * are constructed anyway, so the set is "what the auth manager loads" rather
 * than "what someone judged relevant", and a version bump that gives one of
 * them a column is compared against the platform object the day it lands.
 *
 * ⛔ This map is deliberately NOT shared with `managed-extension-fields.test.ts`
 * (ADR-0092 D7), which keeps its own. The two gates ask opposite questions of
 * the same function and the map is where they diverge, twice over:
 *
 *  - **Construction.** This gate passes the `schema:` options from
 *    `auth-schema-config.ts`, because it resolves the exact COLUMN better-auth
 *    writes and needs our `fields` mappings. D7 must NOT: those options carry
 *    ADR-0105 D8 `additionalFields`, which are ours, and feeding them in makes
 *    D7 report us colliding with ourselves. Its own header pins that.
 *  - **Disposition.** `sso` / `scim` / `oauthProvider` are `construct` there and
 *    `skip` here — see their reasons below. Merging the maps would force one
 *    answer where the two gates measurably need different ones.
 *
 * What IS shared is the RECONCILIATION: the source scan below and the assertion
 * that consumes it are the same shape as D7's, deliberately duplicated rather
 * than abstracted over two callers that disagree about their input. Each copy
 * carries its own `stale` half, so a scan blinded by an import-shape change
 * fails in the file it blinded rather than only in the other one.
 */
const AUTH_MANAGER_PLUGINS: Record<string, { construct: () => unknown } | { skip: string }> = {
  bearer: { construct: () => bearer() },
  // `teams.enabled` mirrors the auth-manager default. Without it the team
  // models drop out of the surface entirely and this gate would have gone
  // green through #3624 — the exact hole being closed.
  organization: {
    construct: () => organization({ teams: { enabled: true }, schema: buildOrganizationPluginSchema() }),
  },
  twoFactor: { construct: () => twoFactor({ schema: buildTwoFactorPluginSchema() }) },
  haveIBeenPwned: { construct: () => haveIBeenPwned() },
  admin: { construct: () => admin({ schema: buildAdminPluginSchema() }) },
  phoneNumber: { construct: () => phoneNumber({ schema: buildPhoneNumberPluginSchema() }) },
  // The callbacks below are required by their constructors and never invoked:
  // this gate only reads the schema each plugin declares.
  magicLink: { construct: () => magicLink({ sendMagicLink: async () => undefined }) },
  genericOAuth: { construct: () => genericOAuth({ config: [] }) },
  jwt: { construct: () => jwt({ schema: buildJwtPluginSchema() }) },
  deviceAuthorization: {
    construct: () => deviceAuthorization({ schema: buildDeviceAuthorizationPluginSchema() }),
  },
  customSession: {
    construct: () =>
      customSession(async ({ user, session }: { user: unknown; session: unknown }) => ({
        user,
        session,
      })),
  },
  sso: {
    skip:
      'the auth manager passes it no `schema` option, so getAuthTables() would report its model as '
      + '`ssoProvider` with camelCase columns while the adapter bridge writes `sys_sso_provider` in '
      + 'snake_case — covered by the dedicated sso/scim block below, which reproduces the adapter '
      + 'rule that governs its writes. NOT because it accepts no schema option: it does, on the '
      + 'installed 1.7.1 (measured 2026-08-19, #8224). See the file header.',
  },
  scim: {
    skip:
      'same adapter bridge as sso and the same dedicated block below. `SCIMOptions` additionally '
      + 'still declares no `schema` / `modelName` / `fields` option at all on 1.7.0-rc.1, so there '
      + 'is nothing to pass it even if the bridge moved onto the plugin option.',
  },
  oauthProvider: {
    skip:
      'ships as its own package on its own pinned version and has the dedicated '
      + 'oauth-provider-schema-parity.test.ts covering its column surface — the gate this file '
      + 'generalizes rather than replaces.',
  },
  // [#8289] NOT a plugin factory — the scanner's regex cannot tell the two
  // apart, because both are a one-name destructure off `better-auth/plugins/*`.
  // `hasPermission` is the organization plugin's exported permission PREDICATE;
  // it declares no schema, so it contributes no model and no column for this
  // gate to compare. The `stale` assertion below removes this entry's licence
  // the moment that import goes away.
  hasPermission: {
    skip: 'permission predicate exported by the organization plugin — declares no schema',
  },
  // [#10069] NOT a plugin factory either — same scanner shape as
  // `hasPermission` above. `defaultRoles` is the admin plugin's exported
  // role→AccessControl map (`better-auth/plugins/admin/access`); it declares no
  // schema, so it contributes no model and no column for this gate to compare.
  // `assertAdminRevokeUserSessionIdentifiesRecord` reads it so the
  // admin-revoke-user-session gate asks the vendor's own permission question
  // (its `hasPermission` fallback roles) rather than keeping a second spelling
  // of it. The `stale` assertion below removes this entry's licence the moment
  // that import goes away.
  defaultRoles: {
    skip: 'role→AccessControl map exported by the admin plugin — declares no schema',
  },
};

/** The plugin set the auth manager actually assembles (`buildPluginList()`). */
function betterAuthPluginSet(): unknown[] {
  return Object.values(AUTH_MANAGER_PLUGINS)
    .filter((entry): entry is { construct: () => unknown } => 'construct' in entry)
    .map((entry) => entry.construct());
}

/**
 * The better-auth plugin factories `auth-manager.ts` imports, scanned from its
 * source.
 *
 * Scanned rather than imported for the reason its twin in
 * `managed-extension-fields.test.ts` records: the auth manager builds its list
 * behind feature flags inside an async method, so there is no value to import
 * that names the SET. Reading the file is the only way to ask "which plugins can
 * this process load" without booting one — and this file must not edit
 * `auth-manager.ts` to make it exportable, which would put the answer under the
 * control of the thing being audited.
 *
 * `@better-auth/core/*` is excluded: those are runtime utilities
 * (`runWithRequestState`, `isPublicRoutableHost`), not plugin factories, and
 * they declare no schema.
 */
function authManagerPluginFactories(): string[] {
  const source = readFileSync(join(PKG, 'src', 'auth-manager.ts'), 'utf8');
  const found = new Set<string>();
  const pattern =
    /const\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*=\s*await import\('((?:better-auth\/plugins|@better-auth\/)[^']*)'\)/g;
  for (const [, name, specifier] of source.matchAll(pattern)) {
    if (specifier.startsWith('@better-auth/core')) continue;
    found.add(name);
  }
  return [...found].sort();
}

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
    plugins: betterAuthPluginSet(),
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

  it('every plugin auth-manager.ts can load is accounted for here (#8122)', () => {
    // The tripwire this gate shipped without. Its plugin list was six factories
    // written out by hand and reconciled against nothing, so the next plugin
    // added to `auth-manager.ts` would own columns on tables this gate never
    // compared — silently, with every assertion above still green. The sibling
    // D7 gate has had this shape since #7820.
    //
    // ⚠️ Scope it honestly: this catches a factory arriving in
    // `auth-manager.ts` unaccounted for. It does not catch a plugin loaded from
    // somewhere else, and it is not a general detector for hand-written lists.
    const imported = authManagerPluginFactories();
    const declared = Object.keys(AUTH_MANAGER_PLUGINS).sort();

    const unaccounted = imported.filter((name) => AUTH_MANAGER_PLUGINS[name] === undefined);
    expect(
      unaccounted,
      `auth-manager.ts imports better-auth plugin factories this gate does not account for: `
      + `${unaccounted.join(', ')}. A plugin the auth manager can assemble writes columns on the `
      + `tables this gate provisions, so leaving it out means the derived surface is narrower than `
      + `the one a booted environment gets — an unprovisioned column then reaches production as a `
      + `500 instead of a red gate (#3624). Add it to AUTH_MANAGER_PLUGINS with a construct thunk, `
      + `passing the schema: options auth-manager.ts passes — or, if its columns are decided `
      + `somewhere this call cannot see, with a skip reason naming what covers them instead. "It is `
      + `off by default" is NOT a reason: the column has to exist before the flag can be turned on.`,
    ).toEqual([]);

    const stale = declared.filter((name) => !imported.includes(name));
    expect(
      stale,
      `AUTH_MANAGER_PLUGINS names plugins auth-manager.ts no longer imports: ${stale.join(', ')}. `
      + `Either the plugin was dropped (remove its entry) or the import shape changed and this scan `
      + `is now blind — check authManagerPluginFactories() against the real import sites before `
      + `deleting anything.`,
    ).toEqual([]);

    // A skip is a decision, so it costs a sentence. `construct` needs no such
    // check: it cannot claim coverage it does not deliver, because the thunk IS
    // what builds the derived surface.
    for (const [name, entry] of Object.entries(AUTH_MANAGER_PLUGINS)) {
      if ('skip' in entry) {
        expect(entry.skip.length, `${name} is skipped but carries no reason`).toBeGreaterThan(20);
      }
    }
    // The surface really is built from the map — otherwise the reconciliation
    // above would be auditing a list nothing reads.
    expect(betterAuthPluginSet().length).toBe(
      Object.values(AUTH_MANAGER_PLUGINS).filter((entry) => 'construct' in entry).length,
    );
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
 * The auth manager passes these two no `schema` option, so `getAuthTables()`
 * above is given no way to report their tables or columns as ObjectStack
 * writes them — not, as this file used to say, because they accept no such
 * option (false for sso on the pinned version, #8224; see the file header for
 * the measurement). The adapter bridges them instead: `AUTH_MODEL_TO_PROTOCOL`
 * maps the model, and `createObjectQLAdapterFactory` mechanically
 * camelCase→snake_cases every field of a bridged model on the way in. That
 * mechanical rule — not any hand-written mapping — is what decides the column
 * they actually write, so it is what this reproduces.
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

  it('are excluded from the getAuthTables() call for the reason this file states (#8122)', () => {
    // The rationale as an executable statement rather than prose. The previous
    // wording expired silently under a version bump with every gate green
    // (#8224) — the drift shape the reconciliation above exists to stop, so the
    // reason these two sit outside that reconciliation is pinned here instead.
    const derived = getAuthTables({ plugins: [sso(), scim({} as never)] } as never) as Record<
      string,
      { modelName?: string; fields?: Record<string, { fieldName?: string }> }
    >;

    // 1. getAuthTables() DOES see them — "cannot see them" was never the reason.
    expect(Object.keys(derived)).toContain('ssoProvider');
    expect(Object.keys(derived)).toContain('scimProvider');

    // 2. …but under better-auth's own model name, which is not the platform
    //    object name, because the auth manager passes no `schema.modelName`.
    //    The bridge lives at the adapter layer (AUTH_MODEL_TO_PROTOCOL).
    expect(derived.ssoProvider?.modelName ?? 'ssoProvider').toBe('ssoProvider');
    expect(PLATFORM_OBJECTS.ssoProvider).toBeUndefined();
    expect(PLATFORM_OBJECTS[resolveProtocolName('ssoProvider')]).toBeDefined();

    // 3. …and with camelCase columns, because no `fields` mapping is passed,
    //    while the adapter writes snake_case. Deriving these two through the
    //    call above would compare a column nothing writes.
    const ssoColumns = Object.entries(derived.ssoProvider?.fields ?? {})
      .map(([key, field]) => field.fieldName ?? key);
    expect(ssoColumns).toContain('oidcConfig');
    expect(ssoColumns).not.toContain('oidc_config');
    expect(adapterColumn('oidcConfig')).toBe('oidc_config');
  });

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
          + 'The auth manager passes these plugins no schema option, so the adapter snake_cases '
          + 'their fields mechanically; there is no mapping to add, only the column.',
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
