// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the ETag hash, the two version-token error classes, and the canonical version and audit instants.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */

/**
 * Simple hash function for ETag generation (browser-compatible)
 * Uses a basic hash algorithm instead of crypto.createHash
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}

/**
 * Thrown by `updateData` / `deleteData` when the caller supplies an
 * `expectedVersion` that does not match the current record's `updated_at`.
 *
 * The HTTP layer maps this to `409 Conflict` with code `CONCURRENT_UPDATE`,
 * and includes both the current server-side version and the current record
 * payload so the client can render an informed conflict-resolution UI
 * ("Reload latest" vs. "Overwrite anyway"). The record is the row as the
 * caller reads it, and a row the caller cannot read is never a conflict: it
 * answers not-found instead (#23586, see `assertVersionOf`).
 *
 * NOTE: This is an *application-level* compare-and-set — not an atomic
 * storage-layer CAS. There is a small TOCTOU window between the version
 * check and the subsequent write. For the conflict frequency this targets
 * (different users seconds-to-minutes apart in B2B record editing) this
 * is more than adequate; a future revision can push the check into the
 * driver's UPDATE statement (`WHERE id=? AND updated_at=?`) for true
 * atomicity.
 */
export class ConcurrentUpdateError extends Error {
    readonly code = 'CONCURRENT_UPDATE';
    readonly status = 409;
    readonly currentVersion: string | null;
    readonly currentRecord: unknown;
    constructor(opts: { currentVersion: string | null; currentRecord: unknown; message?: string }) {
        super(opts.message ?? 'Record was modified by another user');
        this.name = 'ConcurrentUpdateError';
        this.currentVersion = opts.currentVersion;
        this.currentRecord = opts.currentRecord;
    }
}

/**
 * [#13576] Thrown when a caller-supplied `expectedVersion` — the `If-Match`
 * header or the body/query `expectedVersion` field — is a syntactically legal
 * but semantically empty RFC-7232 entity-tag: the quoted-empty token `""`.
 *
 * ## Why this is refused rather than silently treated as "no token" (the
 * pre-#13576 behaviour) or silently treated as a conflict (409)
 *
 * `""` is valid `entity-tag` grammar (RFC 7232 §2.3: `weak? DQUOTE *etagc
 * DQUOTE`, and `*etagc` — zero or more — permits an EMPTY opaque-tag). But an
 * empty tag can never equal any stored `updated_at`, quoted or not: it is not
 * "the version I read", it is nothing. A client that sends it is asking for a
 * guarded write and could not possibly have a real version in hand — RFC
 * legality does not make it a meaningful concurrency token, and the platform
 * makes an explicit contract choice to treat the shape itself as a client
 * defect. Before this it fell through {@link normaliseVersionToken}'s
 * quote-strip into the same falsy `''` that "caller sent nothing" produces,
 * so the OPPOSITE of what `If-Match` requests happened: the guard was
 * SKIPPED rather than evaluated, silently, on the one token shape that opts
 * OUT of the check instead of failing it (unlike a garbage-but-nonempty token
 * such as `v2`, which still normalises to a real, comparable token and fails
 * toward `409 CONCURRENT_UPDATE` — the safe direction for a concurrency
 * primitive, and unchanged by this fix).
 *
 * A `409` here (the alternative the maintainer ruling rejected, decision #20
 * ①, 2026-08-31) would have been safer than the pre-#13576 behaviour but
 * would still have collapsed two different facts into one answer: "you lost a
 * race" (409, actionable by reloading and retrying) and "you sent something
 * that can never carry a version" (this — a client-side bug, not a race). A
 * `400` keeps that distinction legible, which is the entire reason option 3
 * was chosen over option 2.
 *
 * `VALIDATION_FAILED`/400 is this package's own house code for a
 * caller-request defect the engine never has to touch (mirrors
 * {@link rowRequiredIdError}) — already registered in the ADR-0112
 * error-code ledger under `@objectstack/metadata-protocol`, so this needs no
 * new ledger entry.
 */
export class MalformedVersionTokenError extends Error {
    readonly code = 'VALIDATION_FAILED';
    readonly status = 400;
    readonly fields: never[] = [];
    constructor() {
        super(
            'expectedVersion (If-Match) is the empty entity-tag `""`. An empty version '
            + 'token can never match any stored version, so this is almost certainly a '
            + 'client defect rather than a real concurrency check — send the real version '
            + 'token you read (e.g. the record\'s `updated_at`), or omit If-Match / '
            + 'expectedVersion entirely to perform an unguarded write.',
        );
        this.name = 'MalformedVersionTokenError';
    }
}

/**
 * An ISO-8601 date-time that denotes an ABSOLUTE instant — it carries an
 * explicit `Z` or a numeric `±HH:mm` offset, so reading it never consults the
 * process timezone.
 *
 * Deliberately narrower than a bare `Date.parse`, which falls back to
 * implementation-specific heuristics outside this shape and reads a zone-LESS
 * date-time as *local* time — the one thing an OCC verdict must never depend on.
 * A string this pattern rejects is not reinterpreted: it stays an opaque token
 * and is compared verbatim, exactly as before.
 */
