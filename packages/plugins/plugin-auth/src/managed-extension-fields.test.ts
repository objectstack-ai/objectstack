// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D7] Collision guard for extension fields on better-auth-managed
 * objects.
 *
 * Extending a better-auth table is established practice (`sys_user.manager_id`,
 * `sys_organization.require_mfa`, and now the D6 group-structure fields). The
 * hazard is a NAME COLLISION: if a better-auth upgrade introduces a field with
 * the same name, ownership of that column silently changes hands — our writes
 * start clobbering better-auth state, or better-auth's start clobbering ours,
 * with no error anywhere and no test failing.
 *
 * So the guard derives better-auth's REAL field surface from `getAuthTables()`
 * at the pinned version, rather than trusting a hand-maintained list, and fails
 * on any overlap. The upgrade that would cause the collision is the moment
 * someone finds out.
 *
 * ## The absence that used to read as coverage (#7770)
 *
 * The derivation is keyed by `MODEL_TO_OBJECT`, and the collision loop skipped
 * any object that map does not produce — `if (!owned) continue`. So an object
 * declaring `managedBy: 'better-auth'` but missing from the map got ZERO
 * collision coverage while looking covered from the outside, and adding an
 * extension field to it would never have been checked by anything.
 * `sys_api_key` was in exactly that position from the moment #7727 gave it its
 * first `MANAGED_EXTENSION_FIELDS` entry.
 *
 * Absence is now accounted for in both directions, on the
 * `SINGLE_RECORD_WRITE_ONLY` pattern (`packages/spec/src/data/
 * api-methods-batch-conformance.test.ts`):
 *
 *  - every object declaring `managedBy: 'better-auth'` anywhere under
 *    `packages/` is either mapped in `MODEL_TO_OBJECT` or registered in
 *    {@link UNMAPPED_MANAGED_OBJECTS} with the reason it is not;
 *  - an unmapped object may carry declared extension fields only when
 *    better-auth owns no column on that table at all (`noBetterAuthColumns`) —
 *    otherwise the fields are unchecked and the gate says so;
 *  - a registry entry that stopped describing a real, still-unmapped
 *    better-auth object fails as stale, so the exemption list cannot rot into
 *    documentation of nothing.
 *
 * ## The second axis: the plugins the derivation loads (#7820)
 *
 * The absence above was about OBJECTS the map skips. The same blindness has a
 * second axis — COLUMNS the derivation skips because the plugin that owns them
 * was never loaded. `getAuthTables()` used to be called here with `organization`
 * alone while the auth manager assembles fourteen plugin factories, so for a
 * fully MAPPED object like `sys_user` the guard was still comparing against a
 * fraction of better-auth's real surface and answering green about the rest.
 *
 * It is now called with the auth manager's whole set, adopting the reason
 * `better-auth-schema-parity.test.ts` already records for doing the same:
 *
 *   > Plugins that are feature-flagged off in some deployments are still
 *   > included: the column has to exist before the flag can be turned on.
 *
 * A flag is a deployment choice, not a schema fact. `phoneNumber` is opt-in and
 * owns `sys_user.phone_number` in every deployment that turns it on, so a guard
 * that only looks at the default set is not answering the ownership question at
 * all. Widening it produced exactly one live collision — `sys_user.phone_number`,
 * declared as an ObjectStack extension field while `auth-schema-config.ts` had
 * shipped the `phoneNumber → phone_number` mapping since #2766. The maintainer
 * ruled the column better-auth's on 2026-08-12 and it left
 * `MANAGED_EXTENSION_FIELDS` in the same change.
 *
 * Two things keep the widening from silently rotting back, because "green after
 * the removal" alone would prove only that today's case passes:
 *
 *  - the auth-manager DRIFT TRIPWIRE below scans `auth-manager.ts` for the
 *    plugin factories it imports and fails when one of them is not accounted
 *    for here, so a plugin added there cannot quietly stay outside the guard;
 *  - `findCollisions()` is a pure function, exercised against a SYNTHETIC
 *    registry that declares a column only a widened plugin contributes — so the
 *    red direction is pinned in-repo, not merely asserted in a PR description.
 *
 * ## The third axis: mapping what the widening made derivable (#7994)
 *
 * Widening the plugin set had a consequence #7820 did not spend: the models
 * `twoFactor` / `jwks` / `deviceCode` started being derived, while their three
 * objects stayed in `UNMAPPED_MANAGED_OBJECTS`. The exemptions outlived their
 * granted reason — registered because the plugins "are not loaded by this
 * call", which had become false — and were restated once in place on the
 * weaker reason that the models were merely unmapped. An exemption whose
 * justification has to be rewritten to survive is a smell, not a record.
 *
 * The 2026-08-12 ruling mapped all three and retired the exemptions, taking
 * coverage from nine objects to twelve, and explicitly amended the #7820
 * ruling's 「保持不动」 line to have scoped that card only. `sys_two_factor`
 * and `sys_jwks` hold credential material (`secret`, `privateKey`), which is
 * precisely the kind of column D7 exists to stop an extension field from
 * silently taking ownership of.
 *
 * Its acceptance criterion is the one that matters for any coverage change,
 * and is worth copying: not "the map has twelve entries" — a count derived
 * from the structure it checks, which cannot fail — but a SYNTHETIC COLLISION
 * PER TABLE that must turn this suite red, and does not when the mapping is
 * removed. That is the last describe block but one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getAuthTables } from 'better-auth/db';
import { jwt } from 'better-auth/plugins';
import { admin } from 'better-auth/plugins/admin';
import { bearer } from 'better-auth/plugins/bearer';
import { customSession } from 'better-auth/plugins/custom-session';
import { deviceAuthorization } from 'better-auth/plugins/device-authorization';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { phoneNumber } from 'better-auth/plugins/phone-number';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { oauthProvider } from '@better-auth/oauth-provider';
import { scim } from '@better-auth/scim';
import { sso } from '@better-auth/sso';

