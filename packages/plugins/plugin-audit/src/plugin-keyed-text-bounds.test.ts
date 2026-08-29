// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AuditPlugin } from './audit-plugin.js';

/**
 * The ActivityPointer id columns carry the REFERENCED column's bound.
 *
 * ## What used to be here, and where it went (#12147)
 *
 * This file carried route A's rule — "every text-family column a declared index
 * keys on declares a `maxLength`" (#11374) — enumerated over the objects this
 * plugin registers, with a vacuity control and an `UNBOUNDABLE` allowlist. That
 * is now `scripts/check-keyed-text-bounds.mjs`, a source scan over EVERY
 * `*.object.ts` in the repository.
 *
 * The duplication was never the design. This copy existed because
 * `@objectstack/platform-objects`' pin enumerates that package's exports and
 * cannot reach a plugin's objects — this package's `package.json` declares only
 * the `.` export and the root barrel does not re-export `./objects`, and making
 * it importable would invert the dependency graph (measured on PR #12143:
 * `platform-objects` depends only on `metadata-core` + `spec`, while this
 * plugin depends on `platform-objects`). So each shipping package carried its
 * own copy until a class-level instrument existed. It exists now.
 *
 * Coverage was measured before this half was removed, not assumed: driving
 * `init()` the way this file does enumerates 5 keyed text-family columns
 * (`sys_audit_log.{object_name,record_id}`, `sys_activity.{object_name,
 * record_id}`, `sys_comment.thread_id`); the gate's population over
 * `packages/plugins/plugin-audit` is the same 5, with 0 columns missed in
 * either direction.
 *
 * ## Why THIS half stays
 *
 * The gate asks whether a bound EXISTS. It cannot ask whether the bound is the
 * RIGHT ONE, because "right" here is a relation to another column rather than a
 * property of this one — and that relation is exactly what a later edit breaks
 * without noticing. 255 is the width of the physical `id` column `driver-sql`
 * creates (`table.string('id').primary()`, knex's varchar(255) — the driver
 * spells it `DEFAULT_STRING_VARCHAR_CHARS`), so a column holding a record id is
 * bounded by transitivity from the id itself. Pinned by VALUE because a later
 * edit that "tidies" one of these to a narrower sibling convention (100, as
 * plugin-sharing and plugin-approvals chose) would silently make the column
 * unable to hold ids that the id column itself accepts — and would sail through
 * the gate, which sees a positive integer and stops there.
 *
 * This test is its own vacuity control: driven through the plugin's REAL
 * registration path, an `init()` that stops registering objects leaves
 * `byName.get(...)` undefined, and `undefined` is not 255.
 */

type AnyObject = {
  name: string;
  fields: Record<string, { type?: string; maxLength?: unknown }>;
  indexes?: Array<{ fields?: string[]; unique?: boolean | string }>;
};

/**
 * The objects `AuditPlugin` really contributes to a kernel, read off the
 * manifest registration it performs in `init()` — so an object added to that
 * call is covered the moment it is added, with no second edit here.
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

describe('plugin-audit ActivityPointer bounds are the referenced column\'s (#11374 route A)', () => {
  it('the two ActivityPointer id columns carry the referenced-column bound, not just any bound', async () => {
    const byName = new Map((await registeredObjects()).map((o) => [o.name, o]));
    expect(byName.get('sys_activity')?.fields.record_id?.maxLength).toBe(255);
    expect(byName.get('sys_audit_log')?.fields.record_id?.maxLength).toBe(255);
  });
});
