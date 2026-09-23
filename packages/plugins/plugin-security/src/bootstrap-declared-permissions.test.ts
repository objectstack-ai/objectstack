// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi } from 'vitest';
import {
  bootstrapDeclaredPermissions,
  upsertPackagePermissionSet,
} from './bootstrap-declared-permissions.js';
import {
  PERMISSION_SET_DECLARATION_UNOWNED,
  PERMISSION_SET_ROWS_UNREADABLE,
} from './seed-refusal-diagnostics.js';
import { permissionSetRowFields } from './permission-set-projection.js';

/** [#18091] Seeded from this file, for the class pin at the bottom. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Minimal in-memory ql + registry for sys_permission_set seeding. */
function makeQl(declared: any[] = []) {
  const rows: any[] = [];
  return {
    rows,
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
    async find(object: string, q: any) {
      if (object !== 'sys_permission_set') return [];
      const where = q?.where ?? {};
      // Membership is modelled because the real engine supports it and the
      // #10946 boot seeders now hoist ONE `$in` existence read out of their
      // loop. A double that silently answered `[]` to `$in` would report
      // "nothing is seeded" and make every re-seed look like a first boot.
      return rows.filter((r) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const inList = (v as any).$in;
          if (Array.isArray(inList)) return inList.includes(r[k]);
          throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
        }
        return r[k] === v;
      }));
    },
    async insert(object: string, data: any) {
      if (object !== 'sys_permission_set') return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      if (object !== 'sys_permission_set') return;
      const r = rows.find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
  };
}

const declaredSet = (over: Record<string, any> = {}) => ({
  name: 'crm_sales_rep',
  label: 'Sales Rep',
  objects: { crm_lead: { allowRead: true, allowCreate: true } },
  fields: { 'crm_lead.amount': { readable: true, editable: false } },
  systemPermissions: ['crm.use'],
  _packageId: 'com.example.crm',
  ...over,
});

