// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AuditPlugin } from './audit-plugin.js';

/**
 * #11374 route A, for the objects THIS PLUGIN registers — every text-family
 * column a declared index keys on must declare a `maxLength`, because a bound
 * is what lets the column be a key at all.
 *
 * ## Why a second copy of the pin lives here
 *
 * The original pin is `@objectstack/platform-objects`'
 * `platform-keyed-text-bounds.test.ts`, and it enumerates the objects THAT
 * package exports. Platform objects that moved out to plugins under ADR-0029 K2
 * are outside it by construction, which is exactly how `sys_activity.record_id`
 * and `sys_audit_log.record_id` stayed unbounded through route A's sweep: the
 * pin could not see them, so nothing failed by name.
 *
 * That is the same failure the platform pin already survived once at a smaller
 * scale (it used to be scoped to `identity/`, and `sys_import_job.created_by`
 * in `audit/` escaped it). A pin scoped to a package polices a package, not the
 * defect class. The class-level repair — one walk over every package that ships
 * platform objects — is engine-lane work tracked separately; until it lands,
 * each shipping package carries its own copy so no keyed column is unpoliced.
 *
 * ## Why it drives `init()` instead of importing the objects
 *
 * This package's `package.json` declares only the `.` export and the root
 * barrel does not re-export `./objects`, so nothing outside the package can
 * import `SysActivity` at all — which is why the objects were never measured
 * live. Enumerating a hand-written list here would reproduce that blind spot in
 * miniature: the list, not the plugin, would define the surface. So the pin
 * drives the REAL registration path (`AuditPlugin.init` → the `manifest`
 * service's `register({ objects })`) and polices whatever the plugin actually
 * contributes to a kernel. An object added to that call is policed the moment
 * it is added, with no second edit here.
 *
 * ## What a red on this file means
 *
 * A new keyed text-family field arrived without a `maxLength`. Do not silence
 * it — derive a bound from the value's producer and declare it (route A's
 * shape: a NAMED producer, stated in the declaration so it is vetoable in
 * review), or extend the allowlist with a comment naming why no bound exists
 * and where the keyability debt is tracked.
 *
 * On MySQL the cost of a red is not theoretical: the unbounded column is
 * emitted `TEXT`, `ALTER TABLE … ADD INDEX` is refused with
 * `ER_BLOB_KEY_WITHOUT_LENGTH`, and the object lands registered-but-broken with
 * its declared index silently absent.
 */

const TEXT_FAMILY = new Set(['text', 'textarea', 'html', 'markdown']);

/**
 * Keyed text-family columns with NO defensible bound. Every entry must name
 * why. Entries that stop matching a real keyed unbounded column fail the last
 * test, so the list cannot rot. Empty today, deliberately: all four of this
 * plugin's keyed text columns have a sourced bound.
 */
const UNBOUNDABLE: ReadonlySet<string> = new Set([]);

type AnyObject = {
  name: string;
  fields: Record<string, { type?: string; maxLength?: unknown }>;
  indexes?: Array<{ fields?: string[]; unique?: boolean | string }>;
};

/**
 * The objects `AuditPlugin` really contributes to a kernel, read off the
 * manifest registration it performs in `init()`.
 */
async function registeredObjects(): Promise<AnyObject[]> {
  const captured: AnyObject[] = [];
  const noop = () => {};
  const logger = {
    info: noop, warn: noop, error: noop, debug: noop,
    child() { return logger; },
  };
  const ctx = {
    logger,
    getService(name: string) {
      if (name === 'manifest') {
        return {
          register(m: { objects?: AnyObject[] }) {
            for (const o of m?.objects ?? []) captured.push(o);
          },
        };
      }
      return undefined;
    },
    registerService: noop,
    hook: noop,
  } as never;

  await new AuditPlugin().init(ctx);
  return captured;
}

