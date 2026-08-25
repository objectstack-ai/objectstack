// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';

/**
 * #11374 route A, for the objects THIS PLUGIN registers — every text-family
 * column a declared index keys on must declare a `maxLength`, because a bound
 * is what lets the column be a key at all.
 *
 * The rationale, the MySQL mechanism (`ER_BLOB_KEY_WITHOUT_LENGTH` on an
 * unbounded keyed TEXT column, object registered-but-broken with its declared
 * index silently absent) and the reason a package-scoped pin cannot police the
 * defect class are written once, next to this file's sibling in
 * `@objectstack/plugin-audit` (`plugin-keyed-text-bounds.test.ts`). This copy
 * exists for the same reason that one does: `@objectstack/platform-objects`'
 * pin enumerates only that package's exports, and `sys_audience_binding_
 * suggestion` moved out to this plugin under ADR-0029 K2 — so its keyed
 * `(package_id, permission_set_name, anchor)` unique index was unpoliced.
 *
 * It drives `SecurityPlugin.init()` rather than importing the object list, so
 * the plugin's OWN registration path defines the surface: an object added to
 * the manifest is policed the moment it is added, with no second edit here.
 */

const TEXT_FAMILY = new Set(['text', 'textarea', 'html', 'markdown']);

/**
 * Keyed text-family columns with NO defensible bound. Every entry must name
 * why. Entries that stop matching a real keyed unbounded column fail the last
 * test, so the list cannot rot. Empty today, deliberately.
 */
const UNBOUNDABLE: ReadonlySet<string> = new Set([]);

type AnyObject = {
  name: string;
  fields: Record<string, { type?: string; maxLength?: unknown }>;
  indexes?: Array<{ fields?: string[]; unique?: boolean | string }>;
};

/**
 * The objects `SecurityPlugin` really contributes to a kernel, read off the
 * manifest registration it performs in `init()`.
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

function keyedTextColumns(o: AnyObject): Array<{ column: string; maxLength: unknown }> {
  const keyed = new Set<string>();
  for (const ix of o.indexes ?? []) for (const f of ix.fields ?? []) keyed.add(f);
  return Object.entries(o.fields ?? {})
    .filter(([name, def]) => keyed.has(name) && TEXT_FAMILY.has(def?.type ?? ''))
    .map(([column, def]) => ({ column: `${o.name}.${column}`, maxLength: def.maxLength }));
}

describe('plugin-security keyed text-family columns declare their bound (#11374 route A)', () => {
  it('enumerates a real surface through the plugin registration path — the probe is not vacuous', async () => {
    const objects = await registeredObjects();
    expect(objects.map((o) => o.name)).toEqual(
      expect.arrayContaining([
        'sys_permission_set',
        'sys_position',
        'sys_capability',
        'sys_audience_binding_suggestion',
      ]),
    );

    const all = objects.flatMap(keyedTextColumns);
    expect(all.length).toBeGreaterThanOrEqual(8);
    // Two names from DIFFERENT objects, so a future narrowing of the
    // enumeration fails here by name rather than by enumerating less.
    expect(all.map((c) => c.column)).toContain('sys_audience_binding_suggestion.package_id');
    expect(all.map((c) => c.column)).toContain('sys_permission_set.name');
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

  it('the suggestion key columns carry their referenced-column bounds, not just any bound', async () => {
    // Pinned by VALUE, and by the RELATION that sources each value:
    //   package_id           255 — the width every landed same-class column
    //                              uses, `sys_permission_set.package_id`
    //                              included, which the SAME boot pass writes
    //                              the SAME value into.
    //   permission_set_name  100 — the width of `sys_permission_set.name`, the
    //                              column this value must resolve against at
    //                              confirm time.
    // The relation is the point: if either referenced column is ever widened,
    // this pin is where the transitive bound is re-derived rather than
    // rediscovered on a MySQL deployment.
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
    const fields = byName.get('sys_audience_binding_suggestion')?.fields ?? {};
    const declared =
      Number(fields.package_id?.maxLength ?? 0) + Number(fields.permission_set_name?.maxLength ?? 0);
    // 255 (anchor's default varchar width) is charged too — the select column
    // is part of the same key.
    expect(declared + 255).toBeLessThanOrEqual(768);
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