const ABSOLUTE_ISO_INSTANT =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Largest magnitude a JS time value may hold; `toISOString()` throws beyond it. */
const MAX_TIME_VALUE = 8.64e15;

/**
 * The canonical absolute-instant spelling of a version token, or null when the
 * token does not denote an instant.
 *
 * The input domain is the set of things a DRIVER puts in `updated_at`, measured
 * rather than listed from memory (#13382):
 *
 *  - **JS `Date`** — `driver-sql` on Postgres and MySQL (`timestamptz` /
 *    `DATETIME(3)` are instants, and the driver materialises them as `Date` on
 *    purpose; `SqlDriver.withPostgresCalendarDayAsText` says so in as many
 *    words) and `driver-mongodb` (it stamps `new Date()`, and BSON round-trips
 *    it). Canonical form: `toISOString()`.
 *  - **`string`, already canonical ISO-8601 UTC with milliseconds** —
 *    `driver-sql` on SQLite, its `driver-turso` / `driver-sqlite-wasm` siblings,
 *    and `driver-memory`. Canonical form: itself, re-derived through `Date`.
 *  - **`number`, epoch milliseconds** — a pre-canonical or hand-migrated SQLite
 *    column. Reachable: the driver's legacy datetime repair is keyed on declared
 *    `Field.datetime` columns, and the engine-injected audit columns are not in
 *    that set, so such a value passes through unrepaired. Canonical form:
 *    `new Date(ms).toISOString()`.
 *  - **`null` / `undefined`** — timestamps disabled, or no such column. No
 *    check runs at all; handled by the caller, not here.
 *  - **anything else** a host stamps into the column — opaque, and compared
 *    verbatim rather than guessed at.
 *
 * Milliseconds are the resolution, because that is what a JS `Date` — and so
 * every driver's materialised instant — can carry. A token with more fractional
 * digits (a Postgres microsecond rendering, say) truncates to the same
 * millisecond as the record it is compared against, which is the point: two
 * spellings of one instant must not conflict.
 */
export function canonicalVersionInstant(value: unknown, token: string): string | null {
    let ms: number;
    if (value instanceof Date) {
        ms = value.getTime();
    } else if (typeof value === 'number') {
        ms = value;
    } else if (ABSOLUTE_ISO_INSTANT.test(token)) {
        ms = Date.parse(token);
    } else {
        return null;
    }
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIME_VALUE) return null;
    return new Date(ms).toISOString();
}

/** The verbatim spelling the ADR-0067 timeline compared before #13995 - `String(v ?? '')`. */
function auditInstantToken(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
}

/**
 * Epoch milliseconds for a DRIVER-stamped audit column, or null when the value
 * does not denote an instant.
 *
 * The input domain is {@link canonicalVersionInstant}'s, and it is delegated to
 * rather than re-spelled: that domain (`Date` / epoch `number` / canonical ISO
 * text / opaque) was measured off the drivers for #13382 and is the same set a
 * `created_at` arrives in. Its canonical answer round-trips through `Date.parse`
 * exactly, and it has already bounded the value to a finite, `toISOString`-able
 * time, so the number below is always finite.
 */
function auditInstantMs(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const canonical = canonicalVersionInstant(value, auditInstantToken(value).trim());
    return canonical === null ? null : Date.parse(canonical);
}

/**
 * Compare two engine-stamped audit instants, OLDEST-FIRST (`< 0` when `a` is
 * older than `b`) - the shape both a `sort` comparator and a "strictly newer
 * than" filter need.
 *
 * ## Why this exists (#13995)
 *
 * `created_at` is an engine-injected audit column: it is not in `datetimeFields`,
 * and `SqlDriver#formatOutput` repairs it only inside `if (this.isSqlite)`, so
 * the live dialects hand it out of the record read door as a JS `Date` and the
 * SQLite family as canonical ISO-Z text (pinned by driver-sql's
 * `sql-driver-13567-audit-stamp-materialisation.test.ts`). `String(aDate)` is
 * `"Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)"`, whose LEADING
 * token is the weekday NAME - so a lexicographic compare over those strings
 * orders `Fri < Mon < Sat < Sun < Thu < Tue < Wed`, which has nothing to do with
 * chronology. It is stable across the whole set, so the failure is systematic
 * rather than intermittent: there is never an "it worked once" to warn anyone.
 * Both ADR-0067 commit-timeline consumers compared exactly that way, and one of
 * them - {@link ObjectStackProtocolImplementation.rollbackToPackageCommit} -
 * chooses the set of commits to UNDO with it.
 *
 * ## Why a sibling of {@link canonicalVersionInstant} rather than a reuse of
 * {@link versionTokensAgree}
 *
 * The canonicalisation IS reused (see {@link auditInstantMs}). What is not is
 * `versionTokensAgree`: it answers EQUALITY between two client-facing version
 * TOKENS, and ordering needs `<`/`>`, not `===`. It also takes the pre-tidied
 * {@link NormalisedVersion} pair an HTTP `If-Match` header produces - RFC-7232
 * quote stripping, the "no token supplied" opt-out - none of which applies to a
 * column a driver stamped and no client ever sends.
 *
 * The opaque limb is deliberately the one `versionTokensAgree` documents: when
 * either side does not denote an instant, the two are compared VERBATIM, exactly
 * as this seam did before. So the only verdicts that change are pairs that denote
 * instants - the defect - and nothing a host stamps into the column starts
 * ordering differently. This is not a tolerant fallback over a mis-spelled key
 * (#13973's standing prohibition): no alternative spelling is accepted anywhere
 * here, and an unparseable value is not repaired, only left where it was.
 */
