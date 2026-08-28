// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';

/**
 * The suggestion key columns carry their REFERENCED columns' bounds, and the
 * composite key stays expressible on MySQL.
 *
 * ## What used to be here, and where it went (#12147)
 *
 * This file carried route A's rule — "every text-family column a declared index
 * keys on declares a `maxLength`" (#11374) — enumerated over the objects this
 * plugin registers, with a vacuity control and an `UNBOUNDABLE` allowlist. That
 * is now `scripts/check-keyed-text-bounds.mjs`, a source scan over EVERY
 * `*.object.ts` in the repository. The rationale for the move, and why a
 * central importing pin was not available, is written once next to this file's
 * sibling in `@objectstack/plugin-audit`.
 *
 * Coverage was measured before this half was removed, not assumed: driving
 * `init()` the way this file does enumerates 8 keyed text-family columns; the
 * gate's population over `packages/plugins/plugin-security` is the same 8, with
 * 0 columns missed in either direction.
 *
 * ## Why THIS half stays
 *
 * Both remaining assertions are about a bound's VALUE, and the gate only asks
 * whether a bound exists. That is not a gap in the gate — a bound's correctness
 * here is a RELATION to another column, and the relation is the point: if
 * either referenced column is ever widened, this is where the transitive bound
 * is re-derived rather than rediscovered on a MySQL deployment. A gate that
 * checked values would have to know which column references which, which is
 * exactly the knowledge that belongs beside the objects.
 */

type AnyObject = {
  name: string;
  fields: Record<string, { type?: string; maxLength?: unknown }>;
  indexes?: Array<{ fields?: string[]; unique?: boolean | string }>;
};

/**
 * The objects `SecurityPlugin` really contributes to a kernel, read off the
 * manifest registration it performs in `init()` — so an object added to that
 * call is covered the moment it is added, with no second edit here.
 */
async function registeredObjects(): Promise<AnyObject[]> {
  const captured: AnyObject[] = [];
  const noop = () => {};
  await new SecurityPlugin().init({
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    registerService: noop,
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
  } as never);
  return captured;
}

describe('plugin-security suggestion key bounds are their referenced columns\' (#11374 route A)', () => {
  it('the suggestion key columns carry their referenced-column bounds, not just any bound', async () => {
    // Pinned by VALUE, and by the RELATION that sources each value:
    //   package_id           255 — the width every landed same-class column
    //                              uses, `sys_permission_set.package_id`
    //                              included, which the SAME boot pass writes
    //                              the SAME value into.
    //   permission_set_name  100 — the width of `sys_permission_set.name`, the
    //                              column this value must resolve against at
    //                              confirm time.
    const byName = new Map((await registeredObjects()).map((o) => [o.name, o]));
    const suggestion = byName.get('sys_audience_binding_suggestion');
    const permissionSet = byName.get('sys_permission_set');

    expect(suggestion?.fields.package_id?.maxLength).toBe(255);
    expect(suggestion?.fields.permission_set_name?.maxLength).toBe(100);

    // The referenced columns, read from the same registration surface — so a
    // widening there turns THIS red instead of silently orphaning the bound.
    expect(permissionSet?.fields.package_id?.maxLength).toBe(255);
    expect(permissionSet?.fields.name?.maxLength).toBe(100);
  });

  it('the composite key stays expressible on MySQL — utf8mb4 index-key ceiling', async () => {
    // The whole point of declaring the bounds is that
    // `(package_id, permission_set_name, anchor)` can EXIST as an index. MySQL
    // 8 / InnoDB DYNAMIC caps one index key at 3072 bytes, and utf8mb4 charges
    // 4 bytes per character, so the declared widths of the key's text columns
    // must sum to <= 768 characters. 255 + 100 leaves ample room for the
    // `anchor` select column, which the driver emits at its default width.
    const byName = new Map((await registeredObjects()).map((o) => [o.name, o]));
    // The vacuity control for THIS test specifically: with no registration the
    // sum below is 0 + 255, which passes a ceiling check while measuring
    // nothing. The object has to be there for the sum to mean anything.
    expect(byName.has('sys_audience_binding_suggestion')).toBe(true);

    const fields = byName.get('sys_audience_binding_suggestion')?.fields ?? {};
    const declared =
      Number(fields.package_id?.maxLength ?? 0) + Number(fields.permission_set_name?.maxLength ?? 0);
    expect(declared).toBeGreaterThan(0);
    // 255 (anchor's default varchar width) is charged too — the select column
    // is part of the same key.
    expect(declared + 255).toBeLessThanOrEqual(768);
  });
});