describe('bootstrapDeclaredPermissions (ADR-0086 D5)', () => {
  it('seeds a declared set as a package-managed sys_permission_set row', async () => {
    const ql = makeQl([declaredSet()]);
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.seeded).toBe(1);
    const row = ql.rows[0];
    expect(row.name).toBe('crm_sales_rep');
    expect(row.managed_by).toBe('package');
    expect(row.package_id).toBe('com.example.crm');
    expect(JSON.parse(row.object_permissions)).toEqual({ crm_lead: { allowRead: true, allowCreate: true } });
    expect(JSON.parse(row.field_permissions)).toEqual({ 'crm_lead.amount': { readable: true, editable: false } });
    expect(JSON.parse(row.system_permissions)).toEqual(['crm.use']);
    expect(row.active).toBe(true);
  });

  it('is idempotent + upgrade-aware: re-seeds its OWN row to the shipped declaration', async () => {
    const ql = makeQl([declaredSet()]);
    await bootstrapDeclaredPermissions(ql, undefined);
    // simulate a package upgrade changing the shipped grants
    (ql as any).registry = {
      listItems: () => [declaredSet({ objects: { crm_lead: { allowRead: true } } })],
    };
    const r2 = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r2.seeded).toBe(0);
    expect(r2.updated).toBe(1);
    expect(ql.rows.length).toBe(1);
    expect(JSON.parse(ql.rows[0].object_permissions)).toEqual({ crm_lead: { allowRead: true } });
  });

  it('never clobbers env-authored rows (platform/user/legacy provenance)', async () => {
    const ql = makeQl([declaredSet({ name: 'member_default' })]);
    // pre-existing row WITHOUT provenance (legacy / bootstrapPlatformAdmin default)
    ql.rows.push({ id: 'ps_legacy', name: 'member_default', object_permissions: '{"x":{"allowRead":true}}' });
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.seeded).toBe(0);
    expect(r.updated).toBe(0);
    expect(r.skippedEnvAuthored).toBe(1);
    expect(ql.rows[0].object_permissions).toBe('{"x":{"allowRead":true}}');
    expect(ql.rows[0].managed_by).toBeUndefined();
  });

  it('refuses to write into a row owned by a DIFFERENT package', async () => {
    const ql = makeQl([declaredSet({ _packageId: 'com.example.other' })]);
    ql.rows.push({
      id: 'ps_1', name: 'crm_sales_rep', managed_by: 'package', package_id: 'com.example.crm',
      object_permissions: '{}',
    });
    const warns: any[] = [];
    const r = await bootstrapDeclaredPermissions(ql, undefined, {
      logger: { info: () => {}, warn: (m, meta) => warns.push({ m, meta }) },
    });
    expect(r.skippedForeign).toBe(1);
    expect(ql.rows[0].package_id).toBe('com.example.crm');
    // [#17516] Re-anchored from the old prose ('owned by another package') to
    // the stable token the report now stamps. The substance this pin asserts is
    // unchanged — the refusal is reported — but the token is what an operator
    // greps and what the sibling doors key on, so prose drift can no longer
    // quietly unpin it. The read-back half is asserted beside it: a counter
    // with no record is what made this drop invisible.
    expect(warns.some((w) => String(w.m).includes('permission_set_name_collision'))).toBe(true);
    expect(r.collisions).toEqual([
      expect.objectContaining({ name: 'crm_sales_rep', declaredBy: 'com.example.other', ownedBy: 'com.example.crm' }),
    ]);
  });

  it('skips a declared set with no resolvable owning package (warned, not seeded)', async () => {
    const ql = makeQl([declaredSet({ _packageId: undefined })]);
    const warns: string[] = [];
    const r = await bootstrapDeclaredPermissions(ql, undefined, {
      logger: { info: () => {}, warn: (m) => warns.push(m) },
    });
    expect(r.seeded).toBe(0);
    expect(ql.rows.length).toBe(0);
    expect(warns.some((w) => w.includes('no owning package'))).toBe(true);
  });

  it('falls back to the spec-declared packageId (ADR-0086 D3) when registry provenance is absent', async () => {
    const ql = makeQl([declaredSet({ _packageId: undefined, packageId: 'com.example.declared' })]);
    const r = await bootstrapDeclaredPermissions(ql, undefined);
    expect(r.seeded).toBe(1);
    expect(ql.rows[0].package_id).toBe('com.example.declared');
  });
});

// ADR-0086 P2 块1 — the publish-time materializer shares this helper. Here the
// packageId is supplied explicitly (the draft's binding), not read off the body.
describe('upsertPackagePermissionSet (ADR-0086 P2 — publish materialization)', () => {
  const publishedBody = (over: Record<string, any> = {}) => ({
    name: 'crm_sales_rep',
    label: 'Sales Rep',
    objects: { crm_lead: { allowRead: true } },
    ...over,
  });

  it('materializes a published set into a package-managed row under the draft packageId', async () => {
    const ql = makeQl();
    const r = await upsertPackagePermissionSet(ql, publishedBody(), 'com.example.crm');
    expect(r.seeded).toBe(1);
    expect(ql.rows[0].managed_by).toBe('package');
    expect(ql.rows[0].package_id).toBe('com.example.crm');
    expect(JSON.parse(ql.rows[0].object_permissions)).toEqual({ crm_lead: { allowRead: true } });
  });

  it('re-publish of its OWN row updates in place (idempotent)', async () => {
    const ql = makeQl();
    await upsertPackagePermissionSet(ql, publishedBody(), 'com.example.crm');
    const r2 = await upsertPackagePermissionSet(
      ql, publishedBody({ objects: { crm_lead: { allowRead: true, allowEdit: true } } }), 'com.example.crm',
    );
    expect(r2.updated).toBe(1);
    expect(ql.rows.length).toBe(1);
    expect(JSON.parse(ql.rows[0].object_permissions)).toEqual({ crm_lead: { allowRead: true, allowEdit: true } });
  });

  it('refuses to clobber an env-authored row of the same name (two-doors: env door owns it)', async () => {
    const ql = makeQl();
    ql.rows.push({ id: 'ps_env', name: 'crm_sales_rep', managed_by: 'user', object_permissions: '{"kept":true}' });
    const r = await upsertPackagePermissionSet(ql, publishedBody(), 'com.example.crm');
    expect(r.skippedEnvAuthored).toBe(1);
    expect(r.seeded + r.updated).toBe(0);
    expect(ql.rows[0].object_permissions).toBe('{"kept":true}');
  });

  it('refuses a name owned by a DIFFERENT package', async () => {
    const ql = makeQl();
    ql.rows.push({ id: 'ps_1', name: 'crm_sales_rep', managed_by: 'package', package_id: 'com.example.other', object_permissions: '{}' });
    const r = await upsertPackagePermissionSet(ql, publishedBody(), 'com.example.crm');
    expect(r.skippedForeign).toBe(1);
    expect(ql.rows[0].package_id).toBe('com.example.other');
  });

  it('skips (does not materialize) when the publish carries no packageId', async () => {
    const ql = makeQl();
    const warns: string[] = [];
    const r = await upsertPackagePermissionSet(ql, publishedBody(), null, { info: () => {}, warn: (m) => warns.push(m) });
    expect(r.seeded).toBe(0);
    expect(ql.rows.length).toBe(0);
    expect(warns.some((w) => w.includes('no owning package'))).toBe(true);
  });
});

