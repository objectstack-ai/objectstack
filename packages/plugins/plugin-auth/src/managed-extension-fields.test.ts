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
 * There is a SECOND axis of the same blindness that this file does not close:
 * the `getAuthTables()` call below loads `organization` only, while the auth
 * manager loads many more plugins behind feature flags, so a column an unloaded
 * plugin owns is invisible to the comparison even for a MAPPED object.
 * `sys_user.phone_number` is a live instance — filed as #7820, deliberately not
 * fixed here, because widening the plugin set turns this guard red on an
 * ownership question nobody has decided.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuthTables } from 'better-auth/db';
import { organization } from 'better-auth/plugins';

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
 * be opt-in, ship in its own package, or (for sso/scim) expose no `schema`
 * option this call can read.
 */
const UNMAPPED_MANAGED_OBJECTS: Record<string, UnmappedManagedObject> = {
  sys_api_key: {
    // The one entry that carries declared extension fields, so the one whose
    // reason has to be a statement about better-auth rather than about scope.
    reason:
      'Hand-rolled ObjectStack table, not a better-auth model at all. '
      + '`packages/core/src/security/api-key.ts` mints and verifies the key and POST /api/v1/keys '
      + 'writes the row, and better-auth 1.7.0-rc.2 ships NO apiKey plugin: there is no '
      + '"better-auth/plugins/api-key" export subpath and "better-auth/plugins" exports no apiKey. '
      + 'So no model exists to derive and no column on this table can change hands. '
      + 'Pinned by the premise test at the bottom of this file (#7770).',
    noBetterAuthColumns: true,
  },

  // ── Opt-in core plugins this file's getAuthTables() call does not load ────
  // It loads `organization` only, which is the surface D7 has covered since
  // #3624. Column-level parity for these three IS covered — by
  // `better-auth-schema-parity.test.ts`, which loads their plugins. What is
  // missing here is only the D7 collision direction, and it costs nothing
  // while no extension field is declared on them. The moment one is, the
  // "nothing is silently skipped" assertion below turns red and the mapping
  // has to be done properly.
  sys_two_factor: {
    reason:
      "Owned by better-auth's opt-in `twoFactor` plugin (model `twoFactor`), which this file's "
      + 'getAuthTables() call does not load. No extension field is declared on it.',
  },
  sys_device_code: {
    reason:
      "Owned by better-auth's opt-in `deviceAuthorization` plugin (model `deviceCode`), which this "
      + "file's getAuthTables() call does not load. No extension field is declared on it.",
  },
  sys_jwks: {
    reason:
      "Owned by better-auth's opt-in `jwt` plugin (model `jwks`), which this file's getAuthTables() "
      + 'call does not load. No extension field is declared on it.',
  },

  // ── Plugins getAuthTables() structurally cannot see (#3653) ───────────────
  sys_sso_provider: {
    reason:
      '@better-auth/sso accepts no `schema` option, so getAuthTables() cannot see its models at all '
      + '(#3653). Its columns are bridged mechanically by objectql-adapter.ts and gated by the '
      + 'dedicated sso/scim block in better-auth-schema-parity.test.ts.',
  },
  sys_scim_provider: {
    reason:
      '@better-auth/scim accepts no `schema` option, so getAuthTables() cannot see its models at all '
      + '(#3653). Same bridge and same dedicated gate as sys_sso_provider.',
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
 * The nine objects this guard has real collision coverage for, written out as
 * a LITERAL rather than derived from `MODEL_TO_OBJECT`.
 *
 * Deriving it would have made the pin below unable to see the regression it
 * exists for: deleting a mapping shrinks the derived surface and the expected
 * list together, so the assertion stays green while an object drops out of the
 * collision loop. Measured — an ablation that removed `teamMember` left a
 * derived version of this pin green and was caught only by the accounting
 * assertion. Two independent lists, so one of them has to be wrong out loud.
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
];

const HERE = dirname(fileURLToPath(import.meta.url));
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
 * Every field better-auth owns, per ObjectStack object name, in BOTH spellings
 * — comparing only one would let `parentOrganizationId` slip past a check on
 * `parent_organization_id`.
 */
function betterAuthFieldsByObject(): Record<string, Set<string>> {
  // `teams: { enabled: true }` mirrors the auth-manager default. Without it
  // better-auth omits the team models entirely, so the sys_team /
  // sys_team_member entries below would be absent and any extension field
  // added to those objects would collide silently. (#3624)
  const tables = getAuthTables({
    plugins: [organization({ teams: { enabled: true } })],
  } as never);
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

describe('managed extension fields (ADR-0105 D7)', () => {
  const byObject = betterAuthFieldsByObject();
  const managedObjects = declaredBetterAuthObjects();

  it('derives a non-empty better-auth surface (the guard must not pass vacuously)', () => {
    expect(Object.keys(byObject).length).toBeGreaterThan(0);
    expect(byObject.sys_organization?.size ?? 0).toBeGreaterThan(0);
    expect(byObject.sys_user?.size ?? 0).toBeGreaterThan(0);
  });

  it('keeps the nine mapped models covered, exactly (coverage cannot shrink)', () => {
    // Two ways an object can silently withdraw from the collision loop, and
    // this pins both against the same literal: the LIBRARY stops emitting the
    // model, or the MAP stops naming it. Either is the #7770 shape arriving
    // as a regression rather than as a pre-existing absence.
    expect(
      [...MAPPED_OBJECTS].sort(),
      'MODEL_TO_OBJECT no longer maps exactly the nine covered objects — a deleted mapping '
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
        + `  (a) MAP IT — and it takes both halves, in this order: 1. pass the plugin that owns the `
        + `model into the getAuthTables() call in betterAuthFieldsByObject(), because a map entry `
        + `alone derives no table and the object stays silently skipped; 2. add the `
        + `model: 'object_name' entry to MODEL_TO_OBJECT.\n`
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
    const collisions: string[] = [];
    for (const [object, fields] of Object.entries(MANAGED_EXTENSION_FIELDS)) {
      const owned = byObject[object];
      // Accounted for by the assertion directly above — never a silent pass.
      if (!owned) continue;
      for (const field of fields) {
        if (owned.has(field)) collisions.push(`${object}.${field}`);
      }
    }
    expect(
      collisions,
      `these extension fields collide with better-auth's own schema at the pinned version: ` +
        `${collisions.join(', ')} — better-auth now owns those columns, so ObjectStack must rename ` +
        `its field (and migrate) or drop the extension. Silently sharing a column means one side ` +
        `clobbers the other with no error.`,
    ).toEqual([]);
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

describe('sys_api_key exemption premise (#7770)', () => {
  it('better-auth still ships no apiKey plugin, so sys_api_key has no model to collide with', async () => {
    // This is the whole warrant for `noBetterAuthColumns: true` on
    // sys_api_key: the columns the issue worried about (`name`, `prefix`,
    // `key`, `userId`, `expiresAt`, `permissions`, `metadata`) belong to a
    // plugin that does not exist at the pinned version — better-auth 1.7.0-rc.2
    // publishes no `./plugins/api-key` subpath and `better-auth/plugins`
    // exports no `apiKey`.
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
