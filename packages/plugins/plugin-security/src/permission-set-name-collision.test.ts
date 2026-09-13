// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17516] The set-name collision refusal must REACH THE AUTHOR.
 *
 * ## What these pins are about, and what they deliberately do not touch
 *
 * ⛔ Not the skip. Refusing to write into a `sys_permission_set` row another
 * package owns is correct under ADR-0086 D4 and is asserted UNCHANGED in every
 * case below (`skippedForeign` still counts, the foreign row is never mutated).
 * The defect was that the refusal was invisible: `logger?.warn?.(…)` at that
 * branch is optionally chained TWICE, so a caller passing no logger produced no
 * output at all and an entire declared permission set disappeared with one
 * internal counter moved.
 *
 * ## The measurement these replace
 *
 * On the pre-fix tree the first case below measured ZERO console lines across
 * every channel, and `undefined` for the outcome's diagnostic records, while
 * `skippedForeign` was 1. That is the card's reading, reproduced.
 *
 * ## The discriminating half
 *
 * A pin that only asserts "something was printed on a collision" passes just as
 * well against a seeder that prints on EVERY seeded set, which would be a
 * different defect (#12015's: a diagnostic that fires always is as unreadable as
 * one that never fires). So the no-collision control asserts SILENCE on all
 * five console channels, over a pass that really does seed and really does
 * re-seed its own row.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import {
  bootstrapDeclaredPermissions,
  upsertPackagePermissionSet,
} from './bootstrap-declared-permissions.js';
import {
  PERMISSION_SET_NAME_COLLISION,
  formatPermissionSetNameCollisionDiagnostic,
  permissionSetNameCollisionDiagnostic,
  permissionSetNameIsForeign,
  reportPermissionSetNameCollisions,
} from './permission-set-name-collision.js';

/** Minimal in-memory ql + registry for sys_permission_set seeding. */
function makeQl(declared: any[] = []) {
  const rows: any[] = [];
  return {
    rows,
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
    async find(object: string, q: any) {
      if (object !== 'sys_permission_set') return [];
      const where = q?.where ?? {};
      const hits = rows.filter((r) => Object.entries(where).every(([k, v]) => {
        // ⛔ REFUSE what this double does not implement. A `$or` / `$and` read
        // as a FIELD NAME is the silently-wrong shape: `r.$or` is `undefined`,
        // no row matches, and a suite asserts on an empty result set with
        // nothing erroring (`check:where-matcher`, shape (b)). The sibling
        // double in `objects/reserved-identity-names.test.ts` refuses the same way.
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const inList = (v as any).$in;
          if (Array.isArray(inList)) return inList.includes(r[k]);
          throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
        }
        return r[k] === v;
      }));
      // Hold the caller's BOUND, after the filter and by PRESENCE, so `limit: 0`
      // returns nothing rather than everything. `defaultLookup` really does read
      // `{ where: { name }, limit: organizationId ? 5 : 1 }` (#10103), and a
      // limit-blind double cannot tell that read from an unbounded one
      // (`check:objectql-double-limit`).
      return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
    },
    async insert(object: string, data: any) {
      if (object !== 'sys_permission_set') return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    // `assertEngineUpdateDispatch` rather than a hand-rolled id check: a fake
    // looser than `ObjectQL.update` is how a dead route once shipped with its
    // suite green (`check:engine-double-contract`).
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (object !== 'sys_permission_set') return;
      if (dispatch.kind !== 'by-id') throw new Error('fake driver: only by-id update is modelled');
      const r = rows.find((x) => x.id === dispatch.id);
      if (r) Object.assign(r, data);
    },
  };
}

const declaredSet = (over: Record<string, any> = {}) => ({
  name: 'crm_sales_rep',
  label: 'Sales Rep',
  objects: { crm_lead: { allowRead: true } },
  _packageId: 'com.example.b',
  ...over,
});

/**
 * Capture EVERY console channel. "Author-visible output" is not channel-specific
 * — the pre-fix failure was that NONE of them carried anything — so a pin that
 * watched only `warn` could be satisfied by a change that moved the silence.
 */
