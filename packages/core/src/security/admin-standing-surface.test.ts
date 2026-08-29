// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8734] The FIRST of the two links that bind `plugin-auth`'s break-glass
 * standing-key lists to what this resolver actually reads.
 *
 * This half answers one question mechanically: **which columns does
 * `resolveAuthzContext` read on the tables administrator standing is derived
 * from?** It answers it by OBSERVATION — the real resolver is driven over a
 * recording engine that returns `Proxy`-wrapped rows and records every property
 * access, plus every `where` key, per table — and asserts the answer equals
 * `ADMIN_STANDING_SURFACE`.
 *
 * The second link lives in `plugin-auth`
 * (`last-admin-standing-keys.test.ts`): it requires every column declared here
 * to be either in a standing-key list or explicitly excluded with a reason. So
 * a resolver change that starts reading a new column fails HERE until the
 * declaration is updated, and fails THERE until the guard has an answer for it.
 *
 * ## Why observation rather than a static extractor
 *
 * A source-parsing gate would have to follow `psRowsAll` into `psRows` into the
 * `for (const ps of psRows)` loop to learn that `ps.name` is a read of
 * `sys_permission_set.name` — real dataflow analysis, brittle in exactly the
 * places that matter. Worse, it would have to inline the helpers: `active` is
 * never named on the resolver's own call site (`isRowActive(r)` reads it), and
 * neither is `valid_from` (`isGrantActive(row, now)` reads it). #8613's whole
 * defect was a read that moved into a predicate; a gate that reads the caller
 * and not the callee would have missed it for the same reason the comment did.
 *
 * ## Why the fixtures come in variants
 *
 * A conditional read is invisible in a fixture that never takes the branch. The
 * resolver's tolerated-spelling chains are the sharp case: `r.organization_id ??
 * r.organizationId` never touches the camelCase spelling while the snake_case
 * one is non-nullish. So the observation is the UNION over fixtures chosen to
 * take both sides of every such chain — snake-only rows, camel-only rows, and a
 * pass where the flags and windows are set the other way. `assertVariantsStay-
 * Distinct` keeps that honest: if two variants ever observe the same set, one of
 * them has stopped contributing and the union has silently narrowed.
 */

import { describe, it, expect } from 'vitest';

import { ADMIN_STANDING_SURFACE, adminStandingTables } from './admin-standing-surface.js';
import { resetPlatformAdminEmailMemo } from './platform-admin.js';
import { resolveAuthzContext } from './resolve-authz-context.js';

/** table -> every column name the resolver touched on it. */
type Observation = Map<string, Set<string>>;

const camelOf = (key: string): string => key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * An ObjectQL stand-in that records what the resolver READS.
 *
 * Two rules keep the recording faithful:
 *
 *  - the `where` match runs against the RAW row, never the proxy, so the fake
 *    driver's own reads are not mistaken for the resolver's;
 *  - `where` keys ARE recorded, because filtering on a column is reading it —
 *    a resolver that started passing `where: { active: true }` would be
 *    consuming `active` just as surely as `isRowActive` does.
 *
 * The matcher resolves a column through either spelling so a camelCase-only
 * fixture still matches a snake_case `where`; that leniency is the harness's,
 * never the resolver's, and it exists so the camel variant can reach the same
 * code path rather than returning nothing.
 */
function makeRecordingQl(tables: Record<string, Array<Record<string, unknown>>>, seen: Observation) {
  const note = (table: string, column: string): void => {
    let cols = seen.get(table);
    if (!cols) {
      cols = new Set<string>();
      seen.set(table, cols);
    }
    cols.add(column);
  };
  const raw = (row: Record<string, unknown>, key: string): unknown =>
    key in row ? row[key] : row[camelOf(key)];

  return {
    async find(object: string, opts: { where?: Record<string, unknown>; limit?: number } = {}) {
      if (!seen.has(object)) seen.set(object, new Set<string>());
      const where = opts?.where ?? {};
      for (const key of Object.keys(where)) {
        if (!key.startsWith('$')) note(object, key);
      }
      const rows = (tables[object] ?? []).filter((row) =>
        Object.entries(where).every(([key, cond]) => {
          if (cond && typeof cond === 'object') {
            const c = cond as Record<string, unknown>;
            if ('$in' in c) return (c.$in as unknown[]).includes(raw(row, key));
            if ('$nin' in c) return !(c.$nin as unknown[]).includes(raw(row, key));
            if ('$ne' in c) return raw(row, key) !== c.$ne;
          }
          return raw(row, key) === cond;
        }),
      );
      // [#10978] Enforce the caller's bound — presence, not truthiness, so
      // `limit: 0` returns nothing rather than everything. Bounding BEFORE the
      // Proxy wrap keeps the column-observation ledger honest: a row the real
      // read would never have returned must not record column reads either.
      const page = typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      return page.map(
        (row) =>
          new Proxy(row, {
            get(target, prop, receiver) {
              // `then` would make the row look thenable to an `await`; symbols
              // are never column names.
              if (typeof prop === 'string' && prop !== 'then') note(object, prop);
              return Reflect.get(target, prop, receiver);
            },
          }),
      );
    },
  };
}

const headers = () => new Headers();
const sessionFor = (userId: string, org?: string) => async () => ({
  user: { id: userId, email: 'ada@example.com' },
  session: { activeOrganizationId: org ?? null },
});

const HOUR = 3_600_000;
const NOW = Date.parse('2026-08-15T00:00:00.000Z');

/**
 * Fixture variants, each reaching the platform-admin derivation and each
 * deliberately taking a different side of the resolver's conditional reads.
 */
const VARIANTS: Record<
  string,
  {
    tables: Record<string, Array<Record<string, unknown>>>;
    org?: string;
    /**
     * [#11663 L2] `OS_PLATFORM_OWNER_EMAIL` for this variant. The config anchor
     * reads `sys_user.email` and `sys_user.email_verified` ONLY when the
     * deployment declared administrators (pin P2 — an empty list answers
     * "not an admin" before touching any row), so those two columns are
     * invisible to every fixture that leaves the variable unset. That is
     * exactly the "a conditional read is invisible in a fixture that never
     * takes the branch" hazard this file's header names, so the branch gets a
     * variant of its own.
     */
    platformAdminEmails?: string;
  }
> = {
  // Snake_case rows, unscoped in-window grant, active set: the happy platform-admin path.
  'snake-case rows, standing intact': {
    org: 'org_1',
    tables: {
      sys_user: [{ id: 'usr_1', email: 'ada@example.com', ai_access: 1 }],
      sys_member: [
        { id: 'mem_1', user_id: 'usr_1', organization_id: 'org_1', role: 'owner', valid_from: null, valid_until: null },
      ],
      sys_user_position: [
        { id: 'upo_1', user_id: 'usr_1', position: 'contributor', organization_id: null, valid_from: null, valid_until: null },
      ],
      sys_position: [{ id: 'pos_1', name: 'contributor', active: true }],
      sys_position_permission_set: [{ position_id: 'pos_1', permission_set_id: 'pst_2' }],
      sys_user_permission_set: [
        {
          id: 'ups_1',
          user_id: 'usr_1',
          permission_set_id: 'pst_1',
          organization_id: null,
          valid_from: null,
          valid_until: null,
        },
      ],
      sys_permission_set: [
        {
          id: 'pst_1',
          name: 'admin_full_access',
          active: true,
          system_permissions: ['view_all_records'],
          tab_permissions: { setup: 'visible' },
        },
        { id: 'pst_2', name: 'contributor_set', active: true },
      ],
    },
  },

  // camelCase-only rows: every `snake ?? camel` chain must fall through to its
  // second limb, which is the only way the camelCase spellings are observed.
  'camelCase-only rows': {
    org: 'org_1',
    tables: {
      sys_user: [{ id: 'usr_1', email: 'ada@example.com', ai_access: true }],
      sys_member: [{ id: 'mem_1', userId: 'usr_1', organizationId: 'org_1', role: 'admin' }],
      sys_user_position: [{ id: 'upo_1', userId: 'usr_1', position: 'contributor' }],
      sys_position: [{ id: 'pos_1', name: 'contributor', active: true }],
      sys_position_permission_set: [{ positionId: 'pos_1', permissionSetId: 'pst_2' }],
      sys_user_permission_set: [{ id: 'ups_1', userId: 'usr_1', permissionSetId: 'pst_1' }],
      sys_permission_set: [
        {
          id: 'pst_1',
          name: 'admin_full_access',
          active: true,
          systemPermissions: ['view_all_records'],
          tabPermissions: { setup: 'visible' },
        },
        { id: 'pst_2', name: 'contributor_set', active: true },
      ],
    },
  },

  // Standing taken away every way the resolver knows: the set switched off
  // (ADR-0049), the grant scoped to an organization, the window closed
  // (ADR-0091), the position deactivated, and the JSON blobs stored as strings.
  'standing revoked every way': {
    org: 'org_1',
    tables: {
      sys_user: [{ id: 'usr_1', email: 'ada@example.com', ai_access: 0 }],
      sys_member: [
        {
          id: 'mem_1',
          user_id: 'usr_1',
          organization_id: 'org_1',
          role: 'member',
          valid_from: new Date(NOW - HOUR).toISOString(),
          valid_until: new Date(NOW + HOUR).toISOString(),
        },
      ],
      sys_user_position: [
        {
          id: 'upo_1',
          user_id: 'usr_1',
          position: 'contributor',
          organization_id: 'org_1',
          valid_from: new Date(NOW - HOUR).toISOString(),
          valid_until: new Date(NOW - 1).toISOString(),
        },
      ],
      sys_position: [{ id: 'pos_1', name: 'contributor', active: false }],
      sys_position_permission_set: [{ position_id: 'pos_1', permission_set_id: 'pst_2' }],
      sys_user_permission_set: [
        {
          id: 'ups_1',
          user_id: 'usr_1',
          permission_set_id: 'pst_1',
          organization_id: 'org_1',
          valid_from: new Date(NOW - HOUR).toISOString(),
          valid_until: new Date(NOW + HOUR).toISOString(),
        },
      ],
      sys_permission_set: [
        {
          id: 'pst_1',
          name: 'admin_full_access',
          active: false,
          system_permissions: JSON.stringify(['view_all_records']),
          tab_permissions: JSON.stringify({ setup: 'visible' }),
        },
        { id: 'pst_2', name: 'contributor_set', active: true },
      ],
    },
  },

  // [#11663 L2] The CONFIG anchor. No grant row anywhere: standing comes from
  // the declared administrator list matched against this row's own `email`,
  // gated on `email_verified`. This is the only variant in which those two
  // columns are read at all, which is why the union needs it — without it the
  // declaration below would have to omit them and the correspondence gate in
  // plugin-auth would stop demanding a disposition for the very columns a
  // write can revoke standing through.
  'config-anchored platform admin': {
    platformAdminEmails: 'ada@example.com',
    tables: {
      sys_user: [
        { id: 'usr_1', email: 'ada@example.com', email_verified: true, ai_access: 0 },
      ],
      sys_member: [],
      sys_user_position: [],
      sys_position: [],
      sys_position_permission_set: [],
      sys_user_permission_set: [],
      sys_permission_set: [],
    },
  },
};

/**
 * Run `body` with `OS_PLATFORM_OWNER_EMAIL` set to exactly `value` (deleted when
 * `undefined`), and the config memo dropped on BOTH sides.
 *
 * The memo is keyed on the raw string, so a worker that has already resolved
 * one value would otherwise answer the next variant from the previous one's
 * parse. Restoring the ambient value matters too: this suite must not decide
 * what the rest of the worker's tests see.
 */
async function withPlatformAdminEmails<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
  const prev = process.env.OS_PLATFORM_OWNER_EMAIL;
  if (value === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = value;
  resetPlatformAdminEmailMemo();
  try {
    return await body();
  } finally {
    if (prev === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
    else process.env.OS_PLATFORM_OWNER_EMAIL = prev;
    resetPlatformAdminEmailMemo();
  }
}

async function observe(variant: keyof typeof VARIANTS): Promise<Observation> {
  const seen: Observation = new Map();
  const { tables, org, platformAdminEmails } = VARIANTS[variant]!;
  await withPlatformAdminEmails(platformAdminEmails, () =>
    resolveAuthzContext({
      ql: makeRecordingQl(tables, seen),
      headers: headers(),
      getSession: sessionFor('usr_1', org),
      nowMs: NOW,
    }),
  );
  return seen;
}

async function observeAll(): Promise<Observation> {
  const union: Observation = new Map();
  for (const name of Object.keys(VARIANTS)) {
    const seen = await observe(name);
    for (const [table, cols] of seen) {
      const into = union.get(table) ?? new Set<string>();
      for (const col of cols) into.add(col);
      union.set(table, into);
    }
  }
  return union;
}

const sorted = (s: Iterable<string>): string[] => [...s].sort();

describe('[#8734] ADMIN_STANDING_SURFACE is what resolveAuthzContext actually reads', () => {
  it('declares every table the resolution path reads — a new one must be classified', async () => {
    const union = await observeAll();
    expect(sorted(union.keys())).toEqual(sorted(Object.keys(ADMIN_STANDING_SURFACE)));
  });

  it.each(adminStandingTables())(
    'declares exactly the columns read on %s',
    async (table) => {
      const union = await observeAll();
      const observed = sorted(union.get(table) ?? []);
      const declared = sorted(ADMIN_STANDING_SURFACE[table]!.columns ?? []);
      // Equality, not containment, in BOTH directions on purpose. An undeclared
      // read is the #8613 defect. A declared column nothing reads is the stale
      // comment this file replaced, and left alone it would go on demanding a
      // guard entry for a column that stopped mattering.
      expect(observed).toEqual(declared);
    },
  );

  it('reaches the platform-admin derivation — otherwise the observation proves nothing', async () => {
    const ctx = await withPlatformAdminEmails(undefined, () =>
      resolveAuthzContext({
        ql: makeRecordingQl(VARIANTS['snake-case rows, standing intact']!.tables, new Map()),
        headers: headers(),
        getSession: sessionFor('usr_1', 'org_1'),
        nowMs: NOW,
      }),
    );
    // A positive control on the fixture itself: if the happy variant ever stops
    // resolving a platform admin, every column below it goes unobserved and the
    // equality above starts passing over a path nothing walked.
    expect(ctx.positions).toContain('platform_admin');
    expect(ctx.posture).toBe('PLATFORM_ADMIN');
  });

  it('keeps the variants distinct — a variant that stops contributing narrows the union silently', async () => {
    const perVariant = new Map<string, string>();
    for (const name of Object.keys(VARIANTS)) {
      const seen = await observe(name);
      const signature = sorted(seen.keys())
        .map((t) => `${t}:${sorted(seen.get(t)!).join(',')}`)
        .join('|');
      perVariant.set(name, signature);
    }
    expect(new Set(perVariant.values()).size).toBe(perVariant.size);
  });

  it('[#11663 L2] the config variant reaches the CONFIG anchor, not a grant', async () => {
    // The second positive control, for the second anchor. Without it the two
    // new sys_user columns could go unobserved (the branch never taken) and the
    // equality above would start passing over a path nothing walked — the exact
    // shape the fixture-variant note at the top of this file warns about.
    const v = VARIANTS['config-anchored platform admin']!;
    const ctx = await withPlatformAdminEmails(v.platformAdminEmails, () =>
      resolveAuthzContext({
        ql: makeRecordingQl(v.tables, new Map()),
        headers: headers(),
        getSession: sessionFor('usr_1', v.org),
        nowMs: NOW,
      }),
    );
    expect(ctx.posture).toBe('PLATFORM_ADMIN');
    expect(ctx.positions).toContain('platform_admin');
    // …and it really is the config route: there is no grant row in the fixture.
    expect(v.tables.sys_user_permission_set).toEqual([]);
  });

  it('every declared table carries a reason, and only deriving tables carry columns', () => {
    for (const [table, entry] of Object.entries(ADMIN_STANDING_SURFACE)) {
      expect(entry.reason.length, `${table} needs a reason`).toBeGreaterThan(40);
      if (entry.role === 'derives') {
        expect(entry.columns, `${table} derives standing and must declare its columns`).toBeDefined();
      } else {
        expect(entry.columns, `${table} reads only and must not declare columns`).toBeUndefined();
      }
    }
  });
});
