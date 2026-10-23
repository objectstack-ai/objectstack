// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15972 — a tenant can no longer mint a row spelling a built-in identity name.
 *
 * PR #15948 closed every in-repo READER that turned such a name into authority.
 * It could not stop the row existing, and a reader is not an invariant: an
 * out-of-repo consumer that reads the NAME instead of the capability rung
 * reopens the hole with nothing mechanical to catch it. This suite pins the
 * write-side refusal that makes the row impossible instead.
 *
 * Maintainer ruling (director seat, summon #20, decision batch #105 item 4,
 * 2026-09-09), verbatim on the three questions the card left open:
 *
 *   1. 「the object layer — `sys_position.name` … refuses the reserved names,
 *      so every door (data API, seed, import) is covered; the service write
 *      door reuses the same predicate rather than a second copy」
 *   2. 「exactly the ADR-0068 built-in identity names, read from the spec
 *      constant that declares them (closed enumeration, ⛔ not retyped, ⛔ not
 *      widened to `org_*` shapes by pattern)」
 *   3. 「refuse new writes only. No migration.」
 *
 * ## Why the engine legs are here and not only a declaration pin
 *
 * A `validations[]` entry is inert unless the write path evaluates it, and the
 * whole defect this card closes is a rule that existed only as prose. So the
 * refusals below are measured on a REAL engine over a real SQL driver, and each
 * one is paired with a NEGATIVE CONTROL that still writes — a refusal suite
 * with no control cannot tell "the reserved names are refused" from "the object
 * is refusing everything".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL, VALIDATION_FAILED_CODE } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { BUILTIN_IDENTITY_NAMES } from '@objectstack/spec';

import { SysUserPosition } from './sys-user-position.object.js';
import {
  RESERVED_IDENTITY_NAMES,
  isReservedIdentityName,
  reservedIdentityNamesCelList,
  reservedIdentityNameMessage,
} from './reserved-identity-names.js';
import { DelegatedAdminGate } from '../delegated-admin-gate.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.reserved-identity-names-15972',
    name: 'Reserved identity names',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPosition],
  } as any);
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  engines.push(engine);
  return engine;
}

/** A tenant admin's write context: authenticated, NOT `isSystem`. */
const TENANT_CTX = { userId: 'u_tenant_admin' } as any;

/**
 * The refusal, identified by `code` — never by `instanceof` and never by a bare
 * `toThrow()`. `@objectstack/objectql` publishes both realms in its `exports`,
 * so a consumer holding the other realm's copy of `ValidationError` gets
 * `instanceof === false`; and a throw-shaped assertion stays green when a
 * DIFFERENT refusal fires one step earlier, which on this object is exactly the
 * confusion to avoid (the name index answers `UNIQUE_VIOLATION` for a name the
 * platform seed already holds).
 */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