function captureConsole() {
  const seen: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      seen.push(`${m}: ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    }),
  );
  return { seen, restore: () => spies.forEach((s) => s.mockRestore()) };
}

describe('[#17516] set-name collision reaches the author', () => {
  it('prints, WITH NO LOGGER INJECTED, and returns the diagnostic record', async () => {
    const ql = makeQl([declaredSet()]);
    ql.rows.push({
      id: 'ps_owned_by_a',
      name: 'crm_sales_rep',
      managed_by: 'package',
      package_id: 'com.example.a',
      object_permissions: '{}',
    });

    const cap = captureConsole();
    let out: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      // No logger — the exact call shape under which the old branch was mute.
      out = await bootstrapDeclaredPermissions(ql, undefined);
    } finally {
      cap.restore();
    }

    // ⛔ The refusal itself is UNCHANGED.
    expect(out.skippedForeign).toBe(1);
    expect(out.seeded).toBe(0);
    expect(out.updated).toBe(0);
    expect(ql.rows).toHaveLength(1);
    expect(ql.rows[0].package_id).toBe('com.example.a');
    expect(ql.rows[0].object_permissions).toBe('{}');

    // The half that was missing: the author is told, through the console,
    // because no sink was injected (#10556 — silent-by-declaration rejected).
    expect(cap.seen).toHaveLength(1);
    expect(cap.seen[0]).toContain(PERMISSION_SET_NAME_COLLISION);
    expect(cap.seen[0]).toMatch(/^warn:/);
    expect(cap.seen[0]).toContain('NOT materialized');

    // And the RECORD, for a caller that reads no log at all.
    expect(out.collisions).toHaveLength(1);
    const d = out.collisions![0]!;
    expect(d.event).toBe(PERMISSION_SET_NAME_COLLISION);
    expect(d.severity).toBe('warning');
    expect(d.name).toBe('crm_sales_rep');
    expect(d.declaredBy).toBe('com.example.b');
    expect(d.ownedBy).toBe('com.example.a');
    // The remedy names both legal resolutions, including the ADR-0130 D1 one
    // the old comment's premise denied could exist.
    expect(d.fix).toContain('ADR-0130 D1');
  });

  it('DISCRIMINATING CONTROL: a pass with no collision says nothing at all', async () => {
    // Two real writes happen here — a first seed and an own-row re-seed — so
    // the silence is over a pass that is doing work, not an empty one.
    const ql = makeQl([declaredSet({ _packageId: 'com.example.a' })]);

    const first = captureConsole();
    let r1: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      r1 = await bootstrapDeclaredPermissions(ql, undefined);
    } finally {
      first.restore();
    }
    expect(r1.seeded).toBe(1);
    expect(r1.skippedForeign).toBe(0);
    expect(r1.collisions).toBeUndefined();
    expect(first.seen).toEqual([]);

    // Re-seed the SAME package's own row after a declaration change.
    (ql as any).registry = {
      listItems: () => [declaredSet({ _packageId: 'com.example.a', objects: { crm_lead: { allowRead: true, allowCreate: true } } })],
    };
    const second = captureConsole();
    let r2: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      r2 = await bootstrapDeclaredPermissions(ql, undefined);
    } finally {
      second.restore();
    }
    expect(r2.updated).toBe(1);
    expect(r2.skippedForeign).toBe(0);
    expect(r2.collisions).toBeUndefined();
    expect(second.seen).toEqual([]);
  });

  it('reports through an INJECTED sink instead of the console when one is given', async () => {
    const ql = makeQl([declaredSet()]);
    ql.rows.push({
      id: 'ps_owned_by_a',
      name: 'crm_sales_rep',
      managed_by: 'package',
      package_id: 'com.example.a',
      object_permissions: '{}',
    });

    const warned: Array<{ m: string; meta?: Record<string, any> }> = [];
    const cap = captureConsole();
    try {
      await bootstrapDeclaredPermissions(ql, undefined, {
        logger: { warn: (m, meta) => { warned.push({ m, meta }); } },
      });
    } finally {
      cap.restore();
    }

    const collision = warned.filter((w) => w.m.includes(PERMISSION_SET_NAME_COLLISION));
    expect(collision).toHaveLength(1);
    expect(collision[0]!.meta?.collisions).toEqual([
      expect.objectContaining({ name: 'crm_sales_rep', declaredBy: 'com.example.b', ownedBy: 'com.example.a' }),
    ]);
    // The host sink REPLACES the console default — not both.
    expect(cap.seen).toEqual([]);
  });

  it('the ADR-0086 P2 single-set path reports too — it has no pass to summarise', async () => {
    const ql = makeQl();
    ql.rows.push({
      id: 'ps_owned_by_a',
      name: 'crm_sales_rep',
      managed_by: 'package',
      package_id: 'com.example.a',
      object_permissions: '{}',
    });

    const cap = captureConsole();
    let out: Awaited<ReturnType<typeof upsertPackagePermissionSet>>;
    try {
      // No logger, no collector — the publish materializer's exact call shape.
      out = await upsertPackagePermissionSet(ql, declaredSet(), 'com.example.b');
    } finally {
      cap.restore();
    }

    expect(out.skippedForeign).toBe(1);
    expect(out.collisions).toHaveLength(1);
    expect(cap.seen).toHaveLength(1);
    expect(cap.seen[0]).toContain(PERMISSION_SET_NAME_COLLISION);
  });

  it('a package-managed row with NO package_id is foreign, not adoptable', async () => {
    const ql = makeQl([declaredSet()]);
    // ADR-0086 D3's exact ambiguity: managed_by 'package', owner unprovable.
    ql.rows.push({
      id: 'ps_unowned',
      name: 'crm_sales_rep',
      managed_by: 'package',
      object_permissions: '{}',
    });

    const cap = captureConsole();
    let out: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      out = await bootstrapDeclaredPermissions(ql, undefined);
    } finally {
      cap.restore();
    }

    expect(out.skippedForeign).toBe(1);
    expect(out.updated).toBe(0);
    expect(ql.rows[0].object_permissions).toBe('{}');
    expect(out.collisions![0]!.ownedBy).toBeNull();
    expect(cap.seen).toHaveLength(1);
  });
});

describe('[#17516] the shared derivation both doors must use', () => {
  it('permissionSetNameIsForeign: same owner is ours, anything else is foreign', () => {
    expect(permissionSetNameIsForeign('com.example.a', 'com.example.a')).toBe(false);
    expect(permissionSetNameIsForeign('com.example.a', 'com.example.b')).toBe(true);
    // A nullish owner is FOREIGN — never silently adopted on a name match.
    expect(permissionSetNameIsForeign(undefined, 'com.example.b')).toBe(true);
    expect(permissionSetNameIsForeign(null, 'com.example.b')).toBe(true);
    // Both unowned is not a collision between two different packages.
    expect(permissionSetNameIsForeign(null, undefined)).toBe(false);
  });

  /**
   * The literal is asserted rather than only imported — the precedent the
   * sibling `position_name_fold_grant` pin sets. Importing it on both sides
   * would let a rename pass green while every operator's grep went dead.
   */
  it('stamps a stable, greppable token', () => {
    expect(PERMISSION_SET_NAME_COLLISION).toBe('permission_set_name_collision');
    const d = permissionSetNameCollisionDiagnostic({
      name: 'crm_sales_rep', declaredBy: 'com.example.b', ownedBy: 'com.example.a',
    });
    expect(formatPermissionSetNameCollisionDiagnostic(d))
      .toContain('[security] [permission_set_name_collision]');
  });

  it('reportPermissionSetNameCollisions says nothing when there is nothing to say', () => {
    const cap = captureConsole();
    try {
      reportPermissionSetNameCollisions(undefined, []);
    } finally {
      cap.restore();
    }
    expect(cap.seen).toEqual([]);
  });

  /**
   * The measured-and-rejected spelling next door: `(logger.warn ?? console.warn)(…)`
   * detaches the receiver, and a class-based host sink reaching for `this`
   * throws. Every double in this package is a plain closure and would survive
   * it, so the pin uses a real class.
   */
  it('keeps the receiver when the host sink is a class instance', () => {
    class HostSink {
      lines: string[] = [];
      warn(m: string): void { this.lines.push(m); }
    }
    const sink = new HostSink();
    const d = permissionSetNameCollisionDiagnostic({
      name: 'crm_sales_rep', declaredBy: 'com.example.b', ownedBy: 'com.example.a',
    });
    expect(() => reportPermissionSetNameCollisions(sink, [d])).not.toThrow();
    expect(sink.lines).toHaveLength(1);
  });
});
