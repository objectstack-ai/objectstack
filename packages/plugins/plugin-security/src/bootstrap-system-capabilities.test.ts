// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { bootstrapSystemCapabilities, KNOWN_CAPABILITIES } from './bootstrap-system-capabilities.js';

/**
 * Minimal in-memory ql for sys_capability seeding.
 *
 * [#8470] Three behaviours are modelled on purpose, and NOT because a test
 * needed them to pass: each was measured against `SqlDriver` on better-sqlite3
 * (better-sqlite3 fixture mirroring `sys-capability.object.ts`, including its
 * `{ fields: ['name'], unique: 'organization' }` index) before being written
 * here. The point of the exercise was #8470's own warning — that the ORIGINAL
 * fake returned rows in INSERTION order, which is a property of the double and
 * of no driver in the system, so a pin written against it could be green for a
 * reason the product does not have.
 *
 *  1. **`limit` orders by `id` ascending.** #4363 appends a pagination
 *     tie-breaker (`ORDER BY id`) to any paged read of a driver-managed table,
 *     and `limit: 1` counts as paged on `SqlDriver` and `MongoDBDriver` alike —
 *     only `findOne` opts out (`singleRowLookup`). Measured: with a platform row
 *     and an org row sharing a name, `find({ where: { name }, limit: 1 })`
 *     returned the row with the smaller `id` under BOTH insertion orders. So the
 *     seeder's lookup is not a coin flip; it is a stable choice made on a key
 *     unrelated to ownership. Insertion order is what the double used to model,
 *     and it models nothing.
 *  2. **A `null` comparand matches a null OR absent value.** `driver-sql`
 *     compiles `{ field: null }` to `IS NULL`; `driver-memory`'s matcher uses
 *     `value == condition`; MongoDB matches null-or-missing. Strict `===`, which
 *     this double used, matches NONE of them and would have made
 *     `organization_id: null` unsatisfiable here while working in production.
 *  3. **`insert` enforces the declared unique key**, `(COALESCE(organization_id,
 *     '__global__'), name)` — measured rejecting a second platform-bucket row
 *     for a name, and admitting an organization's row for that same name.
 *     `tryInsert` swallows the engine's refusal, which is why the seeder counts
 *     it (`blockedCurated`) rather than trusting silence.
 */
function makeQl() {
  const rows: any[] = [];
  /** The NULL-safe organization key part, ADR-0120 D3. */
  const bucketOf = (r: any): string =>
    r?.organization_id == null ? '__global__' : String(r.organization_id);
  return {
    rows,
    async find(object: string, q: any) {
      if (object !== 'sys_capability') return [];
      const where = q?.where ?? {};
      const matched = rows.filter((r) =>
        // (2) `null` is IS NULL, not `=== null`.
        Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return (v === null ? r[k] == null : r[k] === v); }),
      );
      if (q?.limit === undefined) return matched;
      // (1) The #4363 tie-breaker. BINARY collation, as SQLite compares ids.
      return [...matched]
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
        .slice(0, q.limit);
    },
    async insert(object: string, data: any) {
      if (object !== 'sys_capability') return null;
      // (3) One holder per (organization bucket, name).
      if (rows.some((r) => r.name === data.name && bucketOf(r) === bucketOf(data))) return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      if (object !== 'sys_capability') return;
      const r = rows.find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
  };
}