import {
  MANAGED_EXTENSION_FIELDS,
  MANAGED_EXTENSION_EDITABLE_FIELDS,
  managedExtensionFields,
  managedExtensionEditableFields,
} from './managed-extension-fields.js';

/** better-auth model name → the ObjectStack object it materializes as. */
const MODEL_TO_OBJECT: Record<string, string> = {
  user: 'sys_user',
  session: 'sys_session',
  account: 'sys_account',
  verification: 'sys_verification',
  organization: 'sys_organization',
  member: 'sys_member',
  invitation: 'sys_invitation',
  team: 'sys_team',
  teamMember: 'sys_team_member',
  // The three opt-in-plugin models #7770 exempted and the 2026-08-12 ruling
  // mapped (#7994). Each is derivable only because #7820 widened the plugin
  // set above to everything `auth-manager.ts` can assemble: `twoFactor()`,
  // `jwt()` and `deviceAuthorization()` are the plugins that contribute them,
  // so deleting any of those from AUTH_MANAGER_PLUGINS silently withdraws the
  // object from the collision loop again. Both halves are pinned — the
  // coverage assertion below, and a per-table synthetic collision at the
  // bottom of this file.
  twoFactor: 'sys_two_factor',
  jwks: 'sys_jwks',
  deviceCode: 'sys_device_code',
};

interface UnmappedManagedObject {
  /** Why this object is deliberately absent from `MODEL_TO_OBJECT`. */
  reason: string;
  /**
   * Set ONLY when better-auth owns no column on this table at the pinned
   * version — i.e. the table is ours end to end and an extension field on it
   * cannot collide with anything. This is what makes it safe for an unmapped
   * object to carry `MANAGED_EXTENSION_FIELDS` entries; without it, declared
   * fields on an unmapped object fail the "nothing is silently skipped"
   * assertion below.
   *
   * A claim this strong needs its own tripwire, not just a sentence — see the
   * `sys_api_key` premise test at the bottom of this file.
   */
  noBetterAuthColumns?: true;
}

/**
 * Objects that declare `managedBy: 'better-auth'` and are deliberately NOT in
 * `MODEL_TO_OBJECT`, keyed by object name with the reason.
 *
 * Adding an entry is a real decision: an unmapped object gets no D7 collision
 * coverage at all, so the reason has to say why that is the right answer for
 * this table rather than an oversight. `managedBy` alone does not mean
 * better-auth's core `getAuthTables()` surface owns the columns — a plugin may
 * be opt-in, ship in its own package, or (for sso/scim) be passed no `schema`
 * option by the auth manager, leaving this call no mapping to key off.
 */
const UNMAPPED_MANAGED_OBJECTS: Record<string, UnmappedManagedObject> = {
  sys_api_key: {
    // The one entry that carries declared extension fields, so the one whose
    // reason has to be a statement about better-auth rather than about scope.
    reason:
      'Hand-rolled ObjectStack table, not a better-auth model at all. '
      + '`packages/core/src/security/api-key.ts` mints and verifies the key and POST /api/v1/keys '
      + 'writes the row, and better-auth ships NO apiKey plugin — measured 2026-08-20 against '
      + 'the installed 1.7.1: package.json declares no "./plugins/api-key" export subpath and '
      + 'importing "better-auth/plugins" yields apiKey === undefined (bearer and admin are '
      + 'functions in the same import, so the read is not a silent miss). '
      + 'So no model exists to derive and no column on this table can change hands. '
      + 'Pinned by the premise test at the bottom of this file (#7770).',
    noBetterAuthColumns: true,
  },

  // ── sys_two_factor / sys_jwks / sys_device_code are NO LONGER HERE ────────
  // #7770 exempted all three because this file's getAuthTables() call did not
  // load their plugins. #7820 widened the call, which made that reason false,
  // and the exemptions survived one restatement on a weaker reason: the models
  // were derived, merely unmapped. The 2026-08-12 ruling (#7994) ended that —
  // 「map twoFactor / jwks / deviceCode into MODEL_TO_OBJECT, add the three
  // COVERED_OBJECTS entries, and retire their three #7770 exemptions」 —
  // explicitly amending the #7820 ruling's 「保持不动」 line to have scoped
  // that card only. Coverage went 9 → 12 objects.
  //
  // ⛔ Do not re-add them here to silence a failure. An exemption is what makes
  // the collision loop skip a table, and these three hold credential-adjacent
  // columns (`twoFactor.secret`, `jwks.privateKey`): re-exempting reopens
  // exactly the invisible-hole shape #7770 was filed for. If the real fix is
  // to stop deriving one of them, remove its plugin from AUTH_MANAGER_PLUGINS
  // and say why — the coverage assertion will then demand this list change too.

  // ── Plugins getAuthTables() cannot ADDRESS as an ObjectStack object (#3653) ─
  // Both plugins are now in the call (#7820), so their models do appear in the
  // derived tables — under better-auth's own names (`ssoProvider`,
  // `scimProvider`, …). The MAPPING is what this call cannot reach: the auth
  // manager passes neither plugin a `schema` option, so nothing tells
  // getAuthTables() that `ssoProvider` materializes as `sys_sso_provider`,
  // MODEL_TO_OBJECT cannot key off anything the library reports, and the
  // derivation has nothing to compare against the object.
  //
  // Note the reason above is about what the auth manager PASSES, not about what
  // the plugins ACCEPT — the two were conflated here until #8224. Measured
  // 2026-08-19: `@better-auth/sso@1.7.1` does accept a `schema` option
  // (`SSOOptions.schema.ssoProvider`), so passing one is a live option rather
  // than something the dependency forbids; `@better-auth/scim@1.7.0-rc.1` still
  // accepts none.
  sys_sso_provider: {
    reason:
      'The auth manager passes @better-auth/sso no `schema` option, so getAuthTables() reports its '
      + "models only under better-auth's own names and they cannot be mapped onto this object (#3653). "
      + '(The plugin DOES accept one as of 1.7.1 — measured 2026-08-19, #8224; it is simply not passed.) '
      + 'Its columns are '
      + 'bridged mechanically by objectql-adapter.ts and gated by the dedicated sso/scim block in '
      + 'better-auth-schema-parity.test.ts.',
  },
  sys_scim_provider: {
    reason:
      '@better-auth/scim accepts no `schema` option at all (measured 2026-08-19 against the installed '
      + '1.7.0-rc.1, and the auth manager passes none either), so getAuthTables() reports its models '
      + "only under better-auth's own names and they cannot be mapped onto this object (#3653). Same bridge and "
      + 'same dedicated gate as sys_sso_provider.',
  },

  // ── @better-auth/oauth-provider — separate package, dedicated gate ────────
  // Excluded here for exactly the reason better-auth-schema-parity.test.ts
  // excludes it: it ships as its own package on its own pinned version and has
  // oauth-provider-schema-parity.test.ts covering its column surface.
  sys_oauth_application: { reason: '@better-auth/oauth-provider — separate package, covered by oauth-provider-schema-parity.test.ts.' },
  sys_oauth_access_token: { reason: '@better-auth/oauth-provider — separate package, covered by oauth-provider-schema-parity.test.ts.' },
  sys_oauth_refresh_token: { reason: '@better-auth/oauth-provider — separate package, covered by oauth-provider-schema-parity.test.ts.' },
  sys_oauth_consent: { reason: '@better-auth/oauth-provider — separate package, covered by oauth-provider-schema-parity.test.ts.' },
  sys_oauth_resource: { reason: '@better-auth/oauth-provider — separate package, covered by oauth-provider-schema-parity.test.ts.' },
  sys_oauth_client_resource: { reason: '@better-auth/oauth-provider — separate package, covered by oauth-provider-schema-parity.test.ts.' },
  sys_oauth_client_assertion: { reason: '@better-auth/oauth-provider — separate package, covered by oauth-provider-schema-parity.test.ts.' },
};