// The environment door (env-scope saves, the data-door write-through, boot
// reconciliation) moved to permission-set-projection.test.ts (ADR-0094).

// ───────────────────────────────────────────────────────────────────────────
// [#18091] The two refusals #17516 left behind in this seeder. Measured mute on
// the pre-fix tree with no logger injected — author-visible lines = 0 at both,
// while the already-repaired collision path in the same harness read 1.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Capture EVERY console channel — "author-visible output" is not
 * channel-specific, and a pin watching only `warn` could be satisfied by a
 * change that merely MOVED the silence.
 */
function captureAllConsole() {
  const seen: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      seen.push(`${m}: ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    }),
  );
  return { seen, restore: () => spies.forEach((s) => s.mockRestore()) };
}

/** `makeQl` with a read that cannot answer — the `unreadable` branch's only entry. */
function unreadableQl(declared: any[]) {
  const ql = makeQl(declared);
  (ql as any).find = async () => { throw new Error('sys_permission_set is unreachable'); };
  return ql;
}

describe('[#18091] the two remaining permission-set refusals reach the author', () => {
  it('UNOWNED DECLARATION: prints with NO LOGGER INJECTED, and names the RECORD as what is lost', async () => {
    const ql = makeQl([declaredSet({ _packageId: undefined })]);

    const cap = captureAllConsole();
    let r: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      r = await bootstrapDeclaredPermissions(ql, undefined);
    } finally {
      cap.restore();
    }

    // ── The reading this card moves: 0 → 1 ──────────────────────────────────
    expect(cap.seen).toHaveLength(1);
    expect(cap.seen[0]!.startsWith('warn: ')).toBe(true);
    expect(cap.seen[0]).toContain(PERMISSION_SET_DECLARATION_UNOWNED);
    expect(cap.seen[0]).toContain('crm_sales_rep');
    expect(cap.seen[0]).toContain('has no owning package');
    // ── THIS site's consequence. ⛔ NOT the capability axis': the evaluator
    //    resolves declared sets through the metadata registry, so every grant
    //    keeps working and only the RECORD is missing. An author told merely
    //    "not materialized" goes looking for a denied user who does not exist.
    expect(cap.seen[0]).toContain('keep working');
    expect(cap.seen[0]).toContain('Setup admin surface');
    expect(cap.seen[0]).toContain('ADR-0086 D3');

    // ── ⛔ The refusal itself is UNCHANGED ───────────────────────────────────
    expect(r.seeded).toBe(0);
    expect(ql.rows).toHaveLength(0);
  });

  it('UNOWNED DECLARATION reaches the author through the ADR-0086 P2 PUBLISH door too', async () => {
    // ⚠️ The second door onto the same branch: the publish materializer upserts
    // ONE set and passes no collector, so a fix that only lit the boot loop
    // would leave this caller exactly as mute as before.
    const ql = makeQl();

    const cap = captureAllConsole();
    let r: Awaited<ReturnType<typeof upsertPackagePermissionSet>>;
    try {
      r = await upsertPackagePermissionSet(ql, declaredSet({ _packageId: undefined }), null);
    } finally {
      cap.restore();
    }

    expect(cap.seen).toHaveLength(1);
    expect(cap.seen[0]).toContain(PERMISSION_SET_DECLARATION_UNOWNED);
    expect(r.seeded).toBe(0);
    expect(ql.rows).toHaveLength(0);
  });

  it('UNREADABLE ROWS: prints with NO LOGGER INJECTED, with the count and the consequence', async () => {
    const ql = unreadableQl([declaredSet(), declaredSet({ name: 'crm_manager' })]);

    const cap = captureAllConsole();
    let r: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      r = await bootstrapDeclaredPermissions(ql, undefined);
    } finally {
      cap.restore();
    }

    expect(r.unreadable).toBe(2);
    const line = cap.seen.find((l) => l.includes(PERMISSION_SET_ROWS_UNREADABLE));
    expect(line).toBeDefined();
    expect(line!.startsWith('warn: ')).toBe(true);
    expect(line).toContain('2 of 2');
    // Silence here reads exactly like "everything was already in order", so the
    // line has to say what did NOT happen — and that no grant is denied by it.
    expect(line).toContain('neither seeded nor reconciled');
    expect(line).toContain('no grant is');
    // ⛔ Unchanged: an unreadable read writes nothing.
    expect(ql.rows).toHaveLength(0);
  });

  it('⭐ each site keeps its OWN sentence — ⛔ never one generic refusal line', async () => {
    const cap = captureAllConsole();
    try {
      await bootstrapDeclaredPermissions(makeQl([declaredSet({ _packageId: undefined })]), undefined);
      await bootstrapDeclaredPermissions(unreadableQl([declaredSet()]), undefined);
    } finally {
      cap.restore();
    }

    const unowned = cap.seen.find((l) => l.includes(PERMISSION_SET_DECLARATION_UNOWNED));
    const unreadable = cap.seen.find((l) => l.includes(PERMISSION_SET_ROWS_UNREADABLE));
    expect(unowned).toBeDefined();
    expect(unreadable).toBeDefined();
    // Each names a phrase only its own site can produce.
    expect(unowned).toContain('Setup admin surface');
    expect(unowned).not.toContain('could not be read');
    expect(unreadable).toContain('could not be read');
    expect(unreadable).not.toContain('ADR-0086 D3');
  });

  it('an INJECTED logger takes both, and the console stays clean', async () => {
    const warn = vi.fn();
    const cap = captureAllConsole();
    try {
      await bootstrapDeclaredPermissions(makeQl([declaredSet({ _packageId: undefined })]), undefined, { logger: { warn } });
      await bootstrapDeclaredPermissions(unreadableQl([declaredSet()]), undefined, { logger: { warn } });
    } finally {
      cap.restore();
    }

    // ⚠️ The second pass also trips the batched existence oracle's own
    // read-failure line — a different diagnostic in `seed-name-lookup.ts`,
    // outside this card — so filter by this card's tokens rather than counting.
    const events = warn.mock.calls.map((c) => (c[1] as any)?.event).filter(Boolean);
    expect(events).toEqual([PERMISSION_SET_DECLARATION_UNOWNED, PERMISSION_SET_ROWS_UNREADABLE]);
    expect(cap.seen).toEqual([]);
  });

  it('CONTROL: a pass that really seeds and refuses nothing is SILENT on all five channels', async () => {
    // ⛔ The discriminating half. Without it, a seeder that warned on every
    // declaration would satisfy every assertion above.
    const ql = makeQl([declaredSet()]);

    const cap = captureAllConsole();
    let r: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      r = await bootstrapDeclaredPermissions(ql, undefined);
    } finally {
      cap.restore();
    }

    expect(r.seeded).toBe(1);
    expect(cap.seen).toEqual([]);
  });

  it('a HOST SINK THAT LIES about its shape is reported to the console, never thrown at', async () => {
    // The old `logger?.warn?.()` bought safety against a plain-JS embedder with
    // silence; a bare `logger.warn()` would buy noise with a throw inside the
    // seeding pass. The `typeof` guard in `reportThroughSink` buys neither.
    const liar = { info: () => {} } as any;
    const cap = captureAllConsole();
    let r: Awaited<ReturnType<typeof bootstrapDeclaredPermissions>>;
    try {
      r = await bootstrapDeclaredPermissions(makeQl([declaredSet({ _packageId: undefined })]), undefined, { logger: liar });
    } finally {
      cap.restore();
    }
    expect(r.seeded).toBe(0);
    expect(cap.seen).toHaveLength(1);
    expect(cap.seen[0]).toContain(PERMISSION_SET_DECLARATION_UNOWNED);
  });

  it('⛔ CLASS PIN: the doubly-optional warn survives in this seeder only as PROSE', async () => {
    const source = readFileSync(resolve(HERE, 'bootstrap-declared-permissions.ts'), 'utf8');
    // Positive control — the pin is reading the file it thinks it is.
    expect(source).toContain('export async function bootstrapDeclaredPermissions');
    const hits = source.split('\n').filter((line) => line.includes('logger?.warn?.('));
    for (const line of hits) {
      expect(line.trimStart().startsWith('//') || line.trimStart().startsWith('*')).toBe(true);
    }
    // ⚠️ The INFO channel keeps its outer `?.` deliberately — a healthy pass
    // must stay silent on every console channel, per the CONTROL above.
    expect(source).toContain("options.logger?.info?.(");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#18571] The unowned refusal's PROGRAMMATIC half. #18564 gave this branch an
// author-visible line; the outcome still came back with every counter at zero,
// so a caller that reads no log at all could not tell a pass that refused a
// declaration from a pass with nothing to do. The capability axis has counted
// the same refusal at the same ADR-0086 D3 boundary since #4967.
// ───────────────────────────────────────────────────────────────────────────

/** Silent sink — these tests assert the COUNTER, and #18091 owns the line. */
const mute = () => ({ info: () => {}, warn: () => {} });

describe('[#18571] the unowned permission-set refusal moves a counter', () => {
  it('BOOT-LOOP DOOR: an unowned declaration increments skippedUnowned', async () => {
    const ql = makeQl([declaredSet({ _packageId: undefined })]);

    const r = await bootstrapDeclaredPermissions(ql, undefined, { logger: mute() });

    expect(r.skippedUnowned).toBe(1);
    // ⛔ The refusal itself is UNCHANGED — an unowned `managed_by:'package'`
    //    row is the ADR-0086 D3 ambiguity this branch exists to prevent.
    expect(ql.rows).toHaveLength(0);
    expect(r.seeded + r.updated + r.unchanged).toBe(0);
    // ⛔ And it lands in its OWN counter, never borrowed from a sibling: an
    //    unowned declaration is not a foreign row and not an env-authored one.
    expect(r.skippedForeign).toBe(0);
    expect(r.skippedEnvAuthored).toBe(0);
    expect(r.unreadable).toBe(0);
  });

  it('PUBLISH DOOR (ADR-0086 P2): the materializer increments it too', async () => {
    // ⚠️ The second door onto the same branch, and the reason testing one is
    // testing half: the publish materializer upserts ONE set and passes no
    // collector, so a fix wired into the boot loop's aggregation alone would
    // leave this caller's outcome exactly as silent as before.
    const ql = makeQl();

    const r = await upsertPackagePermissionSet(ql, declaredSet({ _packageId: undefined }), null, mute());

    expect(r.skippedUnowned).toBe(1);
    expect(ql.rows).toHaveLength(0);
    expect(r.seeded).toBe(0);
  });

  it('CONTROL: a pass that refuses nothing leaves it at 0 through both doors', async () => {
    // ⛔ The discriminating half. Without it, a counter incremented on every
    //    declaration would satisfy both assertions above.
    const boot = await bootstrapDeclaredPermissions(makeQl([declaredSet()]), undefined, { logger: mute() });
    expect(boot).toMatchObject({ seeded: 1, skippedUnowned: 0 });

    const publish = await upsertPackagePermissionSet(makeQl(), declaredSet(), 'com.example.crm', mute());
    expect(publish).toMatchObject({ seeded: 1, skippedUnowned: 0 });
  });

  it('⭐ CONSERVATION: every named declaration lands in exactly one counter', async () => {
    // Modelled on the capability axis' `materializedNames reconciles with the
    // outcome counters`. The point is not the six numbers — it is that they
    // SUM to the input, which is precisely what an uncounted refusal broke.
    const body = (name: string, over: Record<string, any> = {}) =>
      declaredSet({ name, _packageId: 'com.a', ...over });
    const sets = [
      body('crm_new'),                                     // → seeded
      body('crm_own', { label: 'Fresh' }),                 // → updated
      body('crm_same'),                                    // → unchanged
      body('crm_env'),                                     // → skippedEnvAuthored
      body('crm_foreign'),                                 // → skippedForeign
      declaredSet({ name: 'crm_orphan', _packageId: undefined }), // → skippedUnowned
    ];
    const ql = makeQl(sets);
    // Its own row, stale — the stored label is not what the declaration says.
    ql.rows.push({
      id: 'ps_own', name: 'crm_own', managed_by: 'package', package_id: 'com.a',
      ...permissionSetRowFields(body('crm_own', { label: 'Stale' })),
    });
    // Its own row, already converged — `recordDiffersFromBody` calls it equal,
    // so no UPDATE is issued and the name lands in `unchanged`, not `updated`.
    ql.rows.push({
      id: 'ps_same', name: 'crm_same', managed_by: 'package', package_id: 'com.a',
      ...permissionSetRowFields(body('crm_same')),
    });
    ql.rows.push({ id: 'ps_env', name: 'crm_env', managed_by: 'user', object_permissions: '{"kept":true}' });
    ql.rows.push({ id: 'ps_far', name: 'crm_foreign', managed_by: 'package', package_id: 'com.z', object_permissions: '{}' });

    const out = await bootstrapDeclaredPermissions(ql, undefined, { logger: mute() });

    expect(out).toMatchObject({
      seeded: 1, updated: 1, unchanged: 1,
      skippedEnvAuthored: 1, skippedForeign: 1, skippedUnowned: 1,
      unreadable: 0,
    });
    // ⚠️ The sum is taken over EVERY counter the outcome declares, so a future
    //    counter added without a home here fails this pin instead of hiding in
    //    a hand-picked subset — the failure mode `skippedUnowned` itself was.
    const counted = out.seeded + out.updated + out.unchanged
      + out.skippedEnvAuthored + out.skippedForeign + out.skippedUnowned + out.unreadable;
    expect(counted).toBe(sets.length);
    // …and the refusal that wrote nothing really wrote nothing: five inputs
    // reached a row, the sixth did not.
    expect(ql.rows.map((r) => r.name).sort()).toEqual(
      ['crm_env', 'crm_foreign', 'crm_new', 'crm_own', 'crm_same'],
    );
    expect(ql.rows.some((r) => r.name === 'crm_orphan')).toBe(false);
  });
});