function keyedTextColumns(o: AnyObject): Array<{ column: string; maxLength: unknown }> {
  const keyed = new Set<string>();
  for (const ix of o.indexes ?? []) for (const f of ix.fields ?? []) keyed.add(f);
  return Object.entries(o.fields ?? {})
    .filter(([name, def]) => keyed.has(name) && TEXT_FAMILY.has(def?.type ?? ''))
    .map(([column, def]) => ({ column: `${o.name}.${column}`, maxLength: def.maxLength }));
}

describe('plugin-audit keyed text-family columns declare their bound (#11374 route A)', () => {
  it('enumerates a real surface through the plugin registration path — the probe is not vacuous', async () => {
    // Positive control: if `init()` stops registering objects, or the field /
    // index spelling changes so this file stops seeing columns, fail loudly
    // instead of passing empty. An empty enumeration is the failure mode that
    // let these columns escape route A in the first place.
    const objects = await registeredObjects();
    expect(objects.map((o) => o.name)).toEqual(
      expect.arrayContaining(['sys_audit_log', 'sys_activity', 'sys_comment']),
    );

    // 5 is MEASURED off this registration surface, not a round number:
    // sys_audit_log.{object_name,record_id}, sys_activity.{object_name,record_id},
    // sys_comment.thread_id. Every other index on these three objects keys on a
    // lookup, select or datetime column, which is not text-family.
    const all = objects.flatMap(keyedTextColumns);
    expect(all.length).toBeGreaterThanOrEqual(5);
    // Three names from THREE DIFFERENT objects, so a future narrowing of the
    // enumeration fails here by name rather than by quietly enumerating less.
    expect(all.map((c) => c.column)).toContain('sys_activity.record_id');
    expect(all.map((c) => c.column)).toContain('sys_audit_log.record_id');
    expect(all.map((c) => c.column)).toContain('sys_comment.thread_id');
  });

  it('every keyed text-family column declares a positive integer maxLength, or is allowlisted by name', async () => {
    const objects = await registeredObjects();
    const offenders: string[] = [];
    for (const o of objects) {
      for (const { column, maxLength } of keyedTextColumns(o)) {
        if (UNBOUNDABLE.has(column)) continue;
        const bounded =
          typeof maxLength === 'number' && Number.isInteger(maxLength) && maxLength > 0;
        if (!bounded) offenders.push(`${column} (maxLength: ${String(maxLength)})`);
      }
    }
    expect(
      offenders,
      `keyed text-family column(s) without a declared maxLength — on MySQL their ` +
        `declared index cannot be created and the object lands registered-but-broken. ` +
        `Declare a sourced bound or extend UNBOUNDABLE with a named reason: ` +
        offenders.join(', '),
    ).toEqual([]);
  });

  it('the two ActivityPointer id columns carry the referenced-column bound, not just any bound', async () => {
    // The bound is not free-floating: 255 is the width of the physical `id`
    // column `driver-sql` creates (`table.string('id').primary()`, knex's
    // varchar(255) — the driver spells it `DEFAULT_STRING_VARCHAR_CHARS`), so a
    // column holding a record id is bounded by transitivity from the id itself.
    // Pinned by VALUE because a later edit that "tidies" one of these to a
    // narrower sibling convention (100, as plugin-sharing and plugin-approvals
    // chose) would silently make the column unable to hold ids that the id
    // column itself accepts.
    const byName = new Map((await registeredObjects()).map((o) => [o.name, o]));
    expect(byName.get('sys_activity')?.fields.record_id?.maxLength).toBe(255);
    expect(byName.get('sys_audit_log')?.fields.record_id?.maxLength).toBe(255);
  });

  it('the UNBOUNDABLE allowlist matches only real, still-unbounded keyed columns', async () => {
    const real = new Map(
      (await registeredObjects()).flatMap(keyedTextColumns).map((c) => [c.column, c.maxLength]),
    );
    for (const entry of UNBOUNDABLE) {
      expect(real.has(entry), `allowlist entry ${entry} is not a keyed text column any more — remove it`).toBe(true);
      expect(
        real.get(entry),
        `allowlist entry ${entry} now declares a bound — remove it from UNBOUNDABLE`,
      ).toBeUndefined();
    }
  });
});