describe('#15972 the reserved set is IMPORTED from the spec constant, never retyped', () => {
  it('IS `BUILTIN_IDENTITY_NAMES` — the constant that declares the identities', () => {
    // Value equality AND membership equality: a re-spelled array with the same
    // strings would satisfy `toEqual`, so the five names are also asserted
    // to arrive in the same order the declaration ships them.
    expect([...RESERVED_IDENTITY_NAMES]).toEqual([...BUILTIN_IDENTITY_NAMES]);
    expect(RESERVED_IDENTITY_NAMES).toHaveLength(5);
  });

  it('is a CLOSED enumeration — ⛔ not an `org_*` pattern', () => {
    // The ruling refuses the pattern reading explicitly. `org_manager` is a
    // perfectly ordinary tenant position name and MUST stay writable; a
    // prefix test would have swallowed it.
    expect(isReservedIdentityName('org_admin')).toBe(true);
    expect(isReservedIdentityName('org_manager')).toBe(false);
    expect(isReservedIdentityName('org_')).toBe(false);
    expect(isReservedIdentityName('platform_admin_deputy')).toBe(false);
    // Not a string, and the empty string: neither is a name.
    expect(isReservedIdentityName(undefined)).toBe(false);
    expect(isReservedIdentityName(null)).toBe(false);
    expect(isReservedIdentityName('')).toBe(false);
  });

  it('renders a CEL list literal whose members need no escaping', () => {
    const list = reservedIdentityNamesCelList();
    for (const name of BUILTIN_IDENTITY_NAMES) expect(list).toContain(`'${name}'`);
    // ⛔ The escaping assertion is the load-bearing one: a name carrying a
    // single quote would produce a predicate that cannot PARSE, and an
    // unparseable predicate is rejected fail-closed on every write (#4649) —
    // i.e. the object would be bricked rather than guarded. ADR-0068 D2 names
    // are `[a-z_]` machine names, and this is where that stays true.
    for (const name of BUILTIN_IDENTITY_NAMES) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

describe('#15972 the assignment door reads the GENERATED list — one predicate, no second copy', () => {
  // [C3 stage 8] The `sys_position` row object and its copy of the rule are
  // retired (ADR-0131 D3): a position is a catalog definition, refused by the
  // metadata door. The assignment row keeps the rule.
  const assignmentRule: any = (SysUserPosition.validations ?? []).find((v: any) => v.name === 'reserved_identity_position');

  it('sys_user_position declares the rule, at `error` severity', () => {
    expect(assignmentRule).toBeDefined();
    // ⛔ `warning` / `info` are LOGGED and never throw — a reserved-name rule at
    // either level is a rule that refuses nothing.
    expect(assignmentRule.severity).toBe('error');
    expect(assignmentRule.condition.source).toContain(reservedIdentityNamesCelList());
  });

  it('carries the shared wording, parameterised by the column', () => {
    expect(assignmentRule.message).toBe(reservedIdentityNameMessage('position'));
  });

  it('takes no provenance exemption', () => {
    expect(assignmentRule.condition.source).not.toContain('managed_by');
  });
});

describe('#15972 sys_user_position — the ROW the card is about', () => {
  it.each([...BUILTIN_IDENTITY_NAMES])('refuses an assignment row spelling %s', async (name) => {
    const engine = await boot();
    const err = await refusalOf(() => (engine as any).insert(
      'sys_user_position',
      { id: `a_${name}`, user_id: 'u_victim', position: name },
      { context: TENANT_CTX },
    ));
    expect(err.code).toBe(VALIDATION_FAILED_CODE);
    expect(err.message).toContain('framework-reserved built-in identity name');
  });

  it('takes NO system exemption — nothing legitimate writes one, so nobody may', async () => {
    const engine = await boot();
    const err = await refusalOf(() => (engine as any).insert(
      'sys_user_position',
      { id: 'a_sys', user_id: 'u_victim', position: 'platform_admin' },
      { context: { isSystem: true } },
    ));
    expect(err.code).toBe(VALIDATION_FAILED_CODE);
  });

  it('NEGATIVE CONTROL — an ordinary position assignment still writes', async () => {
    const engine = await boot();
    await expect((engine as any).insert(
      'sys_user_position',
      { id: 'a_ok', user_id: 'u_victim', position: 'sales_manager' },
      { context: TENANT_CTX },
    )).resolves.toBeTruthy();
  });

  it('refuses a RE-POINT of an existing assignment onto a reserved name', async () => {
    const engine = await boot();
    await (engine as any).insert(
      'sys_user_position', { id: 'a_move', user_id: 'u_victim', position: 'sales_manager' }, { context: TENANT_CTX },
    );
    const err = await refusalOf(() => (engine as any).update(
      'sys_user_position', { id: 'a_move', position: 'org_owner' }, { context: TENANT_CTX },
    ));
    expect(err.code).toBe(VALIDATION_FAILED_CODE);
  });
});

/**
 * The SERVICE WRITE DOOR — ADR-0090 D12 delegated administration.
 *
 * The ruling asks the service door to reuse the same predicate «rather than a
 * second copy». It reuses it by INHERITING it: the gate is a hook on the same
 * engine write, so an assignment that clears the gate still meets the object
 * layer's refusal — one condition, one code, one wording, at both doors.
 *
 * The first leg re-measures the card's own finding, which is the reason the
 * gate cannot be the place this is refused: `assertAssignmentWrite` judges a
 * position by the permission sets it DISTRIBUTES, and the seeded
 * `platform_admin` position distributes none, so `boundSets.every(…)` approves
 * it VACUOUSLY. A delegate with `manageAssignments` therefore reaches the write
 * — and is refused by the object layer, not by the gate.
 */
describe('#15972 the service write door funnels into the same single refusal', () => {
  const EAST_SCOPE = {
    businessUnit: 'east',
    includeSubtree: true,
    manageAssignments: true,
    assignablePermissionSets: ['sales_user'],
  };

  function gateHarness() {
    const tables: Record<string, any[]> = {
      sys_business_unit: [{ id: 'bu_east', name: 'east', parent_business_unit_id: null }],
      sys_position: [{ id: 'pos_platform_admin', name: 'platform_admin' }],
      sys_permission_set: [{ id: 'ps_sales', name: 'sales_user' }],
      // ⛔ Deliberately EMPTY: the seeded `platform_admin` position binds no
      // permission set. That is the vacuity the card measured.
      sys_position_permission_set: [],
      sys_user_position: [],
      sys_business_unit_member: [{ id: 'm1', business_unit_id: 'bu_east', user_id: 'u_victim' }],
      sys_user: [{ id: 'u_delegate' }, { id: 'u_victim' }],
    };
    const matches = (row: any, where: any): boolean =>
      Object.entries(where ?? {}).every(([k, v]) => {
        // ⛔ REFUSE what this double does not implement. A `$and` / `$or` read
        // as a field name is the silently-wrong shape: every row fails the
        // lookup, the gate sees an empty result, and the assertion passes for
        // a reason that has nothing to do with what it claims to measure.
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
        if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
        return row[k] === v;
      });
    const ql = {
      async find(object: string, opts: any) {
        const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      },
      async findOne(object: string, opts: any) {
        return (tables[object] ?? []).filter((r) => matches(r, opts?.where))[0] ?? null;
      },
    } as any;
    return new DelegatedAdminGate({
      ql,
      resolveSets: async () => [
        { name: 'sub_admin', objects: { sys_user_position: { allowRead: true, allowCreate: true } }, adminScope: EAST_SCOPE } as any,
      ],
    });
  }

  it('the gate APPROVES the assignment — `boundSets.every(…)` is vacuous (re-measured)', async () => {
    const gate = gateHarness();
    await expect(gate.assert({
      object: 'sys_user_position',
      operation: 'insert',
      data: { user_id: 'u_victim', position: 'platform_admin', business_unit_id: 'bu_east' },
      context: { userId: 'u_delegate' },
    })).resolves.toBeUndefined();
  });

  it('…and the write is refused anyway, with the object layer’s ONE code', async () => {
    const engine = await boot();
    const err = await refusalOf(() => (engine as any).insert(
      'sys_user_position',
      { id: 'a_delegate', user_id: 'u_victim', position: 'platform_admin', business_unit_id: 'bu_east' },
      { context: { userId: 'u_delegate' } },
    ));
    expect(err.code).toBe(VALIDATION_FAILED_CODE);
  });
});
