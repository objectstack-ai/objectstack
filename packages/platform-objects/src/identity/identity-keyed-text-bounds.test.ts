// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import * as Identity from './index';

/**
 * #11374 — every text-family column a declared index keys on must declare a
 * `maxLength`, because a bound is what lets the column be a key at all.
 *
 * ## Why this pin exists
 *
 * `driver-sql` emits a KEYED text-family column as `varchar(maxLength)` when
 * the field declares a bound the dialect can key on, and leaves it `TEXT`
 * otherwise. MySQL refuses a TEXT/BLOB column in a key without a prefix length
 * (`ER_BLOB_KEY_WITHOUT_LENGTH`), so an unbounded keyed text column means:
 * `CREATE TABLE` succeeds, `ALTER TABLE … ADD [UNIQUE] INDEX` fails, and the
 * object lands registered-but-broken with its declared uniqueness silently
 * absent. Measured on live MySQL 8.0.46: 12 of 44 platform objects failed
 * schema-sync this way — sys_session and sys_account among them, so a MySQL
 * stack could not sign anyone in.
 *
 * The driver deliberately does NOT substitute a prefix index: measured on the
 * same server, a prefix-UNIQUE index is stricter-and-different — it refused a
 * second, genuinely distinct token that shared its first 191 characters
 * (`ER_DUP_ENTRY`), i.e. a valid sign-in refused as a duplicate. So the bound
 * has to live HERE, in the field declaration (maintainer ruling on #11374,
 * 2026-08-24: route A).
 *
 * ## What a red on this file means
 *
 * A new keyed text-family field arrived without a `maxLength`. Do not silence
 * the assertion — derive a bound from the value's producer (upstream
 * better-auth schema/constraints, IdP norms, or the in-repo producer) and
 * declare it, or, if the value source genuinely cannot be bounded (the
 * `sys_verification.value` case below), extend the allowlist WITH a comment
 * naming why and where the keyability debt is tracked.
 *
 * A bound may legitimately exceed 768 chars (the utf8mb4 index-key ceiling —
 * e.g. `sys_account.issuer` at 2048, the oauth token columns at 1024): the
 * column then stays TEXT and its index still cannot exist on MySQL. That debt
 * is #11627's (hash-shadow keys), and this pin does not police it — it polices
 * only "keyed text declares its bound".
 */

const TEXT_FAMILY = new Set(['text', 'textarea', 'html', 'markdown']);

/**
 * Keyed text-family columns with NO defensible bound. Every entry must name
 * why. Entries that stop matching a real keyed unbounded column fail the
 * second test, so the list cannot rot.
 */
const UNBOUNDABLE: ReadonlySet<string> = new Set([
  // better-auth's oauth-provider stores OIDC authorization-code payloads in
  // `verification.value` as a JSON blob (see the index comment in
  // sys-verification.object.ts), and upstream deliberately declares the field
  // unindexed and unbounded — no bound exists that provably admits every value
  // better-auth may write. Its ObjectStack-declared index therefore still
  // cannot exist on MySQL; that keyability debt is tracked with #11627.
  'sys_verification.value',
]);

type AnyObject = {
  name: string;
  fields: Record<string, { type?: string; maxLength?: unknown }>;
  indexes?: Array<{ fields?: string[]; unique?: boolean }>;
};

const identityObjects: AnyObject[] = Object.values(Identity).filter(
  (v): v is AnyObject =>
    !!v &&
    typeof v === 'object' &&
    typeof (v as AnyObject).name === 'string' &&
    (v as AnyObject).name.startsWith('sys_') &&
    !!(v as AnyObject).fields,
);

function keyedTextColumns(o: AnyObject): Array<{ column: string; maxLength: unknown }> {
  const keyed = new Set<string>();
  for (const ix of o.indexes ?? []) for (const f of ix.fields ?? []) keyed.add(f);
  return Object.entries(o.fields)
    .filter(([name, def]) => keyed.has(name) && TEXT_FAMILY.has(def?.type ?? ''))
    .map(([column, def]) => ({ column: `${o.name}.${column}`, maxLength: def.maxLength }));
}

describe('identity keyed text-family columns declare their bound (#11374)', () => {
  it('enumerates a real surface — the probe itself is not vacuous', () => {
    // Positive control: if the export shape or field/index spelling changes so
    // this file stops seeing columns, fail loudly instead of passing empty.
    const all = identityObjects.flatMap(keyedTextColumns);
    expect(identityObjects.length).toBeGreaterThanOrEqual(20);
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(all.map((c) => c.column)).toContain('sys_session.token');
  });

  it('every keyed text-family column declares a positive integer maxLength, or is allowlisted by name', () => {
    const offenders: string[] = [];
    for (const o of identityObjects) {
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

  it('the UNBOUNDABLE allowlist matches only real, still-unbounded keyed columns', () => {
    const real = new Map(
      identityObjects.flatMap(keyedTextColumns).map((c) => [c.column, c.maxLength]),
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
