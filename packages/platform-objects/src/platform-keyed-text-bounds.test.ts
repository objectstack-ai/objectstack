// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import * as PlatformObjects from './index';

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
 * ## Why this file enumerates the WHOLE package, not just `identity/`
 *
 * It used to be `identity/identity-keyed-text-bounds.test.ts`, importing
 * `./index` from `identity/`. That scoping is precisely how
 * `sys_import_job.created_by` — a keyed, unbounded text column in `audit/` —
 * survived route A's first pass: the pin could not see it, so nothing failed by
 * name and the column was left for a follow-up card to find by hand. A pin that
 * polices one directory does not police the defect class; it polices a
 * directory. The enumeration now walks every object the package exports, and
 * the vacuity control below asserts a column from OUTSIDE `identity/` is in
 * the enumerated set, so the same narrowing cannot silently come back.
 *
 * ## What a red on this file means
 *
 * A new keyed text-family field arrived without a `maxLength`. Do not silence
 * the assertion — derive a bound from the value's producer (upstream
 * better-auth schema/constraints, IdP norms, or the in-repo producer) and
 * declare it. If the value source genuinely cannot be bounded, extend
 * `UNBOUNDABLE` WITH a comment naming why — but read the #11701 block below
 * first: an unboundable column may only be keyed by a UNIQUE index, because a
 * UNIQUE index is the only kind #11627's hash shadow can carry.
 *
 * A bound may legitimately exceed 768 chars (the utf8mb4 index-key ceiling —
 * e.g. `sys_account.issuer` at 2048, the oauth TOKEN columns at 1024 —
 * `sys_oauth_resource.identifier` is no longer among them, see #12313): the
 * column then stays TEXT and its index still cannot exist on MySQL directly.
 * That debt was #11627's, and #11627 discharged it for the UNIQUE half — such
 * an index is now carried on a hash-shadow column. The first `describe` below
 * still polices only "keyed text declares its bound".
 *
 * ## #11701 — the NON-UNIQUE half, which a hash shadow cannot serve
 *
 * The second `describe` polices the case #11627 deliberately left refused. A
 * UNIQUE constraint is an equality-only predicate, so hashing the value
 * preserves it exactly; a NON-UNIQUE index exists for an ACCESS PATH, and an
 * index over a digest accelerates no `WHERE col = ?` the planner can reach
 * without rewriting the read side. So for a non-unique index there is no
 * shadow to fall back on: the column must be KEYABLE — bounded, and bounded at
 * or under 768 — or the index cannot exist on MySQL at all and the object's
 * whole schema-sync is refused.
 *
 * That left exactly two platform members, and the maintainer ruled them
 * separately on 2026-08-25 because they are different problems:
 *
 *   • `sys_verification.value` — unboundable AND unread. The declared index was
 *     REMOVED, on measured liveness (better-auth keys verification lookups on
 *     `identifier`; no in-repo query filters by `value`). Removing it is what
 *     emptied `UNBOUNDABLE` below.
 *   • `sys_oauth_client_resource.resource_id` — a LIVE access path (the FK side
 *     of `sys_oauth_resource.identifier`), so its bound was narrowed
 *     1024 → 768 instead. See the field's own comment for the evidence that
 *     nothing legitimate lives in the discarded band.
 *
 *     ⚠️ UPDATED by #12313: that bound is now **255**, not 768. #11701 picked
 *     768 as the smallest narrowing that made the index expressible and left
 *     the number unsourced on purpose; #12313 sourced the REFERENT
 *     (`sys_oauth_resource.identifier`, 1024 → 255, from better-auth 1.7.1's
 *     own varchar(255) emission) and this column follows it, as a referencing
 *     column takes the referenced column's bound. 255 ≤ 768, so the #11701
 *     rule below is still satisfied — it is the same disposition at a sourced
 *     number, not a different one.
 *
 * The pin below is the executable form of "the class is closed": it does not
 * name those two, it enumerates the whole package, so a THIRD member arriving
 * later fails here rather than being found on a live MySQL months on.
 */

const TEXT_FAMILY = new Set(['text', 'textarea', 'html', 'markdown']);

/**
 * Keyed text-family columns with NO defensible bound. Every entry must name
 * why. Entries that stop matching a real keyed unbounded column fail the
 * fourth test, so the list cannot rot.
 *
 * ⚠️ EMPTY since #11701 — and empty here is a RESULT, not a default. The list
 * held exactly one entry, `sys_verification.value`, allowlisted because
 * better-auth's oauth-provider writes OIDC authorization-code payloads there as
 * a JSON blob and no bound provably admits all of them. That entry was written
 * to explain why the column could not be BOUNDED, and the maintainer's
 * 2026-08-25 ruling did not bound it — it removed the column's declared INDEX,
 * on measured liveness. An unindexed column is not a keyed column, so the entry
 * stopped describing anything real and moved with the change rather than being
 * left to rot. (The fourth test enforces exactly that: it is what would have
 * gone red had the entry been left behind.)
 *
 * ⚠️ Before adding an entry: an unboundable column may only be keyed by a
 * UNIQUE index, which #11627 carries on a hash shadow. A NON-UNIQUE index over
 * an unboundable column is not "debt" — it is unfixable, and the #11701
 * `describe` below rejects it.
 */
const UNBOUNDABLE: ReadonlySet<string> = new Set<string>([]);

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

function keyedTextColumns(o: AnyObject): Array<{ column: string; maxLength: unknown }> {
  const keyed = new Set<string>();
  for (const ix of o.indexes ?? []) for (const f of ix.fields ?? []) keyed.add(f);
  return Object.entries(o.fields)
    .filter(([name, def]) => keyed.has(name) && TEXT_FAMILY.has(def?.type ?? ''))
    .map(([column, def]) => ({ column: `${o.name}.${column}`, maxLength: def.maxLength }));
}

/**
 * The rule the third test enforces, as a pure function of (objects, allowlist).
 *
 * Extracted rather than inlined because #11701 emptied `UNBOUNDABLE`: with the
 * allowlist empty, the `allowlist.has(column)` branch is never taken against the
 * real objects, so it would sit unexecuted and free to rot until the next agent
 * needed it. The synthetic control below drives both of its outcomes.
 */
function unboundedKeyedColumns(objects: AnyObject[], allowlist: ReadonlySet<string>): string[] {
  const offenders: string[] = [];
  for (const o of objects) {
    for (const { column, maxLength } of keyedTextColumns(o)) {
      if (allowlist.has(column)) continue;
      const bounded = typeof maxLength === 'number' && Number.isInteger(maxLength) && maxLength > 0;
      if (!bounded) offenders.push(`${column} (maxLength: ${String(maxLength)})`);
    }
  }
  return offenders;
}

describe('platform keyed text-family columns declare their bound (#11374)', () => {
  it('enumerates a real surface — the probe itself is not vacuous', () => {
    // Positive control: if the export shape or field/index spelling changes so
    // this file stops seeing columns, fail loudly instead of passing empty.
    const all = platformObjects.flatMap(keyedTextColumns);
    expect(platformObjects.length).toBeGreaterThanOrEqual(40);
    expect(all.length).toBeGreaterThanOrEqual(70);
    expect(all.map((c) => c.column)).toContain('sys_session.token');
  });

  it('reaches beyond identity/ — the scoping that let a keyed column escape', () => {
    // The specific regression control for this file's own history: while it
    // lived in `identity/` it enumerated only that directory, and
    // `sys_import_job.created_by` (audit/) went unbounded through route A's
    // first pass. These two names are in DIFFERENT source directories, so a
    // future re-narrowing of the import fails here by name rather than by
    // quietly enumerating less.
    const columns = platformObjects.flatMap(keyedTextColumns).map((c) => c.column);
    expect(columns).toContain('sys_import_job.created_by'); // audit/
    expect(columns).toContain('sys_metadata.name'); // metadata/
    expect(columns).toContain('sys_setting.key'); // system/
  });

  it('every keyed text-family column declares a positive integer maxLength, or is allowlisted by name', () => {
    const offenders = unboundedKeyedColumns(platformObjects, UNBOUNDABLE);
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
      platformObjects.flatMap(keyedTextColumns).map((c) => [c.column, c.maxLength]),
    );
    for (const entry of UNBOUNDABLE) {
      expect(real.has(entry), `allowlist entry ${entry} is not a keyed text column any more — remove it`).toBe(true);
      expect(
        real.get(entry),
        `allowlist entry ${entry} now declares a bound — remove it from UNBOUNDABLE`,
      ).toBeUndefined();
    }
  });

  /**
   * ⚠️ The control that keeps the test above honest now that #11701 emptied the
   * allowlist. An empty `for` loop passes, so with a real-objects-only check the
   * excusing branch of the rule would be dead code that nobody notices rotting.
   * This drives BOTH outcomes on a synthetic object, so the mechanism a future
   * unboundable column will rely on is proven to work while the list is empty.
   */
  it('the allowlist mechanism still excuses and still accuses — driven on a synthetic object', () => {
    const synthetic: AnyObject[] = [
      {
        name: 'sys_probe',
        fields: { blob: { type: 'text' } },
        indexes: [{ fields: ['blob'], unique: true }],
      },
    ];
    // Keyed + unbounded, excused by nothing → an offender, named with its value.
    expect(unboundedKeyedColumns(synthetic, new Set<string>())).toEqual([
      'sys_probe.blob (maxLength: undefined)',
    ]);
    // …and named in the allowlist → excused. The branch the real objects no
    // longer reach.
    expect(unboundedKeyedColumns(synthetic, new Set(['sys_probe.blob']))).toEqual([]);
  });
});

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