function compareAuditInstants(a: unknown, b: unknown): number {
    const aMs = auditInstantMs(a);
    const bMs = auditInstantMs(b);
    if (aMs !== null && bMs !== null) {
        return aMs < bMs ? -1 : aMs > bMs ? 1 : 0;
    }
    const aToken = auditInstantToken(a);
    const bToken = auditInstantToken(b);
    return aToken < bToken ? -1 : aToken > bToken ? 1 : 0;
}

/**
 * Canonicalise the ONE driver materialisation {@link listCommits} was
 * measured to produce for `sys_metadata_commit.created_at` — a valid JS
 * `Date` — into the ISO-8601 string the return type declares (`createdAt?:
 * string`). Every other shape, INCLUDING an Invalid `Date`, is returned
 * UNTOUCHED.
 *
 * [#14038] `created_at` is an engine-injected audit column: it is not in
 * `datetimeFields`, and `SqlDriver#formatOutput` repairs it only inside its
 * `if (this.isSqlite)` arm (pinned live in driver-sql's
 * `sql-driver-13567-audit-stamp-materialisation.test.ts`), so Postgres and
 * MySQL hand it out of the record read door as a JS `Date` while the
 * mapping below assigned it straight through as `r.created_at` — an
 * unchecked value from an `any[]` row, never a measurement against the
 * declared `string` return type.
 *
 * ⚠️ Deliberately NOT the `canonicalIsoInstant` spelling next door in
 * `sys-metadata-repository.ts` / `database-loader.ts` — which is, since
 * #16422, the ONLY spelling at #14037's sibling sites. That difference used
 * to be exactly one input shape — the Invalid
 * `Date` on which that spelling raised `RangeError: Invalid time value`,
 * measured reachable on BOTH live dialects (a MySQL zero datetime; any
 * Postgres year in 275760..294276). #14078 has since RULED it (option B,
 * 2026-09-02): that arm is now total and answers `undefined` for the shape.
 *
 * ⛔ They are still not ONE spelling, and **#16422 ruled that this copy is the
 * one that stays**. That card collapsed the family's other four call sites —
 * `rowToEvent` in `sys-metadata-repository.ts` and the three adapter
 * boundaries in `database-loader.ts` — into `canonicalIsoInstant` and deleted
 * both sibling definitions of this spelling. This site was held out, for the
 * reason the last paragraph below states: `listCommits` promises its callers
 * the RAW value back for a non-`Date`, and `canonicalIsoInstant` rewrites the
 * whole domain. Measured on the seven inputs that distinguish the two
 * helpers, swapping it in here moves three: an Invalid `Date` would be ERASED
 * from the response (`undefined` — the one answer [ADR-0053 D-F3] refuses,
 * because it silently drops a value that is on disk), and a `number` and an
 * opaque object would reach {@link compareAuditInstants} as `String(value)`
 * rather than verbatim, reordering rows this seam deliberately leaves alone.
 *
 * ⇒ The family is now two DELIBERATE helpers, not one pending merge: the
 * shared domain rewrite at the sites whose declared field is a
 * `z.string().datetime()` and whose caller carries a terminal value, and this
 * narrow one-shape conversion at the site whose declared contract is
 * pass-through. ⛔ Do not collapse it without superseding that ruling.
 *
 * ⛔ NOT a tolerant fallback (#13973's standing prohibition): it teaches no
 * consumer to accept an off-spec shape; it converts the one measured
 * producer materialisation at the producer. The
 * `!Number.isNaN(value.getTime())` guard is the same one #14037 used for
 * its two sibling sites, not a new spelling.
 *
 * ⛔ Not exported and not merged into {@link canonicalVersionInstant} above:
 * that helper answers a different question (does this token denote AN
 * instant at all, returning `null` when it does not) and callers of
 * `listCommits` are promised the RAW value back untouched when it is not a
 * valid `Date` — an absent/opaque column must still reach `sort`'s fallback
 * branch and any in-process reader exactly as before. Consolidating the
 * family's near-identical copies was expected to be #14078's call; that
 * ruling covered only the five arms that threw, and #16422 then ruled this
 * promise the reason to keep this copy rather than the obstacle to removing
 * it. §D of `protocol-14038-list-commits-created-at-iso.test.ts` is the pin.
 */
function isoFromValidDate(value: unknown): unknown {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    return value;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { compareAuditInstants, isoFromValidDate, simpleHash };