describe('bootstrapSystemCapabilities (ADR-0066 D1 back-compat seed)', () => {
  it('seeds the curated platform capabilities as records (idempotent)', async () => {
    const ql = makeQl();
    const r1 = await bootstrapSystemCapabilities(ql, []);
    expect(r1.seeded).toBe(KNOWN_CAPABILITIES.length);
    // every known capability is now a row with managed_by=platform + active
    for (const cap of KNOWN_CAPABILITIES) {
      const row = ql.rows.find((x) => x.name === cap.name);
      expect(row).toBeDefined();
      expect(row.managed_by).toBe('platform');
      expect(row.active).toBe(true);
      expect(row.scope).toBe(cap.scope);
    }
    // re-run → no new inserts (idempotent)
    const r2 = await bootstrapSystemCapabilities(ql, []);
    expect(r2.seeded).toBe(0);
    expect(ql.rows.length).toBe(KNOWN_CAPABILITIES.length);
  });

  it('derives extra capabilities referenced by permission sets', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, [{ systemPermissions: ['manage_users', 'export_data', 'approve_invoice'] }]);
    expect(ql.rows.find((x) => x.name === 'export_data')).toBeDefined();
    expect(ql.rows.find((x) => x.name === 'approve_invoice')).toBeDefined();
    // org-scoped known capability keeps its scope
    expect(ql.rows.find((x) => x.name === 'manage_org_users')?.scope).toBe('org');
  });

  it('does NOT derive a placeholder for an already-materialized capability', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, [{ systemPermissions: ['export_data', 'approve_invoice'] }], {
      materializedCapabilityNames: ['export_data'],
    });
    // `export_data` is owned by the declared seeder — no platform placeholder.
    expect(ql.rows.find((x: any) => x.name === 'export_data')).toBeUndefined();
    // `approve_invoice` is still derived as before.
    expect(ql.rows.find((x: any) => x.name === 'approve_invoice')).toBeDefined();
  });

  // [#2909 T3] `scope` is an admin-editable classification face — seed-once.
  it('does NOT clobber an admin-edited scope on re-seed (label/description still refresh)', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, []);
    const cap = KNOWN_CAPABILITIES[0];
    const row = ql.rows.find((x) => x.name === cap.name)!;
    // Admin reclassifies the capability and tweaks nothing else.
    row.scope = row.scope === 'org' ? 'platform' : 'org';
    const adminScope = row.scope;
    row.label = 'stale label';
    await bootstrapSystemCapabilities(ql, []);
    expect(row.scope).toBe(adminScope); // admin's edit survives the boot
    expect(row.label).toBe(cap.label); // platform display fields refreshed
  });

  it('still writes scope on first insert', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, []);
    for (const cap of KNOWN_CAPABILITIES) {
      expect(ql.rows.find((x) => x.name === cap.name)?.scope).toBe(cap.scope);
    }
  });

  it('marks manage_org_users as org-scoped and the rest platform', () => {
    const org = KNOWN_CAPABILITIES.find((c) => c.name === 'manage_org_users');
    expect(org?.scope).toBe('org');
    expect(KNOWN_CAPABILITIES.filter((c) => c.scope === 'platform').length).toBeGreaterThanOrEqual(5);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#5876] The DERIVED half reconciles display fields only on rows it OWNS.
//
// The seed loop used to refresh `label`/`description` on whatever row it found
// for a derived name, whatever its provenance — while the comment above it said
// admin edits were not clobbered. For a derived name `label` is `humanize(name)`
// and `description` is `Capability <name>.`, so an admin-authored row was
// rewritten to a humanized placeholder on EVERY boot (silent data loss; the
// reachable chain is: admin creates the capability in Setup → an app whose
// bootstrap permission set grants it by name is installed → every boot after).
//
// The CURATED half keeps refreshing (the platform ships new copy for its own
// definitions — pinned by 'does NOT clobber an admin-edited scope on re-seed'
// above); only the derived half is guarded, so these pins must DISCRIMINATE
// rather than just prove nothing is written.
// ───────────────────────────────────────────────────────────────────────────
describe('derived defaults never clobber an authored row (#5876)', () => {
  const OPS_SETS = [{ systemPermissions: ['showcase.export_data'] }];
  const AUTHORED = { label: 'Admin Made', description: 'Admin wrote this.' };

  /** A pre-existing row for a name the derivation would otherwise derive. */
  function seedRow(ql: ReturnType<typeof makeQl>, managed_by: string | undefined) {
    ql.rows.push({
      id: 'cap_existing',
      name: 'showcase.export_data',
      ...AUTHORED,
      scope: 'org',
      ...(managed_by === undefined ? {} : { managed_by }),
      active: true,
    });
  }

  it('leaves an ADMIN-authored row untouched', async () => {
    const ql = makeQl();
    seedRow(ql, 'admin');
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      ...AUTHORED, managed_by: 'admin', scope: 'org',
    });
    expect(out.skippedAuthored).toBe(1);
    // The skip is a SKIP, not a silent failed write: it is not counted as an update.
    expect(ql.rows.filter((r) => r.name === 'showcase.export_data')).toHaveLength(1);
  });

  it('leaves a PACKAGE-authored row untouched', async () => {
    const ql = makeQl();
    ql.rows.push({
      id: 'cap_pkg', name: 'showcase.export_data', label: 'Export Data', description: 'Bulk export.',
      managed_by: 'package', package_id: 'com.acme.reports', active: true,
    });
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      label: 'Export Data', description: 'Bulk export.', managed_by: 'package', package_id: 'com.acme.reports',
    });
    expect(out.skippedAuthored).toBe(1);
  });

  it('leaves a row of UNKNOWN provenance untouched (the field defaults to admin)', async () => {
    // `sys_capability.managed_by` is required with `defaultValue: 'admin'`, so a
    // row that reaches this pass without one is not a platform placeholder —
    // "not provably ours" resolves to leave-it-alone, never to overwrite.
    const ql = makeQl();
    seedRow(ql, undefined);
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject(AUTHORED);
    expect(out.skippedAuthored).toBe(1);
  });

  it('POSITIVE CONTROL: still refreshes its OWN platform placeholder', async () => {
    // Same fixture, same grant — only the provenance differs. A guard that also
    // switched this case off would be indistinguishable from deleting the
    // reconcile, so this is what gives the three pins above their teeth.
    const ql = makeQl();
    seedRow(ql, 'platform');
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')).toMatchObject({
      label: 'Showcase Export Data', description: 'Capability showcase.export_data.', managed_by: 'platform',
    });
    expect(out.skippedAuthored).toBe(0);
    expect(out.updated).toBeGreaterThanOrEqual(1);
    // [#2909 T3] `scope` stays seed-once even on a row this pass owns.
    expect(ql.rows.find((r) => r.name === 'showcase.export_data')?.scope).toBe('org');
  });

  it('stays stable across boots: derive, then never re-write the row again', async () => {
    const ql = makeQl();
    const boot1 = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(boot1.seeded).toBe(KNOWN_CAPABILITIES.length + 1);
    // An admin renames the derived placeholder… which the platform/package write
    // guard actually refuses today (see #5876's reachability note), so simulate
    // the storage effect only, and re-boot.
    const row = ql.rows.find((r) => r.name === 'showcase.export_data')!;
    row.label = 'Renamed By Admin';
    row.managed_by = 'admin';
    const boot2 = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(row.label).toBe('Renamed By Admin');
    expect(boot2.seeded).toBe(0);
    expect(boot2.skippedAuthored).toBe(1);
  });

  // [#8470] POSITIVE CONTROL for the untouched half. The curated fix must not
  // make this guard unreachable: a DERIVED name on an org-authored row still
  // skips. If the curated scoping ever leaked into the derived branch, the
  // derived lookup would stop finding the authored row and would DERIVE a
  // placeholder over it instead of skipping — `skippedAuthored` would fall to 0.
  it('[#8470] the derived guard still fires for an ORG-authored row (untouched half)', async () => {
    const ql = makeQl();
    ql.rows.push({
      id: 'aaa_org_derived', organization_id: 'org_jia', name: 'showcase.export_data',
      ...AUTHORED, scope: 'org', managed_by: 'admin', active: true,
    });
    const out = await bootstrapSystemCapabilities(ql, OPS_SETS);
    expect(out.skippedAuthored).toBe(1);
    expect(ql.rows.find((r) => r.id === 'aaa_org_derived')).toMatchObject({
      ...AUTHORED, managed_by: 'admin',
    });
  });

  it('the guard is scoped to the DERIVED half — curated names still refresh', async () => {
    const ql = makeQl();
    await bootstrapSystemCapabilities(ql, []);
    const curated = KNOWN_CAPABILITIES[0];
    const row = ql.rows.find((r) => r.name === curated.name)!;
    row.label = 'stale label';
    row.description = 'stale description';
    const out = await bootstrapSystemCapabilities(ql, []);
    expect(row.label).toBe(curated.label);
    expect(row.description).toBe(curated.description);
    expect(out.skippedAuthored).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [#8470] The CURATED half reconciles THE ROW THE PLATFORM OWNS.
//
// Since #8461 a capability `name` is unique per ORGANIZATION (ADR-0120 D1), so
// an admin may author `manage_users` inside their organization while the
// platform holds its own row in the NULL-organization bucket. A lookup on
// `{ name }` alone then has two candidates and cannot say which it means.
//
// ## Why "just add an ORDER BY" is not the fix, and how these pins are forced
//
// The lookup was ALREADY ordered. #4363 appends `ORDER BY id` to any paged read
// of a driver-managed table and `limit: 1` is paged, so on `SqlDriver` and
// `MongoDBDriver` the seeder's choice is stable — stable on `id`, which says
// nothing about who owns the row, and stable FOREVER on a given installation,
// so a boot that reconciles the wrong row never self-heals. The double models
// that rule (see `makeQl`), which is what makes the adverse case FORCIBLE
// rather than accidental: the org row is given the id `aaa_org_authored`, which
// sorts before every seeder-minted `cap_…` id, so the old code selects it.
// `zzz_org_authored` is the same fixture with the ordering benign.
//
// That pair is the anti-vacuity argument. The old behaviour DIFFERS between the
// two ids; the fixed behaviour is identical, because it never depended on the
// order in the first place.
// ───────────────────────────────────────────────────────────────────────────
describe('[#8470] the curated half owns its row, not whichever row shares the name', () => {
  const CURATED = KNOWN_CAPABILITIES.find((c) => c.name === 'manage_users')!;
  const ORG_AUTHORED = {
    name: 'manage_users',
    label: 'ORG CUSTOM LABEL',
    description: 'Authored by the organization admin in Setup.',
    scope: 'org' as const,
    managed_by: 'admin',
    active: true,
  };

  /** An organization's row for a CURATED name — a supported ADR-0066 D1 action. */
  function orgRow(id: string, organization_id = 'org_jia') {
    return { id, organization_id, ...ORG_AUTHORED };
  }

  const platformRowFor = (ql: ReturnType<typeof makeQl>, name: string) =>
    ql.rows.find((r) => r.name === name && r.managed_by === 'platform' && r.organization_id == null);

  // ── The headline harm: `platformRowExists: false` ──
  //
  // Card row 3. Ordering is irrelevant here — with no platform row there is only
  // ONE candidate, so the old lookup selected the organization's row whatever
  // the tie-breaker did. Two distinct harms, asserted separately so a partial
  // regression cannot hide behind the other.
  it('seeds the platform row even when an organization already holds the name', async () => {
    const ql = makeQl();
    ql.rows.push(orgRow('aaa_org_authored'));
    const out = await bootstrapSystemCapabilities(ql, []);

    // Harm 2 — the worse one: the curated definition exists in NO bucket.
    const platform = platformRowFor(ql, 'manage_users');
    expect(platform).toBeDefined();
    expect(platform).toMatchObject({
      label: CURATED.label, description: CURATED.description, scope: CURATED.scope,
      managed_by: 'platform', active: true,
    });
    // All 8 curated names land, not just the 7 with no collision.
    expect(out.seeded).toBe(KNOWN_CAPABILITIES.length);
    expect(out.blockedCurated).toBe(0);
  });

  it("leaves the organization's authored copy exactly as its author wrote it", async () => {
    const ql = makeQl();
    ql.rows.push(orgRow('aaa_org_authored'));
    await bootstrapSystemCapabilities(ql, []);

    // Harm 1: the org row must not be reconciled to the platform's copy.
    expect(ql.rows.find((r) => r.id === 'aaa_org_authored')).toEqual({
      id: 'aaa_org_authored', organization_id: 'org_jia', ...ORG_AUTHORED,
    });
  });

  // ── The forced coin flip: card row 2, which the filer flagged as NOT safe ──
  it.each([
    ['adverse — the org row sorts FIRST', 'aaa_org_authored'],
    ['benign  — the org row sorts LAST', 'zzz_org_authored'],
  ])('reconciles the platform row and only the platform row (%s)', async (_label, orgId) => {
    const ql = makeQl();
    // Boot 1 seeds the platform's row; the admin then authors theirs.
    await bootstrapSystemCapabilities(ql, []);
    ql.rows.push(orgRow(orgId));
    // A new platform version ships new copy — simulate the stale row it finds.
    const platform = platformRowFor(ql, 'manage_users')!;
    platform.label = 'stale label';
    platform.description = 'stale description';

    const out = await bootstrapSystemCapabilities(ql, []);

    // The platform's own row IS refreshed (the curated reconcile is not simply
    // switched off — the failure mode that would make every pin here vacuous).
    expect(platform).toMatchObject({
      label: CURATED.label, description: CURATED.description, managed_by: 'platform',
    });
    // …and the organization's row is untouched under BOTH id orders. Without
    // the ownership scoping these two rows disagree: the adverse id makes the
    // seeder write the platform copy onto the org row and leave `stale label`
    // on its own.
    expect(ql.rows.find((r) => r.id === orgId)).toEqual({
      id: orgId, organization_id: 'org_jia', ...ORG_AUTHORED,
    });
    expect(out.seeded).toBe(0);
    expect(out.blockedCurated).toBe(0);
  });

  // ── The PLATFORM-BUCKET provenance matrix ─────────────────────────────────
  //
  // Every case above is about a name with too MANY candidates. This block is
  // the other axis: one row, in the platform's own bucket, varying only by
  // `managed_by`. It exists because the scoped predicate is a CONJUNCTION, and
  // a conjunction can also match ZERO rows where it should match one.
  //
  // `managed_by: 'platform'` is the row the seeder owns and must still find —
  // the NEGATIVE case, and the one that would catch the predicate excluding the
  // platform's own row on an installation that predates something.
  //
  // Reachability of the other three, measured rather than assumed:
  //  - `admin` — REACHABLE and ordinary. `organization_id` auto-stamping lives
  //    in the enterprise `@objectstack/organizations` runtime, which is also
  //    what ACTIVATES every walled posture. A deployment without it is `single`
  //    posture with no stamper, so EVERY Setup-authored capability row lands in
  //    the NULL-organization bucket. This is the default community shape, not
  //    an edge case.
  //  - `package` — REACHABLE via name promotion: `bootstrapDeclaredCapabilities`
  //    refuses a name in `PLATFORM_CAPABILITY_NAMES`, but a package that
  //    declared a name BEFORE the platform curated it (`setup.write` and
  //    `manage_sharing` were both added to the curated set after the fact) left
  //    a `managed_by:'package'` row in that bucket.
  //  - no value at all — NOT reachable through the engine: `managed_by` is
  //    `required: true` with `defaultValue: 'admin'`, and `applyFieldDefaults`
  //    resolves defaults on insert BEFORE the beforeInsert hooks, so an insert
  //    omitting it stores `'admin'`, never null. Kept as a pin anyway because
  //    the diagnostic must not assert an ownership verdict it cannot observe —
  //    which is the whole reason the message names the value it READ.
  it.each([
    ['platform — the row the seeder OWNS', 'platform', 'matched'],
    ['admin    — Setup-authored, single-posture deployment', 'admin', 'blocked'],
    ['package  — declared before the name was curated', 'package', 'blocked'],
    ['(absent) — not engine-reachable; the message must still be truthful', undefined, 'blocked'],
  ])('platform-bucket row, managed_by=%s', async (_label, managedBy, expected) => {
    const ql = makeQl();
    const PRE = {
      id: 'aaa_pre_existing',
      name: 'manage_users',
      label: 'PRE-EXISTING LABEL',
      description: 'written by whoever owns this row',
      scope: 'platform' as const,
      active: true,
      ...(managedBy === undefined ? {} : { managed_by: managedBy }),
    };
    ql.rows.push({ ...PRE });
    const warn = vi.fn();
    const out = await bootstrapSystemCapabilities(ql, [], { logger: { warn } });
    const row = ql.rows.find((r) => r.id === 'aaa_pre_existing')!;

    if (expected === 'matched') {
      // The platform's own row is found by the conjunction and reconciled.
      expect(out.blockedCurated).toBe(0);
      expect(warn).not.toHaveBeenCalled();
      expect(row).toMatchObject({ label: CURATED.label, description: CURATED.description });
      expect(out.updated).toBeGreaterThanOrEqual(1);
    } else {
      expect(out.blockedCurated).toBe(1);
      // Declining is the point — the blocking row is untouched…
      expect(row).toEqual(PRE);
      // …and reported. The message names the provenance it READ rather than
      // asserting who authored the row: on a row carrying some other
      // `managed_by`, "a row this pass does not own" would be a false sentence
      // printed on every boot.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('manage_users');
      expect(warn.mock.calls[0][0]).toContain(
        managedBy === undefined ? 'a row carrying no managed_by value' : `managed_by='${managedBy}'`,
      );
      expect(warn.mock.calls[0][0]).not.toContain('does not own');
      // [#8552] The ruling leaves an existing colliding row to the OPERATOR,
      // so the warning that reports it carries the one line that says how to
      // resolve it by hand.
      expect(warn.mock.calls[0][0]).toContain('To resolve by hand');
      expect(warn.mock.calls[0][0]).toContain('rename the blocking row to a name outside the curated set');
      expect(warn.mock.calls[0][1]).toEqual({
        name: 'manage_users',
        blockingRowId: 'aaa_pre_existing',
        blockingManagedBy: managedBy ?? null,
      });
    }
    // Either way the other 7 curated names are unaffected.
    expect(out.seeded).toBe(KNOWN_CAPABILITIES.length - 1);
  });

  // The THIRD branch of the diagnostic. The insert was refused, so something
  // stopped it — but if the follow-up read then finds nothing, that is NOT an
  // ordinary collision (a racing writer, or a refusal that was never the unique
  // key) and must not be described as an unstamped row. Reachable here as the
  // general shape of a rejected write: `tryInsert` returns null on ANY engine
  // refusal, not only a duplicate key.
  it('says so when the insert was refused but no blocking row is visible', async () => {
    // Built by OVERRIDING the file's one double rather than declaring a second:
    // `check:engine-double-contract` counts unguarded engine doubles per file
    // against a shrink-only baseline, and a fresh literal declaring the engine
    // verbs would raise it. Overriding states the same fixture — this is that
    // double, with the write refused and nothing stored.
    const ql = Object.assign(makeQl(), {
      async find() { return []; },
      async insert() { return null; },
    });
    const warn = vi.fn();
    const out = await bootstrapSystemCapabilities(ql, [], { logger: { warn } });

    expect(out.seeded).toBe(0);
    expect(out.blockedCurated).toBe(KNOWN_CAPABILITIES.length);
    expect(warn).toHaveBeenCalledTimes(KNOWN_CAPABILITIES.length);
    expect(warn.mock.calls[0][0]).toContain('NO blocking row is visible');
    expect(warn.mock.calls[0][0]).toContain('worth investigating');
    // …and it must NOT borrow either of the other two branches' sentences.
    expect(warn.mock.calls[0][0]).not.toContain('carrying no managed_by value');
    expect(warn.mock.calls[0][0]).not.toContain('left exactly as it is');
    // [#8552] The remediation line instructs renaming THE BLOCKING ROW; with
    // no row visible there is nothing to rename, so it must not print here —
    // telling the operator to rename a row the read just failed to find would
    // assert what was not seen.
    expect(warn.mock.calls[0][0]).not.toContain('To resolve by hand');
    expect(warn.mock.calls[0][1]).toEqual({
      name: 'manage_users', blockingRowId: undefined, blockingManagedBy: null,
    });
  });

  // A clean install must not pay for any of this: no collision, no warn, no
  // counter. (A `blockedCurated` that fired on the happy path would make the
  // pin above green for the wrong reason.)
  it('a clean install seeds every curated name with nothing blocked', async () => {
    const ql = makeQl();
    const warn = vi.fn();
    const out = await bootstrapSystemCapabilities(ql, [], { logger: { warn } });
    expect(out.seeded).toBe(KNOWN_CAPABILITIES.length);
    expect(out.blockedCurated).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  // Two organizations may each hold the name (ADR-0066 D1 "admins EXTEND"), and
  // neither displaces the platform's row. This is also the pin that would catch
  // a fix written as "take the row with no organization_id" alone: it would
  // still be a singleton here, but see the sibling case above for why
  // `managed_by` is needed as well.
  it('is unaffected by the NUMBER of organizations holding the name', async () => {
    const ql = makeQl();
    ql.rows.push(orgRow('aaa_org_jia', 'org_jia'), orgRow('aab_org_yi', 'org_yi'));
    const out = await bootstrapSystemCapabilities(ql, []);
    expect(platformRowFor(ql, 'manage_users')).toBeDefined();
    expect(out.seeded).toBe(KNOWN_CAPABILITIES.length);
    expect(ql.rows.filter((r) => r.name === 'manage_users')).toHaveLength(3);
  });
});
