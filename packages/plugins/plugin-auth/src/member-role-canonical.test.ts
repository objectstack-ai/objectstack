// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8317] `sys_member.role` canonicalisation.
 *
 * ## Why the vendor's predicates are EXTRACTED rather than restated
 *
 * The defect is a disagreement between our grade ladder and better-auth's own
 * reading of the same column. A test that restates the vendor's predicate in
 * TypeScript proves the restatement agrees with the ladder — which is a fact
 * about this file, not about the vendor. Both sides of the comparison would
 * then derive from the same source, and the assertion could not fail for the
 * reason it exists.
 *
 * So the three owner-tests are read out of the INSTALLED vendor file at test
 * time, and the predicate is built from the bytes that were extracted. Two
 * things follow, both wanted:
 *
 *  - the expectation is the vendor's, so a pin that goes green means the
 *    vendor really does read the canonicalised row as an owner;
 *  - a vendor upgrade that moves, renames or corrects any of the three
 *    branches fails the extraction and reddens the suite, instead of silently
 *    leaving a pin that verifies nothing.
 *
 * The three branches (better-auth 1.7.0-rc.2,
 * `dist/plugins/organization/routes/crud-members.mjs`):
 *
 *  1. `removeMember`  — `const roles = toBeRemovedMember.role.split(",");`
 *                       … `if (roles.includes(creatorRole))`
 *  2. `updateMemberRole` — `const isUpdatingCreator =
 *                       toBeUpdatedMember.role.split(",").includes(creatorRole);`
 *  3. `organization/leave` — `if (member.role.split(",").includes(creatorRole))`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import {
  canonicalMemberRole,
  isCanonicalMemberRole,
  isKnownMembershipRole,
  registerMemberRoleCanonicalization,
  canonicalizeStoredMemberRoles,
} from './member-role-canonical.js';
import { orgRoleGrade, isOrgAdminGrade, parseOrgRoles } from './invitation-role-cap.js';
import {
  targetCarriesCreatorRole,
  callerCarriesCreatorRole,
} from './remove-member-permission-guard.js';
import { BUILTIN_MEMBERSHIP_ROLES } from '@objectstack/spec/identity';

// ---------------------------------------------------------------------------
// The vendor's three owner-tests, extracted from the installed package
// ---------------------------------------------------------------------------

const require_ = createRequire(import.meta.url);
/** `…/better-auth/dist/index.mjs` → `…/better-auth/dist`. */
const VENDOR_DIST = dirname(require_.resolve('better-auth'));
const CRUD_MEMBERS = join(VENDOR_DIST, 'plugins', 'organization', 'routes', 'crud-members.mjs');
const VENDOR_SOURCE = readFileSync(CRUD_MEMBERS, 'utf8');

interface VendorBranch {
  /** The route whose owner-test this is. */
  branch: string;
  /**
   * Matches the branch's owner-test in the vendor source. Capture groups
   * concatenate, after a leading `role`, into a JS expression over one role
   * value — so the predicate under test is assembled from vendor BYTES.
   */
  pattern: RegExp;
}