/** The objects `MODEL_TO_OBJECT` maps right now — the live skip criterion. */
const MAPPED_OBJECTS: readonly string[] = Object.values(MODEL_TO_OBJECT);

/**
 * The twelve objects this guard has real collision coverage for, written out as
 * a LITERAL rather than derived from `MODEL_TO_OBJECT`.
 *
 * Deriving it would have made the pin below unable to see the regression it
 * exists for: deleting a mapping shrinks the derived surface and the expected
 * list together, so the assertion stays green while an object drops out of the
 * collision loop. Measured — an ablation that removed `teamMember` left a
 * derived version of this pin green and was caught only by the accounting
 * assertion. Two independent lists, so one of them has to be wrong out loud.
 *
 * ⚠️ This list is a COUNT, and a count certifies nothing on its own: it says
 * which objects the loop reaches, not that reaching them judges anything. The
 * assertion that the three objects added in #7994 are really judged is the
 * per-table synthetic collision at the bottom of this file, which fails the
 * moment a mapping is deleted.
 */
const COVERED_OBJECTS: readonly string[] = [
  'sys_user',
  'sys_session',
  'sys_account',
  'sys_verification',
  'sys_organization',
  'sys_member',
  'sys_invitation',
  'sys_team',
  'sys_team_member',
  // #7994 — the three opt-in-plugin tables, mapped by the 2026-08-12 ruling.
  'sys_two_factor',
  'sys_jwks',
  'sys_device_code',
];

/**
 * Seeded from `__dirname`, not from `dirname(fileURLToPath(import.meta.url))`,
 * and both halves of that choice are load-bearing — the same pair
 * `platform-objects/src/managed-api-method-affordance-sweep.test.ts` states for
 * the sibling repo-wide walk:
 *
 *  - `import.meta` is a TS1470 here. This package is CJS-typed (no
 *    `"type": "module"`, it publishes `dist/index.js` as CommonJS), so under
 *    `module: NodeNext` the meta-property is an error however well it runs
 *    under vitest — and this package's test layer IS in front of tsc, through
 *    the `@objectstack/plugin-auth` TEST_DEBT entry
 *    in `check-type-check-coverage.mjs` under `scripts/`, a ledger that may
 *    only shrink.
 *    `__dirname` type-checks under the package's own config and is defined at
 *    runtime by vitest's transform (verified, not assumed).
 *  - `check:cross-package-test-inputs` recognises exactly two seeds —
 *    `dirname(fileURLToPath(import.meta.url))` and `__dirname` — when it
 *    detects statically that a test escapes its package. This file's walk of
 *    `PACKAGES_DIR` below is the ONLY escaping read the gate can see in
 *    plugin-auth, so it is what holds the package's declared radius
 *    (`packages/**\/*.object.ts`) and the matching `turbo.json` inputs.
 *    Deriving the root any other way — the `findUp` walk from `process.cwd()`
 *    that `rate-limit-storage-isolation.test.ts` and
 *    `member-role-canonical.test.ts` use — makes this radius INVISIBLE to that
 *    gate, which then reports the declaration as stale and asks for its
 *    removal. Losing it would put this sweep back in #7802's blind spot:
 *    turbo would replay a cached green for a diff that changed another
 *    package's object file. Measured both ways.
 */
const HERE = __dirname;
/** …/packages/plugins/plugin-auth/src → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** Every `*.object.ts` under `packages/`, skipping build output and deps. */
function walkObjectFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkObjectFiles(full, out);
    else if (entry.endsWith('.object.ts')) out.push(full);
  }
  return out;
}

