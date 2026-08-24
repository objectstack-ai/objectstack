// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE batched existence read for a boot seeder whose input set is known in
 * full before its loop starts (#10946).
 *
 * ## Why this exists
 *
 * `bootstrapDeclaredPermissions` and `bootstrapDeclaredPositions` are
 * read-then-write reconcilers over a list the caller already holds. Written
 * as a per-item `SELECT … WHERE name = ? LIMIT 1` inside a `for await` loop,
 * each declared item costs its own database ROUND TRIP — invisible on a local
 * file database, one sequential HTTP request per leg on a remote libsql/Turso
 * database, i.e. on every hosted environment. Measured on a real per-environment
 * kernel build with every `@libsql/client` call counted, the two loops together
 * grew a REBUILD (tables present, rows already seeded, nothing to change) by
 * **exactly 4.0000 round trips per declared item, R² = 1.000000** on both axes.
 *
 * Schema sync had already been batched (`TursoDriver.supports.batchSchemaSync`),
 * which is why objects/views/artifact seeds add 0.00 round trips each on the
 * same rig; identity content was the one content axis still paying per item.
 *
 * ## The seam that has to be judged carefully
 *
 * ⛔ **A read that CANNOT ANSWER is not the answer "none of them exist."** That
 * conflation is the whole risk of hoisting the read: one swallowed failure
 * would make every boot conclude that nothing is seeded and re-create
 * everything — a far worse defect than the round trips being removed. The
 * per-item shape was accidentally immune to it (a failed read fell through to
 * an insert that failed too, for that one item only); a batched read is not,
 * because one failure now speaks for the entire set.
 *
 * So the seam is judged on **whether the driver returned a result set**, never
 * on whether the array came back empty:
 *
 *  - a thrown read                        → could not answer
 *  - a response that is neither an array
 *    nor `{ records: [...] }`             → could not answer
 *  - `[]`                                 → ANSWERED: none of these names exist
 *
 * "Could not answer" degrades — loudly warned — to the per-item read the loops
 * used before, which is the case that matters for a driver that simply does not
 * do `$in`: everything then proceeds exactly as it did pre-#10946, only slower.
 * When the per-item read cannot answer either (the database is genuinely
 * unreachable), the oracle reports {@link ExistingLookupResult} `unknown` and
 * the seeder declines to touch that name at all.
 *
 * ⚠️ That last step is STRICTER than the code it replaces, deliberately. The old
 * loop turned a failed read into an insert attempt and relied on the `name`
 * unique index to refuse it — a database constraint standing in for a decision
 * the seeder should have been making. On any deployment where that index is
 * absent or not yet created, the old shape DUPLICATED rows instead of declining.
 *
 * None of this is a lenient fallback for off-contract input (AGENTS.md Prime
 * Directive #12): the batched and per-item reads ask the driver the same
 * question, and the answer has one meaning.
 *
 * ## Chunking
 *
 * `$in` binds one parameter per name, and SQLite builds cap bound parameters
 * (`SQLITE_MAX_VARIABLE_NUMBER`, historically 999). {@link NAME_CHUNK_SIZE}
 * keeps a single read well under every such cap, so the cost is
 * `ceil(N / 500)` reads — constant for every realistic declaration count and,
 * unlike an unchunked read, incapable of turning a large environment's boot
 * into a hard driver error.
 *
 * ## Organization scope (#10103)
 *
 * The catalog these seeders write is materialized PER ORGANIZATION under a
 * walled posture, so this oracle answers "does THIS organization have a row for
 * this name" — not "does any row anywhere carry this name". Two consequences,
 * and the second is the one that bites:
 *
 *  - the read is threaded with the organization, so it routes through
 *    `SqlDriver.applyTenantScope` (the governed chokepoint) rather than
 *    re-implementing a wall predicate here;
 *  - "first row wins" stops being right. `applyTenantScope` returns the
 *    caller's rows AND organization-less ones, so a page can carry two rows for
 *    one name, in driver order. Taking whichever came first would let a PRE-FIX
 *    organization-less row answer for this organization, the loop would take its
 *    update branch, and no per-organization copy would ever be created — a
 *    silent no-op that leaves a walled deployment exactly as broken as before
 *    while reporting success. It was measured. So the two are separated:
 *    {@link ExistingLookupResult} `present` means THIS organization's own row,
 *    and an organization-less leftover comes back on the `absent` result as
 *    {@link ExistingLookupResult} `organizationLessResidue`, so the caller both
 *    creates the copy and can report the leftover loudly.
 *
 * A pass with no organization (the `single`-posture carve-out) is unchanged in
 * every respect: nothing is threaded, and the first row is the row.
 */

import { resolveOwnOrganizationRow, seedCtx as lookupCtx } from './per-organization-catalog.js';



/** Names bound into one `$in` read. See the chunking note in the module header. */
export const NAME_CHUNK_SIZE = 500;

export interface SeedLookupLogger {
  info?: (m: string, meta?: Record<string, any>) => void;
  warn?: (m: string, meta?: Record<string, any>) => void;
}

/**
 * What the oracle knows about one name. THREE outcomes, not two: `absent` is a
 * fact the driver reported, `unknown` is the absence of any fact at all.
 *
 * ⛔ Collapsing `unknown` into `absent` is the whole hazard of hoisting the
 * read, and the reason this is a union rather than `row | undefined`. A caller
 * that treats "I could not find out" as "it is not there" INSERTS — and does so
 * for every name at once, because a batched read fails for the whole set. The
 * per-item shape hid this behind the unique index (the blind insert was refused
 * by the database, which is a guard, not a design); the tri-state makes the
 * seeder decline on its own.
 */
export type ExistingLookupResult =
  | { status: 'present'; row: any }
  /**
   * No row for this name IN THIS ORGANIZATION. `organizationLessResidue` names a
   * pre-fix row that belongs to no organization and is visible here only through
   * the driver's compatibility arm — the caller creates its own copy anyway and
   * reports the leftover (#10103).
   */
  | { status: 'absent'; organizationLessResidue?: any }
  | { status: 'unknown' };

const ABSENT: ExistingLookupResult = { status: 'absent' };
const UNKNOWN: ExistingLookupResult = { status: 'unknown' };

/**
 * The existence oracle a seed loop consults in place of its own per-item read.
 *
 * ⚠️ {@link ExistingByNameIndex.remember} is not an optimization — it is what
 * keeps hoisting the read out of the loop behaviour-preserving. The per-item
 * read saw rows the SAME loop had just inserted, so a name declared twice in
 * one batch resolved as present on the second pass and took the caller's
 * collision branch (which, for permission sets, is the loud ADR-0086 D4
 * "owned by another package" refusal). A snapshot taken before the loop cannot
 * see those inserts: without `remember`, the second declaration would attempt
 * an insert instead, the unique index would refuse it, and a refusal that used
 * to be reported would become a silent nothing. So every caller that inserts
 * records the row it created.
 */
export interface ExistingByNameIndex {
  /** What is known about `name` — see {@link ExistingLookupResult}. */
  get(name: string): Promise<ExistingLookupResult>;
  /** Record a row the calling loop just created under `name`. */
  remember(name: string, row: any): void;
}

/**
 * Read one page of names. Returns `null` — distinct from `[]` — when the driver
 * did not return a result set at all.
 */
async function readNamePage(
  ql: any,
  object: string,
  names: string[],
  organizationId?: string,
  equals?: Readonly<Record<string, unknown>>,
): Promise<any[] | null> {
  let rows: any;
  try {
    rows = await ql.find(
      object,
      {
        // [#11451] `...(equals ?? {})` spreads NOTHING when no predicate was
        // given, so a caller that passes none emits the exact key set it
        // emitted before — not the same keys plus `undefined`-valued ones,
        // which `toEqual` would have quietly accepted.
        where: { name: { $in: names }, ...(equals ?? {}) },
        // [#10103] `names.length` was exactly right while one row existed per
        // name. Once the catalog is per organization the driver returns this
        // organization's rows AND any organization-less ones, so that cap
        // TRUNCATES — and a truncated page reads as "absent", which inserts.
        // Bounded, just wide enough to admit both.
        limit: organizationId ? names.length * 2 : names.length,
      },
      { context: lookupCtx(organizationId) },
    );
  } catch {
    return null;
  }
  if (Array.isArray(rows)) return rows;
  // Some drivers wrap the page (`{ records }`) — a wrapped array is still an
  // answer. Anything else (undefined/null/a scalar) is not.
  if (Array.isArray(rows?.records)) return rows.records as any[];
  return null;
}

/**
 * The per-item read the loops used before #10946 — the degradation path.
 *
 * `remember` is a deliberate no-op: this oracle re-reads the database on every
 * call, so it already sees rows the loop inserted a moment ago.
 */
function perItemIndex(
  ql: any,
  object: string,
  organizationId?: string,
  equals?: Readonly<Record<string, unknown>>,
): ExistingByNameIndex {
  return {
    async get(name: string): Promise<ExistingLookupResult> {
      let rows: any;
      try {
        // Limit 5, not 1, when scoped: a single row would be whichever the
        // driver ordered first, and this read must be able to tell this
        // organization's row from an organization-less leftover.
        //
        // [#11451] The predicate rides the DEGRADATION read too. A fallback
        // that dropped it would ask a WIDER question than the batched read it
        // is standing in for — and for the caller that needs one, wider is not
        // "slower but the same": it is a different row.
        rows = await ql.find(
          object,
          { where: { name, ...(equals ?? {}) }, limit: organizationId ? 5 : 1 },
          { context: lookupCtx(organizationId) },
        );
      } catch {
        return UNKNOWN;
      }
      const list = Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : null;
      if (list === null) return UNKNOWN;
      return resolveForOrganization(list, organizationId);
    },
    remember() { /* re-read every call — nothing to cache */ },
  };
}

/**
 * Which of the rows a read returned for ONE name is this organization's,
 * expressed as this module's tri-state.
 *
 * The organization split itself is NOT decided here — it delegates to
 * {@link resolveOwnOrganizationRow}, the one spelling of that question the
 * catalog has. Two spellings of "which row is mine" is exactly the shape that
 * produced the defect this scoping repairs (one question, two implementations,
 * the ungoverned copy winning), so this function only translates that answer
 * into `present` / `absent` + leftover.
 *
 * Unscoped (the `single`-posture pass) the first row is the row, exactly as
 * before.
 */
function resolveForOrganization(rows: any[], organizationId?: string): ExistingLookupResult {
  const { own, organizationLessResidue } = resolveOwnOrganizationRow(rows, organizationId);
  if (own) return { status: 'present', row: own };
  return organizationLessResidue ? { status: 'absent', organizationLessResidue } : ABSENT;
}

/**
 * Build the existence lookup a seed loop should use: ONE batched read for the
 * whole name set, degrading to the per-item read when that read cannot answer.
 *
 * `names` may contain duplicates and blanks; both are dropped before the read.
 */
export async function buildExistingByName(
  ql: any,
  object: string,
  names: readonly (string | null | undefined)[],
  logger?: SeedLookupLogger,
  /**
   * Answer for THIS organization (#10103). Omitted = the pre-existing
   * installation-wide question, which is what a `single`-posture pass wants.
   */
  organizationId?: string,
  /**
   * [#11451] An extra EQUALITY predicate ANDed onto the `$in`, for a caller
   * whose existence question is narrower than "a row with this name".
   *
   * `bootstrapSystemCapabilities`' curated half asks for the platform's OWN
   * organization-less row (`managed_by: 'platform'` + `organization_id: null`,
   * #8470), not the first row that happens to share the name. Post-#8461 those
   * are different questions: `sys_capability.name` is unique per ORGANIZATION,
   * so one name can have a row per organization plus the platform's.
   *
   * ⚠️ PRECONDITION, and it is the caller's to discharge: the predicate must
   * keep the result a SINGLETON per name. `readNamePage` caps an unscoped page
   * at `names.length`, so a question that can return more than one row per name
   * truncates — and a truncated page reads as `absent`, which INSERTS. The
   * curated predicate discharges this by construction: the declared unique key
   * is `(COALESCE(organization_id, '__global__'), name)` (ADR-0120 D3), so the
   * NULL-organization bucket admits at most one row per name — "exactly the
   * bucket this key part keeps a singleton", as `sys-capability.object.ts` puts
   * it. Narrowing can only SHRINK a page, so passing a predicate never makes
   * truncation likelier than the unpredicated read it replaces.
   */
  equals?: Readonly<Record<string, unknown>>,
): Promise<ExistingByNameIndex> {
  // Every row the page carried for a name, so the organization split can be
  // judged per name rather than by arrival order.
  const index = new Map<string, any[]>();
  const fromIndex: ExistingByNameIndex = {
    async get(name: string): Promise<ExistingLookupResult> {
      // The batched read ANSWERED for every requested name, so a miss here is
      // the driver's own "no such row", not a gap in what we know.
      return resolveForOrganization(index.get(name) ?? [], organizationId);
    },
    remember(name: string, row: any) {
      if (!name || !row) return;
      const rows = index.get(name);
      if (rows) rows.push(row); else index.set(name, [row]);
    },
  };

  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (raw == null) continue;
    const name = String(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    wanted.push(name);
  }
  if (wanted.length === 0) return fromIndex;

  for (let i = 0; i < wanted.length; i += NAME_CHUNK_SIZE) {
    const page = await readNamePage(ql, object, wanted.slice(i, i + NAME_CHUNK_SIZE), organizationId, equals);
    if (page === null) {
      // ⛔ NOT "none of them exist" — see the module header. Fall back to the
      // per-item read so behaviour is exactly what it was before the hoist.
      logger?.warn?.(
        '[security] batched seed existence read failed — falling back to one read per item',
        { object, names: wanted.length, ...(organizationId ? { organization: organizationId } : {}) },
      );
      return perItemIndex(ql, object, organizationId, equals);
    }
    for (const row of page) {
      const name = row?.name;
      if (name == null) continue;
      // [#10103] EVERY row is kept, not just the first. A scoped page can carry
      // this organization's row and an organization-less leftover for the same
      // name, in driver order, and `resolveForOrganization` — not arrival order
      // — decides which one answers. Unscoped, the first row is still the row:
      // the caller's own uniqueness rules decide what a duplicate name means and
      // this read does not reorder that judgement.
      const key = String(name);
      const rows = index.get(key);
      if (rows) rows.push(row); else index.set(key, [row]);
    }
  }
  return fromIndex;
}
