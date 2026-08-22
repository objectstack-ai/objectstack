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
 */

const SYSTEM_CTX = { isSystem: true };

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
  | { status: 'absent' }
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
async function readNamePage(ql: any, object: string, names: string[]): Promise<any[] | null> {
  let rows: any;
  try {
    rows = await ql.find(
      object,
      { where: { name: { $in: names } }, limit: names.length },
      { context: SYSTEM_CTX },
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
function perItemIndex(ql: any, object: string): ExistingByNameIndex {
  return {
    async get(name: string): Promise<ExistingLookupResult> {
      let rows: any;
      try {
        rows = await ql.find(object, { where: { name }, limit: 1 }, { context: SYSTEM_CTX });
      } catch {
        return UNKNOWN;
      }
      const list = Array.isArray(rows) ? rows : Array.isArray(rows?.records) ? rows.records : null;
      if (list === null) return UNKNOWN;
      return list[0] ? { status: 'present', row: list[0] } : ABSENT;
    },
    remember() { /* re-read every call — nothing to cache */ },
  };
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
): Promise<ExistingByNameIndex> {
  const index = new Map<string, any>();
  const fromIndex: ExistingByNameIndex = {
    async get(name: string): Promise<ExistingLookupResult> {
      const row = index.get(name);
      // The batched read ANSWERED for every requested name, so a miss here is
      // the driver's own "no such row", not a gap in what we know.
      return row ? { status: 'present', row } : ABSENT;
    },
    remember(name: string, row: any) {
      if (name && row && !index.has(name)) index.set(name, row);
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
    const page = await readNamePage(ql, object, wanted.slice(i, i + NAME_CHUNK_SIZE));
    if (page === null) {
      // ⛔ NOT "none of them exist" — see the module header. Fall back to the
      // per-item read so behaviour is exactly what it was before the hoist.
      logger?.warn?.(
        '[security] batched seed existence read failed — falling back to one read per item',
        { object, names: wanted.length },
      );
      return perItemIndex(ql, object);
    }
    for (const row of page) {
      const name = row?.name;
      if (name == null) continue;
      // First row wins: the caller's own uniqueness rules decide what a
      // duplicate name means, and this read must not reorder that judgement.
      if (!index.has(String(name))) index.set(String(name), row);
    }
  }
  return fromIndex;
}