/**
 * Every object declaring `managedBy: 'better-auth'`, scanned from source under
 * `packages/`.
 *
 * Scanning rather than importing is deliberate, and is the lesson
 * `api-methods-batch-conformance.test.ts` was written from: an audit whose
 * scope is a package name misses the declaration that lands in a package
 * nobody thought to open. Every such object is in `platform-objects/identity`
 * today; nothing makes that permanent.
 *
 * The `managedBy` match is anchored to the start of a line so a prose mention
 * in a comment (`sys_team.object.ts` has one) cannot be read as a declaration.
 */
function declaredBetterAuthObjects(): Array<{ object: string; file: string }> {
  const out: Array<{ object: string; file: string }> = [];
  for (const file of walkObjectFiles(PACKAGES_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (!/^[ \t]*managedBy:\s*'better-auth'\s*,?\s*$/m.test(source)) continue;
    const object = source.match(
      /ObjectSchema\.create\(\{[\s\S]{0,600}?name:\s*'([a-z0-9_]+)'/,
    )?.[1];
    if (object) out.push({ object, file: file.slice(REPO_ROOT.length + 1) });
  }
  return out;
}

/** better-auth authors fields in camelCase; ObjectStack columns are snake_case. */
function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Every better-auth plugin factory `auth-manager.ts` can assemble, keyed by the
 * name it imports, with how this guard accounts for it.
 *
 * The plugin SET is derived from this map rather than written beside it, which
 * is what makes the accounting real: an entry carrying a `construct` IS in the
 * derived surface, because that thunk is what builds it. There is no way to
 * declare a plugin covered and not load it — the failure a hand-kept pair of
 * lists invites. `skip` is the other disposition and costs a written reason;
 * "it is off by default" is not one, see the file header.
 *
 * Feature-flagged-off plugins are all constructed on the reason
 * `better-auth-schema-parity.test.ts` states for its own derivation: the column
 * has to exist before the flag can be turned on, so a deployment-time flag
 * cannot decide who owns a column. Several contribute no model surface at all
 * today (`bearer`, `haveIBeenPwned`, `magicLink` — which reuses `verification`
 * — `genericOAuth`, `customSession`); they are constructed anyway so the set is
 * "what the auth manager loads" rather than "what someone judged relevant", and
 * so a version bump that gives one of them a user column is seen here the day
 * it lands.
 *
 * ⛔ Do NOT add the `schema:` options from `auth-schema-config.ts` to make this
 * match the parity gate's call. The two gates want different things from the
 * same function: parity resolves the exact COLUMN better-auth writes, so it
 * needs our `fields` mappings; D7 asks whose column it is, and our schema
 * config carries `additionalFields` — the ADR-0105 D8 `businessUnitId` /
 * `positions` on `invitation` are ObjectStack's, declared through better-auth's
 * own extension seam. Feeding those in makes the derived "better-auth surface"
 * include our extension fields and the guard reports us colliding with
 * ourselves. Pinned by the `additionalFields` assertion below. The snake_case
 * half the mappings would provide is already covered: `toSnakeCase` records
 * both spellings.
 */
const AUTH_MANAGER_PLUGINS: Record<string, { construct: () => unknown } | { skip: string }> = {
  bearer: { construct: () => bearer() },
  // `teams: { enabled: true }` mirrors the auth-manager default. Without it
  // better-auth omits the team models entirely, so the sys_team /
  // sys_team_member entries below would be absent and any extension field added
  // to those objects would collide silently. (#3624)
  organization: { construct: () => organization({ teams: { enabled: true } }) },
  twoFactor: { construct: () => twoFactor() },
  haveIBeenPwned: { construct: () => haveIBeenPwned() },
  admin: { construct: () => admin() },
  // The callbacks below are required by their constructors and never invoked:
  // this file only reads the schema each plugin declares.
  phoneNumber: { construct: () => phoneNumber({ sendOTP: async () => undefined }) },
  magicLink: { construct: () => magicLink({ sendMagicLink: async () => undefined }) },
  genericOAuth: { construct: () => genericOAuth({ config: [] }) },
  jwt: { construct: () => jwt() },
  deviceAuthorization: { construct: () => deviceAuthorization() },
  customSession: {
    construct: () =>
      customSession(async ({ user, session }: { user: unknown; session: unknown }) => ({
        user,
        session,
      })),
  },
  sso: { construct: () => sso() },
  scim: { construct: () => scim() },
  // `loginPage` / `consentPage` are required by the constructor and are URLs
  // the auth manager resolves from the console mount point; nothing about the
  // schema depends on their value.
  oauthProvider: {
    construct: () => oauthProvider({ loginPage: '/login', consentPage: '/oauth/consent' }),
  },
  // [#8289] NOT a plugin factory — the scanner's regex cannot tell the two
  // apart, because both are a one-name destructure off `better-auth/plugins/*`.
  // `hasPermission` is the organization plugin's exported permission PREDICATE
  // (`(input, ctx) => Promise<boolean>`, `has-permission.mjs`); it declares no
  // schema, contributes no model and no column, so there is nothing here for
  // the collision loop to compare. `assertRemoveMemberPermitted` calls it so the
  // remove-member gate asks the vendor's own authorization question rather than
  // keeping a second spelling of it. The `stale` assertion below removes this
  // entry's licence the moment that import goes away.
  hasPermission: {
    skip: 'permission predicate exported by the organization plugin — declares no schema',
  },
  // [#10069] NOT a plugin factory either — same scanner shape as
  // `hasPermission` above. `defaultRoles` is the admin plugin's exported
  // role→AccessControl map (`better-auth/plugins/admin/access`); it declares no
  // schema, contributes no model and no column, so there is nothing here for
  // the collision loop to compare. `assertAdminRevokeUserSessionIdentifiesRecord`
  // reads it so the admin-revoke-user-session gate asks the vendor's own
  // permission question (its `hasPermission` fallback roles) rather than keeping
  // a second spelling of it. The `stale` assertion below removes this entry's
  // licence the moment that import goes away.
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
 * Every field better-auth owns, per ObjectStack object name, in BOTH spellings
 * — comparing only one would let `parentOrganizationId` slip past a check on
 * `parent_organization_id`.
 */
function betterAuthFieldsByObject(): Record<string, Set<string>> {
  const tables = getAuthTables({ plugins: betterAuthPluginSet() } as never);
  const out: Record<string, Set<string>> = {};
  for (const [model, table] of Object.entries(tables ?? {})) {
    const object = MODEL_TO_OBJECT[model];
    if (!object) continue;
    const names = new Set<string>();
    for (const field of Object.keys((table as { fields?: object }).fields ?? {})) {
      names.add(field);
      names.add(toSnakeCase(field));
    }
    // better-auth always owns the primary key, whatever the table.
    names.add('id');
    out[object] = names;
  }
  return out;
}

/**
 * The collision rule itself, as a pure function of the two surfaces.
 *
 * Extracted so the RED direction can be pinned with a synthetic registry
 * instead of only being observed once by whoever last ablated the file. The
 * real assertion calls it with `MANAGED_EXTENSION_FIELDS`; the synthetic-overlap
 * test calls it with a registry declaring a column that only a WIDENED plugin
 * contributes, which is the future case #7820 exists to make catchable.
 */
function findCollisions(
  registry: Readonly<Record<string, ReadonlySet<string>>>,
  byObject: Record<string, Set<string>>,
): string[] {
  const collisions: string[] = [];
  for (const [object, fields] of Object.entries(registry)) {
    const owned = byObject[object];
    // Accounted for by the "nothing is silently skipped" assertion — the loop
    // never passes on an object it simply could not derive.
    if (!owned) continue;
    for (const field of fields) {
      if (owned.has(field)) collisions.push(`${object}.${field}`);
    }
  }
  return collisions;
}

/**
 * The better-auth plugin factories `auth-manager.ts` imports, scanned from its
 * source.
 *
 * Scanned rather than imported for the same reason `declaredBetterAuthObjects()`
 * scans: the auth manager builds its list behind feature flags inside an async
 * method, so there is no value to import that names the SET. Reading the file is
 * the only way to ask "which plugins can this process load" without booting one
 * — and this file must not edit `auth-manager.ts` to make it exportable, which
 * would put the answer under the control of the thing being audited.
 *
 * `@better-auth/core/*` is excluded: those are runtime utilities
 * (`runWithRequestState`, `isPublicRoutableHost`), not plugin factories, and
 * they declare no schema.
 */
function authManagerPluginFactories(): string[] {
  const source = readFileSync(join(HERE, 'auth-manager.ts'), 'utf8');
  const found = new Set<string>();
  const pattern =
    /const\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*=\s*await import\('((?:better-auth\/plugins|@better-auth\/)[^']*)'\)/g;
  for (const [, name, specifier] of source.matchAll(pattern)) {
    if (specifier.startsWith('@better-auth/core')) continue;
    found.add(name);
  }
  return [...found].sort();
}

describe('managed extension fields (ADR-0105 D7)', () => {
  const byObject = betterAuthFieldsByObject();
  const managedObjects = declaredBetterAuthObjects();

  it('derives a non-empty better-auth surface (the guard must not pass vacuously)', () => {
    expect(Object.keys(byObject).length).toBeGreaterThan(0);
    expect(byObject.sys_organization?.size ?? 0).toBeGreaterThan(0);
    expect(byObject.sys_user?.size ?? 0).toBeGreaterThan(0);
  });

  it('keeps the twelve mapped models covered, exactly (coverage cannot shrink)', () => {
    // Two ways an object can silently withdraw from the collision loop, and
    // this pins both against the same literal: the LIBRARY stops emitting the
    // model, or the MAP stops naming it. Either is the #7770 shape arriving
    // as a regression rather than as a pre-existing absence.
    expect(
      [...MAPPED_OBJECTS].sort(),
      'MODEL_TO_OBJECT no longer maps exactly the twelve covered objects — a deleted mapping '
        + 'withdraws an object from the collision loop as surely as a missing one ever did.',
    ).toEqual([...COVERED_OBJECTS].sort());
    expect(
      Object.keys(byObject).sort(),
      'getAuthTables() no longer emits a model for every mapped object — the derived surface '
        + 'shrank underneath the map, so the objects it dropped are no longer being compared.',
    ).toEqual([...COVERED_OBJECTS].sort());
    for (const object of COVERED_OBJECTS) {
      expect(byObject[object]?.size ?? 0, `${object} derived an empty field set`).toBeGreaterThan(0);
    }
  });

  it('scans a plausible number of better-auth-managed objects (guards a silently empty sweep)', () => {
    // A scan that matches nothing passes the two assertions below vacuously —
    // the exact failure mode this file is being hardened against. Pin a floor.
    expect(managedObjects.length).toBeGreaterThan(15);
    expect(managedObjects.map((m) => m.object)).toContain('sys_api_key');
  });

  it("every better-auth-managed object is mapped or registered as deliberately unmapped (#7770)", () => {
    const unaccounted = managedObjects
      .filter(
        ({ object }) =>
          !MAPPED_OBJECTS.includes(object) && UNMAPPED_MANAGED_OBJECTS[object] === undefined,
      )
      .map(({ object, file }) => `${object} (${file})`);
    expect(
      unaccounted,
      `these objects declare managedBy: 'better-auth' but are absent from MODEL_TO_OBJECT, so this `
        + `guard skips them entirely and any extension field declared on them gets ZERO collision `
        + `coverage while reading as covered: ${unaccounted.join(', ')}. Pick one deliberately:\n`
        + `  (a) MAP IT — and it takes both halves, in this order: 1. make sure the plugin that owns `
        + `the model is in betterAuthPluginSet(), because a map entry alone derives no table and the `
        + `object stays silently skipped; 2. add the model: 'object_name' entry to MODEL_TO_OBJECT.\n`
        + `  (b) REGISTER IT in UNMAPPED_MANAGED_OBJECTS with the reason better-auth owns no `
        + `derivable surface for it here.\n`
        + `  Do NOT complete MANAGED_EXTENSION_FIELDS just to make the comparison look meaningful: `
        + `that map is also the ADR-0092 D2 write whitelist, so adding a column there widens what a `
        + `generic write surface may touch. On a credential table that is a security change, not a `
        + `test fix. Coverage of the columns better-auth itself owns is the parity gate's job `
        + `(better-auth-schema-parity.test.ts), not D7's.`,
    ).toEqual([]);
  });

  it('keeps the unmapped registry free of stale entries', () => {
    // An exemption that no longer describes a real, still-unmapped
    // better-auth object reads as a documented decision while documenting
    // nothing — the failure mode the exemption itself was meant to prevent.
    const declared = new Set(managedObjects.map((m) => m.object));
    const stale = Object.entries(UNMAPPED_MANAGED_OBJECTS)
      .filter(([object]) => !declared.has(object) || MAPPED_OBJECTS.includes(object))
      .map(([object]) =>
        declared.has(object)
          ? `${object} is now mapped in MODEL_TO_OBJECT — drop its exemption`
          : `${object} is no longer a declared managedBy: 'better-auth' object — drop its exemption`,
      );
    expect(stale, `stale UNMAPPED_MANAGED_OBJECTS entries: ${stale.join('; ')}`).toEqual([]);
  });

  it('no declared extension field is silently skipped by the collision check', () => {
    // The `if (!owned) continue` below is the whole #7770 defect when it is
    // unaccounted for: the loop passes, having compared nothing.
    const skipped = Object.keys(MANAGED_EXTENSION_FIELDS).filter((object) => !byObject[object]);
    const unaccounted = skipped.filter(
      (object) => UNMAPPED_MANAGED_OBJECTS[object]?.noBetterAuthColumns !== true,
    );
    expect(
      unaccounted,
      `these objects declare extension fields in MANAGED_EXTENSION_FIELDS but no better-auth `
        + `surface was derived for them, so the collision assertion skipped them and proved nothing `
        + `about their fields: ${unaccounted.join(', ')}. Either map the object (see the `
        + `two-step recipe in the previous assertion), or — only if better-auth genuinely owns no `
        + `column on that table at the pinned version — register it in UNMAPPED_MANAGED_OBJECTS `
        + `with noBetterAuthColumns: true and a tripwire that fails when that stops being true.`,
    ).toEqual([]);
    // Positive half: the objects that ARE compared are the ones we think.
    expect(Object.keys(MANAGED_EXTENSION_FIELDS).filter((object) => byObject[object]).sort())
      .toEqual(['sys_invitation', 'sys_organization', 'sys_user']);
  });

  it('no declared extension field collides with better-auth\'s own schema', () => {
    const collisions = findCollisions(MANAGED_EXTENSION_FIELDS, byObject);
    expect(
      collisions,
      `these extension fields collide with better-auth's own schema at the pinned version: ` +
        `${collisions.join(', ')} — better-auth now owns those columns, so ObjectStack must rename ` +
        `its field (and migrate) or drop the extension. Silently sharing a column means one side ` +
        `clobbers the other with no error.`,
    ).toEqual([]);
  });

  it('derives the columns the WIDENED plugin set contributes (#7820)', () => {
    // The half of the #7820 ruling that "green on today's removal" cannot
    // prove. Every name here is contributed by a plugin the derivation did NOT
    // load before this change, and every one is written as a LITERAL — not read
    // back out of the plugin list — so narrowing the list again cannot shrink
    // this expectation along with the surface it is meant to police. (That
    // co-moving shape is exactly how a sibling coverage pin stayed green while
    // a mapping was deleted underneath it.)
    const expected: Array<[string, string, string]> = [
      ['sys_user', 'two_factor_enabled', 'twoFactor'],
      ['sys_user', 'role', 'admin'],
      ['sys_user', 'banned', 'admin'],
      ['sys_user', 'ban_reason', 'admin'],
      ['sys_user', 'ban_expires', 'admin'],
      ['sys_user', 'phone_number', 'phoneNumber'],
      ['sys_user', 'phone_number_verified', 'phoneNumber'],
      ['sys_session', 'impersonated_by', 'admin'],
    ];
    const missing = expected
      .filter(([object, column]) => !byObject[object]?.has(column))
      .map(([object, column, plugin]) => `${object}.${column} (${plugin} plugin)`);
    expect(
      missing,
      `the derived better-auth surface no longer contains columns the auth manager's plugin set `
        + `owns: ${missing.join(', ')}. The plugin list in betterAuthPluginSet() was narrowed, so `
        + `this guard is back to answering green about columns it is not looking at — which is the `
        + `#7820 defect, not a passing test. Restore the plugin, or, if better-auth genuinely moved `
        + `the column, update this list and say where it went.`,
    ).toEqual([]);
  });

  it('derives better-auth\'s OWN surface, not our additionalFields (#7820)', () => {
    // The tempting "improvement" this blocks: passing the `schema:` options
    // from auth-schema-config.ts into betterAuthPluginSet() to match the parity
    // gate's call. Those carry ADR-0105 D8's `additionalFields`, which are
    // OURS, declared through better-auth's extension seam — derived that way,
    // the guard reports `sys_invitation.business_unit_id` and `.positions` as
    // better-auth-owned and demands we rename our own columns.
    for (const field of ['business_unit_id', 'positions']) {
      expect(
        byObject.sys_invitation?.has(field),
        `${field} is an ObjectStack extension field (ADR-0105 D8 placement intent) that appears in `
          + `getAuthTables() output only when our own schema overrides are passed in. It is in the `
          + `derived better-auth surface, so the derivation is no longer describing better-auth — `
          + `drop the schema: options from betterAuthPluginSet().`,
      ).toBe(false);
    }
    // Same claim from the other side: the mapped-through fields better-auth
    // really does own on that table are still derived.
    expect(byObject.sys_invitation?.has('inviter_id')).toBe(true);
  });

  it('every plugin auth-manager.ts can load is accounted for here (#7820)', () => {
    // The tripwire that keeps the widening wide. Without it the plugin list
    // above is a snapshot of one afternoon's auth manager, and the next plugin
    // added there re-opens the exact blind spot #7820 closed — silently,
    // because a plugin nobody loaded owns columns nobody compared.
    const imported = authManagerPluginFactories();
    const declared = Object.keys(AUTH_MANAGER_PLUGINS).sort();

    const unaccounted = imported.filter((name) => AUTH_MANAGER_PLUGINS[name] === undefined);
    expect(
      unaccounted,
      `auth-manager.ts imports better-auth plugin factories this guard does not account for: `
        + `${unaccounted.join(', ')}. A plugin the auth manager can assemble owns columns on the `
        + `tables this guard compares, so leaving it out means the derived surface is narrower than `
        + `the one a booted environment gets. Add it to AUTH_MANAGER_PLUGINS with a construct thunk `
        + `— or, if it genuinely declares no schema this call can read, with a skip reason. "It is `
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
    // The set really is built from the map — otherwise the reconciliation above
    // would be auditing a list nothing reads.
    expect(betterAuthPluginSet().length).toBe(
      Object.values(AUTH_MANAGER_PLUGINS).filter((entry) => 'construct' in entry).length,
    );
  });

  it('editable extension fields are a SUBSET of declared extension fields', () => {
    // Listing a field as ours must not be what makes it editable — the two
    // tiers are separate decisions (ADR-0092 D1).
    for (const [object, editable] of Object.entries(MANAGED_EXTENSION_EDITABLE_FIELDS)) {
      const declared = managedExtensionFields(object);
      for (const field of editable) {
        expect(declared.has(field), `${object}.${field} is editable but not declared`).toBe(true);
      }
    }
  });

  it('the ADR-0105 D6 group-structure fields are declared and editable', () => {
    expect(managedExtensionFields('sys_organization')).toContain('parent_organization_id');
    expect(managedExtensionEditableFields('sys_organization')).toContain('parent_organization_id');
    expect(managedExtensionEditableFields('sys_organization')).toContain('sort_order');
  });

  it('admin-surface-only sys_user fields are declared but NOT generically editable', () => {
    // `manager_id` / `ai_access` drive authorization and AI seating;
    // `primary_business_unit_id` is a projection plugin-sharing maintains.
    for (const field of ['manager_id', 'ai_access', 'primary_business_unit_id']) {
      expect(managedExtensionFields('sys_user')).toContain(field);
      expect(managedExtensionEditableFields('sys_user')).not.toContain(field);
    }
  });

  it('returns empty sets for an object with no extensions', () => {
    expect(managedExtensionFields('sys_session').size).toBe(0);
    expect(managedExtensionEditableFields('sys_session').size).toBe(0);
  });
});

describe('the collision rule goes red on a FUTURE overlap (#7820)', () => {
  // The ruling that widened the derivation states its post-condition in two
  // directions: green on the `sys_user.phone_number` removal, and genuinely red
  // on any new overlap. The first is the suite above. This is the second, and
  // it is a permanent pin rather than a one-off ablation someone ran once —
  // a widening that only makes today's case pass has implemented half of it.
  const byObject = betterAuthFieldsByObject();

  it('reports a column contributed by a WIDENED plugin as a collision', () => {
    // `two_factor_enabled` reaches the surface only through `twoFactor()`,
    // which the pre-#7820 derivation did not load — so under the old plugin set
    // this exact registry produced NO collision. That is the regression being
    // pinned, in the direction that matters.
    expect(
      findCollisions({ sys_user: new Set(['two_factor_enabled']) }, byObject),
    ).toEqual(['sys_user.two_factor_enabled']);
  });

  it('reports the camelCase spelling of the same column', () => {
    // better-auth authors `twoFactorEnabled`; a registry that happened to spell
    // it that way must not slip past a snake_case-only comparison.
    expect(
      findCollisions({ sys_user: new Set(['twoFactorEnabled']) }, byObject),
    ).toEqual(['sys_user.twoFactorEnabled']);
  });

  it('reports `phone_number` if it is ever re-declared as an extension field', () => {
    // The specific entry #7820 removed. Re-adding it must not be a quiet edit:
    // better-auth owns the column via `AUTH_PHONE_NUMBER_USER_FIELDS`, and the
    // real registry assertion above would go red — this states why.
    expect(
      findCollisions({ sys_user: new Set(['phone_number']) }, byObject),
    ).toEqual(['sys_user.phone_number']);
  });

  it('stays silent on a genuine extension field, so the pin is not vacuous', () => {
    // A rule that reported everything would satisfy the three tests above while
    // making the real assertion useless.
    expect(findCollisions({ sys_user: new Set(['manager_id']) }, byObject)).toEqual([]);
  });
});

describe('the three newly mapped tables are really judged (#7994)', () => {
  // The 2026-08-12 ruling's acceptance criterion, stated as tests rather than
  // as a count. "Coverage goes 9 → 12" is satisfied by the COVERED_OBJECTS pin
  // above — but that pin only proves the collision loop REACHES these tables.
  // What follows proves it JUDGES them: each case names a column better-auth
  // really owns on that table at the pinned version and requires the rule to
  // report it.
  //
  // These fail the moment a mapping is deleted, which is what makes them worth
  // having: with `twoFactor` out of MODEL_TO_OBJECT, `byObject.sys_two_factor`
  // is undefined, `findCollisions`'s `if (!owned) continue` swallows the
  // synthetic field, the call returns `[]` and every expectation here goes red.
  // (Verified by ablation before this landed, in both directions.)
  //
  // Deliberately driven through a SYNTHETIC registry rather than by adding
  // entries to `MANAGED_EXTENSION_FIELDS`: that map is also the ADR-0092 D2
  // write whitelist, so a column added there widens what a generic write
  // surface may touch. On `sys_two_factor.secret` or `sys_jwks.private_key`
  // that is a security change, and D7 coverage must never be bought with one.
  const byObject = betterAuthFieldsByObject();

  const OWNED: Array<[object_: string, snake: string, camel: string, plugin: string]> = [
    ['sys_two_factor', 'backup_codes', 'backupCodes', 'twoFactor'],
    ['sys_jwks', 'private_key', 'privateKey', 'jwt'],
    ['sys_device_code', 'user_code', 'userCode', 'deviceAuthorization'],
  ];

  for (const [object_, snake, camel, plugin] of OWNED) {
    it(`reports a synthetic collision on ${object_} (both spellings)`, () => {
      const why =
        `${object_} was mapped into MODEL_TO_OBJECT by the 2026-08-12 ruling so that a platform `
        + `extension field colliding with better-auth's own column is caught here. A green result `
        + `means the table is back OUTSIDE the collision loop — most likely its mapping was `
        + `deleted, or the ${plugin} plugin left AUTH_MANAGER_PLUGINS so no model is derived for `
        + `it. Either way this guard is answering about a table it is not looking at, which is the `
        + `#7770 defect. Do NOT "fix" this by re-adding an UNMAPPED_MANAGED_OBJECTS exemption.`;
      expect(findCollisions({ [object_]: new Set([snake]) }, byObject), why)
        .toEqual([`${object_}.${snake}`]);
      // better-auth authors camelCase; `toSnakeCase` records both spellings, so
      // a registry that happened to use the library's own spelling must not
      // slip past a snake_case-only comparison.
      expect(findCollisions({ [object_]: new Set([camel]) }, byObject), why)
        .toEqual([`${object_}.${camel}`]);
    });
  }

  it('stays silent on plausible extension names these tables do NOT own', () => {
    // Non-vacuity, per table: a rule that reported every field would satisfy
    // the three cases above while making the real registry assertion useless.
    // Each name below is one a future ObjectStack extension might genuinely
    // take, and none is in better-auth's surface at the pinned version.
    expect(findCollisions({ sys_two_factor: new Set(['mfa_policy_id']) }, byObject)).toEqual([]);
    expect(findCollisions({ sys_jwks: new Set(['rotation_note']) }, byObject)).toEqual([]);
    expect(findCollisions({ sys_device_code: new Set(['approved_by_id']) }, byObject)).toEqual([]);
  });

  it('derives a credential-bearing column set for each of the three', () => {
    // The ② lens of the card: these tables are why the expansion was worth
    // doing. If better-auth ever moves `secret` / `privateKey` / `deviceCode`
    // off these models, the collision cases above would start passing for the
    // wrong reason (nothing owned, nothing to collide with) — this says so
    // first, and names the column that moved.
    expect(byObject.sys_two_factor?.has('secret'), 'twoFactor.secret').toBe(true);
    expect(byObject.sys_jwks?.has('private_key'), 'jwks.privateKey').toBe(true);
    expect(byObject.sys_device_code?.has('device_code'), 'deviceCode.deviceCode').toBe(true);
  });

  it('carries no exemption for the three tables any more', () => {
    // The ruling's second half, in-repo. The stale-entry assertion above
    // already fails on a mapped-AND-exempt object; this states the intent
    // directly, so the next reader sees a removal that was decided rather
    // than an entry someone lost track of.
    for (const object_ of ['sys_two_factor', 'sys_jwks', 'sys_device_code']) {
      expect(
        UNMAPPED_MANAGED_OBJECTS[object_],
        `${object_} is exempt again. An exemption is what makes the collision loop skip a table, `
          + `so re-adding one here silently un-does the 2026-08-12 ruling's coverage expansion.`,
      ).toBeUndefined();
    }
  });
});

describe('sys_api_key exemption premise (#7770)', () => {
  it('better-auth still ships no apiKey plugin, so sys_api_key has no model to collide with', async () => {
    // This is the whole warrant for `noBetterAuthColumns: true` on
    // sys_api_key: the columns the issue worried about (`name`, `prefix`,
    // `key`, `userId`, `expiresAt`, `permissions`, `metadata`) belong to a
    // plugin that does not exist at the installed version — measured
    // 2026-08-20 against better-auth 1.7.1, which publishes no
    // `./plugins/api-key` subpath and whose `better-auth/plugins` exports no
    // `apiKey`. The assertion below re-measures this on every run, so the
    // stamp is a reading aid and the test is the actual check.
    //
    // Going red here is CORRECT and is the point: a bump that (re)introduces
    // the plugin makes the exemption's premise expire BEFORE anyone can enable
    // it, which is one step earlier than the enablement this card anticipated.
    const plugins = (await import('better-auth/plugins')) as Record<string, unknown>;
    expect(
      plugins.apiKey,
      'better-auth now exports an apiKey plugin, so sys_api_key CAN acquire better-auth-owned '
        + 'columns and its UNMAPPED_MANAGED_OBJECTS exemption no longer holds. Re-decide: keep the '
        + 'hand-rolled table and do not load the plugin (restate the reason and repoint this '
        + "tripwire at the auth manager's plugin list), or adopt the plugin — in which case map "
        + "apikey: 'sys_api_key' AND pass apiKey() to getAuthTables() here, add sys_api_key to "
        + 'better-auth-schema-parity.test.ts, and reconcile the overlapping columns (name, prefix, '
        + 'key, user_id, expires_at) as an ownership decision, NOT by widening '
        + 'MANAGED_EXTENSION_FIELDS, which is also the ADR-0092 D2 write whitelist.',
    ).toBeUndefined();
  });
});
