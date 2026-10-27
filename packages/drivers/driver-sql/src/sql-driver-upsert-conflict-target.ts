// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 14] The conflict-target path of `SqlDriver#upsert`: the
 * pre-flight that judges a table's physical keys before the statement is
 * compiled (`assertConflictTargetHonoured`, the #8621 unbacked and #8755
 * ambiguous verdicts plus #8807's identity-at-risk answer), its #8740 twin for
 * a statement that carries no conflict clause
 * (`assertConflictTargetBackedWithoutClause`), the cached key-index read both
 * consult (`introspectKeyIndexes`), and the two #21185 organization-fence
 * helpers the remote face reuses (`upsertTenantGuard`, `upsertConflictRefusal`).
 * They moved out of `sql-driver.ts` whole, with the three module-level
 * declarations only they read: `indexCoversConflictTarget`,
 * `unbackedConflictTargetCause` and the #8755 refusal builder
 * `refuseAmbiguousConflictTarget`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited, and each moved declaration is byte-identical: the same verdicts,
 * the same cache re-read before any refusal, the same sentences.
 *
 * What did NOT move, and why:
 *
 *  - `upsert` itself builds through `getBuilder`, and stays.
 *  - `refuseUnbackedConflictTarget` (also thrown by `upsert`'s reactive catch)
 *    and `refuseUpsertConflictOutsideWrittenOrganization` (also thrown by
 *    `upsert` and `assertMergeLandedInWrittenOrganization`) are shared with
 *    code that stays, and so is `ConflictTargetVerdict`, the return type the
 *    class method still declares. They gained `export` in place in
 *    `sql-driver.ts` and are imported here.
 *  - `rotationWriteTarget`, `introspectIndexes`, `resolveTenantField` and
 *    `remoteColumn` are read by members that stay too; the moved bodies reach
 *    them through the host.
 *
 * ## How the moved bodies reach the class
 *
 * The shape the other seam modules apply, after #23050. The class keeps every
 * method, because the published `dist/*.d.ts` lists each one's name,
 * docblock and position, and because `driver-turso` calls
 * `upsertTenantGuard` and `upsertConflictRefusal` on its own instance. Each
 * method body is now one literal of exactly the {@link UpsertConflictTargetHost}
 * members that method reads, plus a `.call`; `upsertConflictRefusal` reads no
 * member and calls its function directly. Methods go as closures that call
 * them on the driver at call time, so a subclass override or an instance spy is
 * still the one a body reaches; the fields `physicalTableByObject` and
 * `physicalKeyIndexes` go as GETTERS, so each read happens when the body makes
 * it, as it did on the class.
 *
 * The module cycle is evaluation-safe because every value import from
 * `sql-driver.ts` is read only inside a function body, never while the two
 * modules are first evaluated. `index.ts` re-exports nothing from this module
 * and names its `sql-driver.ts` exports one by one, so the published surface
 * does not move.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import type { DriverOptions } from '@objectstack/spec/data';
import type { PhysicalIndex } from './schema-drift.js';
import { type ConflictTargetVerdict, refuseUnbackedConflictTarget, refuseUpsertConflictOutsideWrittenOrganization, type SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface UpsertConflictTargetHost {
  introspectIndexes: SqlDriver['introspectIndexes'];
  introspectKeyIndexes: SqlDriver['introspectKeyIndexes'];
  readonly physicalKeyIndexes: SqlDriver['physicalKeyIndexes'];
  readonly physicalTableByObject: SqlDriver['physicalTableByObject'];
  remoteColumn: SqlDriver['remoteColumn'];
  resolveTenantField: SqlDriver['resolveTenantField'];
  rotationWriteTarget: SqlDriver['rotationWriteTarget'];
}

/**
 * Whether a physical key index covers exactly the conflict target — the same
 * columns, order-insensitively, which is how both `ON CONFLICT` dialects infer
 * an arbiter index and the only reading under which a composite key means
 * anything. Shared by {@link SqlDriver.assertConflictTargetHonoured} and
 * {@link SqlDriver.assertConflictTargetBackedWithoutClause}.
 */
function indexCoversConflictTarget(index: PhysicalIndex, mergeKeys: readonly string[]): boolean {
  const wanted = new Set(mergeKeys);
  return index.columns.length === wanted.size && index.columns.every((c) => wanted.has(c));
}

/**
 * The `cause` an introspection-based unbacked-target refusal carries, where the
 * server's own sentence stands on a server-judged one: schema identifiers only,
 * no row values.
 */
function unbackedConflictTargetCause(tableName: string, mergeKeys: readonly string[], keys: PhysicalIndex[]): Error {
  const found = keys.map((i) => `${i.name}(${i.columns.join(', ')})`).join(', ');
  return new Error(
    `no PRIMARY KEY or UNIQUE index on "${tableName}" covers (${mergeKeys.join(', ')}); ` + `keys present: ${found}`,
  );
}

/**
 * [#8755] A `conflictKeys` upsert whose target IS backed, on a MySQL table that
 * carries another UNIQUE key — the one that key can absorb the conflict instead.
 *
 * # A different condition from the one above, so a different sentence
 *
 * #5240 is "one condition, one wording", not "one function, one wording".
 * {@link refuseUnbackedConflictTarget} answers *no index backs your target*, and
 * every remedy it names is about creating that index. Here the index exists and
 * the target is perfectly well formed; what cannot be honoured is the TARGETING,
 * because `ON DUPLICATE KEY UPDATE` carries no target and MySQL merges on
 * whichever unique key the row collides with first. Reusing the unbacked wording
 * would tell an author to declare a `unique: true` they already declared, and
 * send them to re-run a schema sync that would change nothing.
 *
 * Measured on live MySQL 8.0.46, `email` and `tax_id` both `unique: true`, the
 * caller naming `email` — reproduced for this card through the same knex +
 * `mysql2` path `upsert` takes:
 *
 * ```
 * upsert({email:'a@b.com',     tax_id:'T-1', title:'first'},  ['email']) -> seeded
 * upsert({email:'other@b.com', tax_id:'T-1', title:'second'}, ['email'])
 *   -> RESOLVED, ONE row: merged on `tax_id`, across two different `email` values.
 * ```
 *
 * # Why `VALIDATION_ERROR` / 400 and not `NOT_IMPLEMENTED` / 501
 *
 * The #5907 classifier this file already applies twice
 * ({@link uncompilableAggregateFunctionError}, {@link refuseDateBucketedGroupBy})
 * sorts a refusal by *what the caller would have to change*: a CAPABILITY gap in
 * the backend — the request is spelled correctly and no schema anywhere makes it
 * work — is 501, and a request that does not validate against the target it was
 * given is 400. This one is the second: it is conditional on the TABLE, not on
 * the dialect. The identical statement against the identical MySQL server is
 * honoured the moment the table carries a single unique key, which is why the
 * remedy in the message is a schema change and not "wait for the backend to
 * implement it". 400 also keeps it off the retry-inviting 5xx band (nothing here
 * is transient — the next attempt fails identically) and keeps the sentence
 * itself on the wire: `@objectstack/rest` withholds the message body of any 5xx,
 * and this message is the deliverable — the ruling requires it to name the
 * colliding key and the way out.
 *
 * # What is NOT refused, and why the PRIMARY KEY never counts as a rival
 *
 * The primary key is excluded from the keys that trigger this refusal, in both
 * directions, and neither is an oversight:
 *
 *  - **As a rival** — every table this driver creates carries an `id` PRIMARY
 *    KEY, so counting it would refuse *every* `conflictKeys` upsert on MySQL.
 *    The ruling's "the single-key fast path stays untouched" would then describe
 *    nothing, and the remedy this message states ("drop or rename the extra
 *    key") is not available for a primary key — a refusal whose only stated way
 *    out is impossible is worse than no refusal.
 *  - **As the named target** — `upsert(…, ['id'])` is the driver's own identity
 *    path, byte-identical in compilation to the default `conflictKeys`-less
 *    call. Refusing the explicit spelling while merging the implicit one would
 *    make the accept set a property of how the caller typed the same statement.
 *    It is also the only `conflictKeys` shape the platform itself issues (the
 *    lifecycle archiver's hot→cold copy), whose remedy would read "drop the
 *    unique constraint you declared on your own business column".
 *
 * ✅ **[#8807] closed both residues, and NOT by widening this refusal.** The
 * paragraph above is still the reason the primary key is not refused *here* —
 * what changed is that "not refused here" no longer means "unprotected". A
 * primary-key-targeted merge on a table carrying a rival UNIQUE key is now
 * verified AFTER the statement, inside a transaction, and rolled back if it
 * landed on a row the caller never identified
 * ({@link refuseCrossRowIdentityMerge}). That shape was chosen over extending
 * this pre-flight precisely because of the first bullet: on the primary-key
 * path every non-primary UNIQUE key is a rival, so a pre-flight refusal there
 * could not have been narrowed at all and would have been the blanket ban the
 * #8755 ruling and the #8807 ruling both excluded.
 */
function refuseAmbiguousConflictTarget(
  object: string,
  mergeKeys: string[],
  tableName: string,
  rivals: PhysicalIndex[],
): Error {
  const keys = mergeKeys.map((k) => `"${k}"`).join(', ');
  const named = rivals.map((i) => `${i.name}(${i.columns.join(', ')})`).join(', ');
  const err = new Error(
    `Cannot upsert into "${object}" on conflict keys (${keys}): a UNIQUE key other than the ` +
      `conflict target exists on "${tableName}" — ${named} — and this backend is MySQL, whose only ` +
      `merge statement is ON DUPLICATE KEY UPDATE. That statement carries no conflict target, so ` +
      `the merge lands on whichever UNIQUE key the row collides with FIRST: the conflict target is ` +
      `backed, but a collision on ${named} would silently merge a row the caller never targeted, ` +
      `across two different values of the named key. Fix by dropping or renaming the extra UNIQUE ` +
      `key(s) so the conflict target is the only one on the table, or by running this object on a ` +
      `dialect that honours the target — SQLite and PostgreSQL compile ON CONFLICT (...), which ` +
      `merges on the named key alone. Upserting on the primary key is unaffected: supply "id" and ` +
      `omit conflictKeys.`,
  ) as Error & { code?: string; status?: number; cause?: unknown };
  err.code = StandardErrorCode.enum.VALIDATION_ERROR;
  err.status = 400;
  // The introspected keys, exactly as the unbacked refusal attaches them: schema
  // identifiers are the ground truth an operator acts on, and row values are not.
  err.cause = new Error(
    `conflict target (${mergeKeys.join(', ')}) on "${tableName}" is backed, but these UNIQUE keys ` +
      `can absorb the conflict instead: ${named}`,
  );
  return err;
}

/** The body of `SqlDriver#upsertTenantGuard`; the method's docblock there is its contract. */
export function upsertTenantGuard(this: Pick<UpsertConflictTargetHost, 'remoteColumn' | 'resolveTenantField'>, object: string, row: Record<string, any>, options?: DriverOptions): { field: string; column: string; value: unknown } | null {
  const tenantId = options?.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === '') return null;
  const field = this.resolveTenantField(object);
  if (!field) return null;
  const value = row[field];
  // Unreachable after `injectTenantOnInsert`, which fills an empty slot from
  // `tenantId` on exactly this condition; stated rather than assumed.
  if (value === undefined || value === null || value === '') return null;
  return { field, column: this.remoteColumn(object, field, field), value };
}

/** The body of `SqlDriver#upsertConflictRefusal`; the method's docblock there is its contract. */
export function upsertConflictRefusal(object: string, conflictKeys?: string[]): Error {
  return refuseUpsertConflictOutsideWrittenOrganization(
    object,
    conflictKeys && conflictKeys.length > 0 ? conflictKeys : ['id'],
  );
}

/** The body of `SqlDriver#introspectKeyIndexes`; the method's docblock there is its contract. */
export async function introspectKeyIndexes(this: Pick<UpsertConflictTargetHost, 'introspectIndexes' | 'physicalKeyIndexes'>, tableName: string, opts: { fresh?: boolean } = {}): Promise<PhysicalIndex[] | null> {
  if (!opts.fresh) {
    const cached = this.physicalKeyIndexes.get(tableName);
    if (cached) return cached;
  }
  let indexes: PhysicalIndex[];
  try {
    indexes = await this.introspectIndexes(tableName);
  } catch {
    // #7332's direction, for the same reason: a failed read is not evidence
    // of an absent index, and this caller's whole output is a refusal.
    return null;
  }
  const keys = indexes.filter(
    (i) => (i.unique === true || i.primary === true) && i.partial !== true && i.columns.length > 0,
  );
  this.physicalKeyIndexes.set(tableName, keys);
  return keys;
}

/** The body of `SqlDriver#assertConflictTargetHonoured`; the method's docblock there is its contract. */
export async function assertConflictTargetHonoured(this: Pick<UpsertConflictTargetHost, 'introspectKeyIndexes' | 'physicalTableByObject' | 'rotationWriteTarget'>, object: string, mergeKeys: string[], callerNamed: boolean): Promise<ConflictTargetVerdict> {
  // The table the statement will actually hit — same resolution `getBuilder`
  // performs for the insert, rotation shard included.
  const target = this.rotationWriteTarget(object) ?? object;
  const tableName = this.physicalTableByObject[target] ?? target;

  const covers = (i: PhysicalIndex): boolean => indexCoversConflictTarget(i, mergeKeys);

  type Verdict =
    | { kind: 'honoured' }
    | { kind: 'unbacked' }
    | { kind: 'ambiguous'; rivals: PhysicalIndex[] }
    | { kind: 'identity-at-risk'; rivals: PhysicalIndex[] };

  const judge = (keys: PhysicalIndex[]): Verdict => {
    if (!keys.some(covers)) return { kind: 'unbacked' };
    // The target is the PRIMARY KEY — the driver's own identity path, and the
    // shape the `conflictKeys`-less default compiles to byte-identically.
    //
    // [#8755] left this merging and documented the residue. [#8807] takes it,
    // and the reason it is a THIRD verdict rather than a fourth caller of the
    // ambiguous refusal is the whole of that card: here the caller named
    // nothing (or named the identity the driver supplies), so there is no
    // promised target to break. What the platform owes is narrower and
    // dialect-independent — *an upsert must never modify a row whose identity
    // the caller did not supply and whose conflict key it did not name*
    // (maintainer ruling 2026-08-15) — and that is a statement about the row
    // the statement LANDED on, which no pre-flight can know.
    //
    // So this verdict does not refuse. It reports that a rival key exists and
    // the landing row must therefore be verified after the fact; see
    // {@link upsert} for the check and {@link refuseCrossRowIdentityMerge}
    // for the sentence. Refusing here instead would be the blanket option the
    // ruling excluded: on this path every non-primary UNIQUE key is a rival,
    // so "narrowed to tables carrying a rival key" and "every table with a
    // business unique key" are THE SAME SET — the narrowing that made the
    // refusal proportionate for a caller-named target does not exist here.
    if (keys.some((i) => i.primary === true && covers(i))) {
      const rivals = keys.filter((i) => i.primary !== true && !covers(i));
      return rivals.length > 0 ? { kind: 'identity-at-risk', rivals } : { kind: 'honoured' };
    }
    // A UNIQUE key that is neither the named target nor the primary key can
    // absorb the conflict instead of it. An index over the SAME columns as the
    // target is not a rival: colliding on it is colliding on the target.
    const rivals = keys.filter((i) => i.primary !== true && !covers(i));
    return rivals.length > 0 ? { kind: 'ambiguous', rivals } : { kind: 'honoured' };
  };

  // Only the two REFUSING verdicts re-read the cache. [#8807]'s
  // `identity-at-risk` deliberately does not, and the asymmetry is the reason:
  // a re-read exists so a stale cache can never produce a FALSE REFUSAL, and
  // this verdict refuses nothing. Both staleness directions are safe here — a
  // rival created since the read means the check is skipped (exactly today's
  // behaviour, nothing lost), and a rival DROPPED since the read means the
  // check runs and passes, because the merge really does land on the primary
  // key. Re-reading anyway would put a round trip on the hot path of every
  // ordinary upsert to sharpen an answer that cannot be wrong in the
  // expensive direction.
  const refusing = (v: Verdict): boolean => v.kind === 'unbacked' || v.kind === 'ambiguous';

  let keys = await this.introspectKeyIndexes(tableName);
  if (keys !== null && keys.length > 0 && refusing(judge(keys))) {
    // A cache filled before the index was created is the only way a real key
    // can be missing here, and a cache filled before one was DROPPED is the
    // only way a rival key can be reported that no longer exists. Both are
    // cheaper to re-read once on the refusing path than to risk refusing a
    // call the database would have merged — the same asymmetry, now covering
    // both verdicts.
    keys = await this.introspectKeyIndexes(tableName, { fresh: true });
  }
  if (keys === null || keys.length === 0) return { verifyIdentity: false };

  const verdict = judge(keys);
  if (verdict.kind === 'honoured') return { verifyIdentity: false };

  if (verdict.kind === 'identity-at-risk') {
    return { verifyIdentity: true, rivals: verdict.rivals, tableName };
  }

  // [#8807] A target the caller did NOT name is never refused. `['id']` is
  // what this driver substitutes when `conflictKeys` is absent, so a refusal
  // reached from there would be refusing the driver's own default — and the
  // two spellings compile byte-identically, which is precisely why #8755
  // declined to separate them. Both refusals below answer a caller who named
  // something the dialect cannot honour; with nothing named there is no such
  // caller, and the post-hoc identity check above is the whole remedy.
  if (!callerNamed) return { verifyIdentity: false };

  if (verdict.kind === 'ambiguous') {
    throw refuseAmbiguousConflictTarget(object, mergeKeys, tableName, verdict.rivals);
  }

  // The introspected keys stand where the server's sentence stands on the
  // other two dialects: the caller-visible message is the shared wording, and
  // `cause` carries the ground truth an operator needs to act. Schema
  // identifiers only — no row values, matching the payload contract the
  // refusal already keeps.
  throw refuseUnbackedConflictTarget(object, mergeKeys, unbackedConflictTargetCause(tableName, mergeKeys, keys));
}

/** The body of `SqlDriver#assertConflictTargetBackedWithoutClause`; the method's docblock there is its contract. */
export async function assertConflictTargetBackedWithoutClause(this: Pick<UpsertConflictTargetHost, 'introspectKeyIndexes' | 'physicalTableByObject'>, object: string, writeTable: string, mergeKeys: string[]): Promise<void> {
  const tableName = this.physicalTableByObject[writeTable] ?? writeTable;
  const backed = (keys: PhysicalIndex[] | null): boolean =>
    keys === null || keys.length === 0 || keys.some((i) => indexCoversConflictTarget(i, mergeKeys));
  if (backed(await this.introspectKeyIndexes(tableName))) return;
  const fresh = await this.introspectKeyIndexes(tableName, { fresh: true });
  if (backed(fresh)) return;
  throw refuseUnbackedConflictTarget(object, mergeKeys, unbackedConflictTargetCause(tableName, mergeKeys, fresh!));
}