const VENDOR_BRANCHES: readonly VendorBranch[] = [
  {
    branch: 'removeMember — only an owner may remove an owner',
    // `const roles = toBeRemovedMember.role.split(",");` … `if (roles.includes(creatorRole)) {`
    pattern:
      /const roles = toBeRemovedMember\.role(\.split\(","\));[\s\S]{0,200}?if \(roles(\.includes\(creatorRole\))\)/,
  },
  {
    branch: 'updateMemberRole — creator protection',
    pattern:
      /const isUpdatingCreator = toBeUpdatedMember\.role(\.split\(","\)\.includes\(creatorRole\));()/,
  },
  {
    branch: 'organization/leave — last-owner count',
    pattern: /\n\tif \(member\.role(\.split\(","\)\.includes\(creatorRole\))\) \{()/,
  },
];

/**
 * Build the branch's predicate out of the vendor's own source text.
 *
 * Throws when the branch cannot be found or is not unique — which is the drift
 * tripwire: on a vendor upgrade this fails loudly rather than testing a
 * predicate the vendor no longer runs.
 */
function vendorOwnerTest(branch: VendorBranch): (role: unknown, creatorRole: string) => boolean {
  const match = VENDOR_SOURCE.match(branch.pattern);
  if (!match) {
    throw new Error(
      `[#8317] could not find the '${branch.branch}' owner-test in ${CRUD_MEMBERS}. ` +
        `better-auth changed it — re-read the route and update the pattern (and re-decide ` +
        `whether the canonicalisation still closes the disagreement).`,
    );
  }
  const occurrences = [
    ...VENDOR_SOURCE.matchAll(new RegExp(branch.pattern.source, 'g')),
  ].length;
  if (occurrences !== 1) {
    throw new Error(
      `[#8317] the '${branch.branch}' pattern matched ${occurrences} times in ${CRUD_MEMBERS}; ` +
        `it must identify exactly one branch.`,
    );
  }
  const expression = `role${match[1] ?? ''}${match[2] ?? ''}`;
  return new Function('role', 'creatorRole', `return ${expression};`) as (
    role: unknown,
    creatorRole: string,
  ) => boolean;
}

const CREATOR_ROLE = 'owner';

describe('#8317 — the vendor predicates this card is about', () => {
  it('extracts all three owner-tests from the installed better-auth', () => {
    for (const branch of VENDOR_BRANCHES) {
      const test = vendorOwnerTest(branch);
      // Sanity: the extracted predicate behaves like an owner-test on the
      // canonical value. If this fails the extraction grabbed the wrong text.
      expect(test('owner', CREATOR_ROLE), branch.branch).toBe(true);
      expect(test('member', CREATOR_ROLE), branch.branch).toBe(false);
    }
  });

  it('still reads the column raw — no trim, no lower-case (the defect itself)', () => {
    for (const branch of VENDOR_BRANCHES) {
      const source = VENDOR_SOURCE.match(branch.pattern)?.[0] ?? '';
      expect(source, branch.branch).toContain('split(",")');
      expect(source.toLowerCase(), branch.branch).not.toContain('tolowercase');
    }
  });
});

/** The spellings that produce the inversion, and the canonical one. */
const NON_CANONICAL = ['Owner', ' owner', 'OWNER', 'owner ', ' Owner '] as const;

describe('#8317 — the inversion, reproduced against the real vendor predicates', () => {
  it.each([...NON_CANONICAL])(
    'stored %o: our ladder says owner, all three vendor branches say plain member',
    (stored) => {
      // ObjectStack's side — the #5942 grade ladder.
      expect(orgRoleGrade(stored)).toBe(3); // GRADE_OWNER
      expect(isOrgAdminGrade(stored)).toBe(true);

      // better-auth's side, from the vendor's own bytes.
      for (const branch of VENDOR_BRANCHES) {
        expect(vendorOwnerTest(branch)(stored, CREATOR_ROLE), branch.branch).toBe(false);
      }
    },
  );

  it.each([...NON_CANONICAL])(
    'after canonicalisation, stored %o reads as an owner to BOTH sides, on all three branches',
    (stored) => {
      const canonical = canonicalMemberRole(stored);
      expect(canonical).toBe('owner');

      expect(orgRoleGrade(canonical)).toBe(3);
      expect(isOrgAdminGrade(canonical)).toBe(true);
      for (const branch of VENDOR_BRANCHES) {
        expect(vendorOwnerTest(branch)(canonical, CREATOR_ROLE), branch.branch).toBe(true);
      }
    },
  );

  it('closes the disagreement for every known role, not just `owner`', () => {
    const spellings = [
      'Owner',
      ' owner ',
      'ADMIN',
      ' Admin',
      'Delegated_Admin',
      'MEMBER',
      'Owner,Admin',
      'owner , admin',
      'admin,',
    ];
    for (const stored of spellings) {
      const canonical = canonicalMemberRole(stored) ?? stored;
      for (const role of BUILTIN_MEMBERSHIP_ROLES) {
        // The invariant the module doc states: for a canonical value the
        // vendor's raw `split(',')` and the ladder's parse agree about every
        // known role.
        expect(
          canonical.split(',').includes(role),
          `${JSON.stringify(canonical)} / ${role}`,
        ).toBe(parseOrgRoles(canonical).includes(role));
      }
    }
  });
});

describe('canonicalMemberRole', () => {
  it('lower-cases and trims each known-role token', () => {
    expect(canonicalMemberRole('Owner')).toBe('owner');
    expect(canonicalMemberRole(' owner')).toBe('owner');
    expect(canonicalMemberRole('OWNER , Admin')).toBe('owner,admin');
    expect(canonicalMemberRole('Delegated_Admin')).toBe('delegated_admin');
  });

  it('drops tokens that are empty after trimming', () => {
    expect(canonicalMemberRole('owner,')).toBe('owner');
    expect(canonicalMemberRole('owner, ,admin')).toBe('owner,admin');
  });

  it('accepts the array spelling `parseOrgRoles` tolerates', () => {
    expect(canonicalMemberRole(['Owner', ' Admin'])).toBe('owner,admin');
  });

  it('returns null for a value that is already canonical', () => {
    expect(canonicalMemberRole('owner')).toBeNull();
    expect(canonicalMemberRole('owner,admin')).toBeNull();
    expect(isCanonicalMemberRole('owner,admin')).toBe(true);
  });

  it('returns null for a value that is not a role value at all', () => {
    expect(canonicalMemberRole(null)).toBeNull();
    expect(canonicalMemberRole(undefined)).toBeNull();
    expect(canonicalMemberRole(42)).toBeNull();
    expect(canonicalMemberRole({})).toBeNull();
  });

  it('leaves a value carrying NO known role completely alone, case included', () => {
    // `mapMembershipRole`'s default arm returns `raw.trim()` — case preserved —
    // so an unknown token is a POSITION NAME a permission set may be bound to.
    // Lower-casing it would re-point that binding, and no reader can read it
    // as an owner, so there is no disagreement to abolish either.
    expect(canonicalMemberRole('Sales_Manager')).toBeNull();
    expect(canonicalMemberRole(' ACME-Rep ')).toBeNull();
    expect(isKnownMembershipRole('Sales_Manager')).toBe(false);
  });

  it('canonicalises the KNOWN token of a mixed value and preserves the foreign one', () => {
    // The hole a value-level "all tokens known" rule would leave: this row IS
    // an owner to the ladder and is not to the vendor.
    expect(vendorOwnerTest(VENDOR_BRANCHES[0])('Owner,Sales_Manager', CREATOR_ROLE)).toBe(false);
    expect(isOrgAdminGrade('Owner,Sales_Manager')).toBe(true);

    expect(canonicalMemberRole('Owner,Sales_Manager')).toBe('owner,Sales_Manager');
    for (const branch of VENDOR_BRANCHES) {
      expect(vendorOwnerTest(branch)('owner,Sales_Manager', CREATOR_ROLE), branch.branch).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The write path
// ---------------------------------------------------------------------------

type Handler = (ctx: any) => Promise<void>;

/** Fake engine capturing hook registrations (the identity-write-guard shape). */
function makeHookEngine() {
  const handlers: Record<string, Array<{ handler: Handler; options: any }>> = {};
  return {
    handlers,
    registerHook: (event: string, handler: Handler, options: any) => {
      (handlers[event] ??= []).push({ handler, options });
    },
  };
}

function hookOn(engine: ReturnType<typeof makeHookEngine>, event: string) {
  const entry = engine.handlers[event]?.find((h) =>
    h.options?.packageId?.includes('member-role-canonical'),
  );
  if (!entry) throw new Error(`no canonicalisation handler registered for ${event}`);
  return entry;
}

describe('#8317 — write-path canonicalisation hooks', () => {
  let engine: ReturnType<typeof makeHookEngine>;
  beforeEach(() => {
    engine = makeHookEngine();
    registerMemberRoleCanonicalization(engine, { packageId: 'test.member-role-canonical' });
  });

  it('registers on sys_member only, at priority 5 — ahead of both guards', () => {
    for (const event of ['beforeInsert', 'beforeUpdate']) {
      const { options } = hookOn(engine, event);
      expect(options.object).toBe('sys_member');
      // ADR-0092 identity write guard is 10; ADR-0024 D5.2 break-glass is 20.
      expect(options.priority).toBe(5);
      expect(options.priority).toBeLessThan(10);
    }
  });

  it.each(['beforeInsert', 'beforeUpdate'])(
    '%s rewrites a non-canonical payload in place',
    async (event) => {
      for (const stored of NON_CANONICAL) {
        const data: Record<string, unknown> = { user_id: 'usr_1', role: stored };
        await hookOn(engine, event).handler({ object: 'sys_member', input: { data } });
        expect(data.role).toBe('owner');
      }
    },
  );

  it('fires for EVERY context — system writes are the ones this exists for', async () => {
    for (const session of [undefined, { userId: 'usr_1' }, { userId: 'usr_1', isSystem: true }]) {
      const data: Record<string, unknown> = { role: ' Owner ' };
      await hookOn(engine, 'beforeInsert').handler({ object: 'sys_member', input: { data }, session });
      expect(data.role).toBe('owner');
    }
  });

  it('leaves a canonical payload byte-identical', async () => {
    const data: Record<string, unknown> = { role: 'owner,admin' };
    await hookOn(engine, 'beforeUpdate').handler({ object: 'sys_member', input: { data } });
    expect(data.role).toBe('owner,admin');
  });

  it('does not invent a role on a payload that carries none', async () => {
    const data: Record<string, unknown> = { user_id: 'usr_1' };
    await hookOn(engine, 'beforeUpdate').handler({ object: 'sys_member', input: { data } });
    expect(Object.prototype.hasOwnProperty.call(data, 'role')).toBe(false);
  });

  it('tolerates the shapes a hook context can legitimately arrive in', async () => {
    const handler = hookOn(engine, 'beforeUpdate').handler;
    await expect(handler({ object: 'sys_member', input: {} })).resolves.toBeUndefined();
    await expect(handler({ object: 'sys_member' })).resolves.toBeUndefined();
    await expect(handler({})).resolves.toBeUndefined();
  });

  it('rewrites the SHARED payload a predicate update dispatches per row (ADR-0058 D3)', async () => {
    // The batch payload is THE payload, not a copy — one rewrite binds every
    // matched row, which is what makes a bulk `multi: true` role write safe.
    const data: Record<string, unknown> = { role: 'Owner' };
    const batchInput = { data, options: { multi: true } };
    for (const id of ['mem_1', 'mem_2', 'mem_3']) {
      await hookOn(engine, 'beforeUpdate').handler({
        object: 'sys_member',
        input: { id, data: batchInput.data, options: batchInput.options },
      });
    }
    expect(data.role).toBe('owner');
  });
});

// ---------------------------------------------------------------------------
// The one-off pass
// ---------------------------------------------------------------------------

/**
 * Memory engine for the migration. `update` is pinned to ObjectQL's own
 * dispatch predicate (#4550/#5480): a fake looser than the real engine turns a
 * green suite into no suite at all on exactly the write this pass performs.
 */
function makeMemoryEngine(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ object: string; patch: any; options: any }> = [];
  return {
    rows,
    calls,
    async find(object: string, q: any = {}, _opts?: any) {
      if (object !== 'sys_member') return [];
      const out = rows.map((r) => ({ ...r }));
      return q?.limit ? out.slice(0, q.limit) : out;
    },
    async update(object: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      calls.push({ object, patch, options });
      const row = rows.find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
  };
}

describe('#8317 — the one-off convergent pass', () => {
  it('canonicalises the divergent rows and reports a census of what it found', async () => {
    const engine = makeMemoryEngine([
      { id: 'mem_1', user_id: 'u1', role: 'Owner' },
      { id: 'mem_2', user_id: 'u2', role: ' owner' },
      { id: 'mem_3', user_id: 'u3', role: 'Owner' },
      { id: 'mem_4', user_id: 'u4', role: 'owner' }, // already canonical
      { id: 'mem_5', user_id: 'u5', role: 'admin' }, // already canonical
      { id: 'mem_6', user_id: 'u6', role: ' ACME-Rep ' }, // no known role
    ]);

    const result = await canonicalizeStoredMemberRoles(engine);

    expect(result.scanned).toBe(6);
    expect(result.nonCanonical).toBe(4); // three owner spellings + the foreign one
    expect(result.normalized).toBe(3);
    expect(result.declined).toBe(1);
    expect(result.failed).toBe(0);

    expect(engine.rows.map((r) => r.role)).toEqual([
      'owner',
      'owner',
      'owner',
      'owner',
      'admin',
      ' ACME-Rep ', // untouched, case AND whitespace preserved
    ]);

    const census = Object.fromEntries(result.census.map((c) => [c.stored, c]));
    expect(census['Owner']).toMatchObject({ count: 2, rewritten: 2, canonical: 'owner', divergent: true });
    expect(census[' owner']).toMatchObject({ count: 1, rewritten: 1, canonical: 'owner', divergent: true });
    expect(census[' ACME-Rep ']).toMatchObject({
      count: 1,
      rewritten: 0,
      canonical: null,
      carriesKnownRole: false,
      // No known role in the value, so both readers agree it is not an owner —
      // this row was never part of the inversion.
      divergent: false,
    });
  });

  it('is idempotent — a second pass finds nothing and writes nothing', async () => {
    const engine = makeMemoryEngine([{ id: 'mem_1', user_id: 'u1', role: 'Owner' }]);

    const first = await canonicalizeStoredMemberRoles(engine);
    expect(first.normalized).toBe(1);

    const second = await canonicalizeStoredMemberRoles(engine);
    expect(second.nonCanonical).toBe(0);
    expect(second.normalized).toBe(0);
    expect(second.census).toEqual([]);
    expect(engine.calls).toHaveLength(1); // no second write
  });

  it('writes by SCALAR id under a system context (the engine dispatch it claims)', async () => {
    const engine = makeMemoryEngine([{ id: 'mem_1', user_id: 'u1', role: 'Owner' }]);
    await canonicalizeStoredMemberRoles(engine);
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).toMatchObject({
      object: 'sys_member',
      patch: { id: 'mem_1', role: 'owner' },
      options: { context: { isSystem: true } },
    });
  });

  it('counts a row whose rewrite throws instead of reporting it converged', async () => {
    const engine = makeMemoryEngine([
      { id: 'mem_1', user_id: 'u1', role: 'Owner' },
      { id: 'mem_2', user_id: 'u2', role: 'Admin' },
    ]);
    const realUpdate = engine.update.bind(engine);
    engine.update = async (object: string, patch: any, options?: any) => {
      if (patch.id === 'mem_2') throw new Error('refused by a guard');
      return realUpdate(object, patch, options);
    };

    const result = await canonicalizeStoredMemberRoles(engine);
    expect(result.normalized).toBe(1);
    expect(result.failed).toBe(1);
    expect(engine.rows[1].role).toBe('Admin'); // still divergent, and said so
  });

  it('degrades to a no-op when there is no engine or no membership table', async () => {
    await expect(canonicalizeStoredMemberRoles(undefined)).resolves.toMatchObject({ scanned: 0 });
    await expect(canonicalizeStoredMemberRoles({})).resolves.toMatchObject({ scanned: 0 });
    const throwing = {
      async find() {
        throw new Error('no such table: sys_member');
      },
      async update() {
        throw new Error('unreachable');
      },
    };
    await expect(canonicalizeStoredMemberRoles(throwing)).resolves.toMatchObject({
      scanned: 0,
      normalized: 0,
    });
  });

  it('a canonicalisation never changes a row GRADE, so it can never revoke standing', async () => {
    // Why the pass may safely write through the ADR-0024 D5.2 break-glass guard
    // under a system context: the guard counts administrators with
    // `isOrgAdminGrade`, which already trims and lower-cases.
    for (const stored of [...NON_CANONICAL, 'ADMIN', ' Delegated_Admin ', 'MEMBER']) {
      const canonical = canonicalMemberRole(stored);
      expect(canonical, stored).not.toBeNull();
      expect(orgRoleGrade(canonical), stored).toBe(orgRoleGrade(stored));
      expect(isOrgAdminGrade(canonical), stored).toBe(isOrgAdminGrade(stored));
    }
  });
});

// ---------------------------------------------------------------------------
// #8289 stays exactly where it is
// ---------------------------------------------------------------------------

describe('#8317 keeps #8289 decoupled', () => {
  it('leaves the remove-member guard reproducing the vendor asymmetry byte-for-byte', () => {
    // #8289's guard splits the TARGET's roles without `trim()` and the
    // CALLER's with it, on purpose, so its refusal set is the vendor's. This
    // card does not correct it: after canonicalisation the two populations
    // agree by construction, which is the point. If someone "cleans it up",
    // this pin says so.
    expect(targetCarriesCreatorRole(' owner', 'owner')).toBe(false);
    expect(callerCarriesCreatorRole(' owner', 'owner')).toBe(true);
    // …and the guard's target half still matches the vendor's, value for value.
    const vendorRemoveMember = vendorOwnerTest(VENDOR_BRANCHES[0]);
    for (const stored of ['owner', 'Owner', ' owner', 'owner,admin', 'member']) {
      expect(targetCarriesCreatorRole(stored, 'owner'), stored).toBe(
        vendorRemoveMember(stored, 'owner'),
      );
    }
  });
});
