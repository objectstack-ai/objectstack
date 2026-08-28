// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import * as PlatformObjects from './index';

/**
 * #11701 — a NON-UNIQUE declared index over a text column MySQL cannot key.
 *
 * ## What used to be here, and where it went (#12147)
 *
 * This file also carried route A's own rule — "every text-family column a
 * declared index keys on declares a `maxLength`" (#11374) — enumerated over
 * this package's exports, with a vacuity control, an `UNBOUNDABLE` allowlist
 * and a synthetic control driving that allowlist's two branches. All of it is
 * now `scripts/check-keyed-text-bounds.mjs`, which walks EVERY `*.object.ts` in
 * the repository rather than one package's export surface.
 *
 * That is not a like-for-like move, and the difference is the reason for it.
 * This pin enumerated `Object.values(PlatformObjects)`, so its population was
 * whatever the barrel re-exports — 95 keyed text columns, measured. The gate's
 * population over the same objects is 97: `sys_metadata_commit.package_id` and
 * `sys_metadata_commit.parent_commit_id` were invisible here, because
 * `metadata/index.ts` is a HAND-WRITTEN back-compat re-export naming four
 * objects and `sys_metadata_commit` was never added to it. Both columns are
 * bounded today, so nothing was broken — but nothing in the tree was watching
 * them either, which is the same escape-by-boundary this pin was itself widened
 * to close once before (`identity/` → the package, after
 * `sys_import_job.created_by` slipped through).
 *
 * ## Why THIS half stays
 *
 * It is a different rule with a different disposition, not a narrower copy of
 * the one that moved. Route A asks "is there a bound?"; this asks "is the
 * declared bound small enough to be a key?" — and answers it only for
 * NON-UNIQUE indexes, because a UNIQUE index over an unkeyable column is
 * EXPRESSIBLE after #11627 (it moves onto a SHA-256 hash-shadow column) while a
 * non-unique one is not: hashing destroys the ordering and prefix structure an
 * access path is for, so there is no fallback and the column itself must be
 * keyable. `sys_account.issuer` (bounded at 2048) is the live illustration that
 * the two rules are independent — it passes the gate and is out of this
 * describe's scope because its index is unique.
 *
 * The gate deliberately does not fold this in; its header says so.
 */

const TEXT_FAMILY = new Set(['text', 'textarea', 'html', 'markdown']);

/**
 * MySQL's utf8mb4 key-part ceiling, in CHARACTERS: 768 × 4 = 3072 bytes, the
 * whole key-part budget. A declared bound at or under this makes `driver-sql`
 * emit `varchar(n)`, which MySQL can key; anything wider stays TEXT, which it
 * refuses to key without a prefix length.
 */
const MAX_KEYABLE_CHARS = 768;

type AnyObject = {
  name: string;
  fields: Record<string, { type?: string; maxLength?: unknown }>;
  indexes?: Array<{ fields?: string[]; unique?: boolean }>;
};

const platformObjects: AnyObject[] = Object.values(PlatformObjects)
  .map((v) => v as unknown as AnyObject)
  .filter(
    (v) =>
      !!v &&
      typeof v === 'object' &&
      typeof v.name === 'string' &&
      v.name.startsWith('sys_') &&
      !!v.fields,
  );

/**
 * #11701 — a NON-UNIQUE index over a text column MySQL cannot key.
 *
 * See this file's header for why this is a different defect from #11374's:
 * a UNIQUE index over an unkeyable column is EXPRESSIBLE after #11627 (it moves
 * onto a SHA-256 hash-shadow column), but a non-unique one is not — hashing
 * destroys the ordering and prefix structure an access path is for, so there is
 * no fallback and the column itself must be keyable.
 *
 * Measured on live MySQL 8.0.46: while these two members existed, each one
 * failed `syncSchema` for its whole object with `ER_BLOB_KEY_WITHOUT_LENGTH` —
 * `CREATE TABLE` succeeded and the following `ALTER TABLE … ADD INDEX` did not,
 * so the object landed registered with its declared index absent.
 */
describe('platform non-unique text indexes are keyable on MySQL (#11701)', () => {
  /** Every (object, column) a NON-UNIQUE declared index keys on a text field. */
  const nonUniqueKeyedTextColumns = (): Array<{ column: string; maxLength: unknown }> => {
    const out: Array<{ column: string; maxLength: unknown }> = [];
    for (const o of platformObjects) {
      for (const ix of o.indexes ?? []) {
        if (ix.unique) continue; // UNIQUE → carried on a hash shadow (#11627)
        for (const f of ix.fields ?? []) {
          const def = o.fields[f];
          if (!TEXT_FAMILY.has(def?.type ?? '')) continue;
          out.push({ column: `${o.name}.${f}`, maxLength: def.maxLength });
        }
      }
    }
    return out;
  };

  /**
   * Positive control FIRST, and it does double duty: it proves the probe sees a
   * real population rather than passing empty, and it pins both of #11701's
   * dispositions by name — the index that was removed must stay removed, and
   * the column that kept its index must stay in the enumerated set (the rule
   * below then holds it to a keyable bound).
   */
  it('enumerates a real surface, and pins both #11701 dispositions by name', () => {
    const columns = nonUniqueKeyedTextColumns().map((c) => c.column);
    // Measured at 55 on this tree; the floor is set just under it so an
    // enumeration that collapses (a changed export or index spelling) fails
    // here rather than passing over a surface it can no longer see.
    expect(columns.length).toBeGreaterThanOrEqual(50);

    // Kept: bounded at 255, a live better-auth lookup key.
    expect(columns).toContain('sys_verification.identifier');
    // ⛔ REMOVED by the 2026-08-25 ruling — unboundable and unread. If this
    // comes back, it comes back with a live reader and a keyable bound, or it
    // fails here and in the rule below.
    expect(columns).not.toContain('sys_verification.value');
    // Kept: a live access path (FK side of sys_oauth_resource.identifier).
    // #11701 narrowed it 1024 → 768 so the index could exist at all; #12313
    // narrowed it again 768 → 255 to follow the now-sourced referent. Still
    // keyable, so it stays in this set and the rule below still holds it.
    expect(columns).toContain('sys_oauth_client_resource.resource_id');
  });

  it('every non-unique-keyed text column is bounded at or under the utf8mb4 key ceiling', () => {
    const offenders = nonUniqueKeyedTextColumns()
      .filter(({ maxLength: n }) => {
        const keyable =
          typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= MAX_KEYABLE_CHARS;
        return !keyable;
      })
      .map(({ column, maxLength }) => `${column} (maxLength: ${String(maxLength)})`);

    expect(
      offenders,
      `non-unique declared index/indexes over a text column MySQL cannot key. Unlike the ` +
        `UNIQUE case there is NO hash-shadow fallback (#11627) — an index over a digest ` +
        `accelerates no 'WHERE col = ?' — so the whole object fails syncSchema with ` +
        `ER_BLOB_KEY_WITHOUT_LENGTH. Either bound the column at <= ${MAX_KEYABLE_CHARS} ` +
        `characters from its producer, or, if nothing reads it as a predicate, remove the ` +
        `index and say so (the two routes #11701 took): ` +
        offenders.join(', '),
    ).toEqual([]);
  });
});
