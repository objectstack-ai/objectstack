// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one home for Postgres' `«sub-object» "x" of relation "y" …` phrasing
 * (#6615).
 *
 * ## The superstring hole, stated once
 *
 * Postgres phrases a failure about something *inside* a relation by naming the
 * relation too:
 *
 * ```
 * column     "label"           of relation "sys_team" does not exist   (42703)
 * constraint "uq_sys_team_name" of relation "sys_team" does not exist  (42704)
 * column     "environment_id"  of relation "sys_metadata" already exists (42701)
 * ```
 *
 * Every one of those **contains a complete, legal missing-TABLE phrase** —
 * `relation "sys_team" does not exist` — as a substring, while meaning the
 * opposite: the relation is right there, which is precisely why it could be
 * named. No amount of tightening a "does this say a relation is missing?"
 * regex can remove that match, because the phrase really is in there. The only
 * repair is to ask the more specific question FIRST. That makes the ORDER the
 * fix, not the pattern — and it is why three packages each grew their own copy
 * of this phrase (#5352, #6035/PR #6346, #6347/PR #6613) before it was given a
 * home.
 *
 * ## Two widths, on purpose — never collapse them
 *
 * The three consumers do not want the same regex, and the difference is not
 * sloppiness: it is **which direction of error is safe** at each site.
 *
 * | consumer | asks | uses | a MISS costs |
 * |:---|:---|:---|:---|
 * | `@objectstack/rest` `mapDataError` (#5352) | which column? | {@link matchMissingColumnOfRelation} | a vaguer message (`404` instead of `400 INVALID_FIELD`) |
 * | `@objectstack/service-analytics` `isMissingSourceError` / `missingSourceRelation` (#6035) | is this a missing COLUMN, so keep it hard? | {@link matchMissingColumnOfRelation} | a mistyped column degrades to a confident empty chart |
 * | `@objectstack/metadata` `MISSING_TABLE.excludes` (#6347) | is this about a sub-object, so not a missing table? | {@link isRelationSubObjectPhrase} | a corruption verdict returns (`event_seq` restarts at 1) |
 *
 * The first two **extract**, so they must be strict: over-matching there would
 * turn a genuinely missing table into a hard failure and regress #5033's
 * deliberate leniency, while under-matching merely keeps today's verdict. The
 * third **excludes**, so it is deliberately wider — any sub-object, any quoted
 * identifier, any verdict — because over-matching there only ever converts a
 * benign verdict into a loud one, and a miss restores data corruption.
 *
 * Collapsing the two into one regex would therefore be wrong for one caller
 * whichever width won. They are two exports for that reason, and the reason is
 * load-bearing rather than stylistic.
 *
 * ## Home
 *
 * `@objectstack/types`, following `isUniqueViolationError`'s move
 * (#6250 — four hand-written answers to one question) and
 * `isModuleNotFoundError`'s (framework#3265 — "single shared owner … so the
 * parallel loaders cannot drift apart"). This module deliberately imports
 * nothing.
 *
 * ⚠️ Unlike #6250, adopting this **does** add one dependency edge:
 * `@objectstack/service-analytics` did not depend on `@objectstack/types`
 * before #6615. It is acyclic by construction — `@objectstack/types` depends
 * only on `@objectstack/spec`, which depends on nothing in-repo, so no package
 * except `spec` itself can form a cycle by consuming it — and 25 of the repo's
 * 73 packages (5 of 16 services) already carry the same edge. Recorded here
 * rather than left for a reader to rediscover.
 */

/**
 * Postgres' missing-COLUMN template, strictly. Returns the column name, or
 * `undefined` when the message is not that phrase.
 *
 * Anchored to `column "%s" of relation "%s" does not exist` — the exact errmsg
 * template Postgres emits for SQLSTATE 42703 on the write path
 * (`INSERT` / `UPDATE` / `ALTER`). Both quotes are required because Postgres
 * always emits them here, and requiring them is the safe direction of error for
 * the two consumers that call this.
 *
 * Deliberately narrow in two further ways, both preserved verbatim from the
 * open-coded copies this replaces:
 *
 * - the identifier is `[a-z0-9_]+` (case-insensitive), so a quoted identifier
 *   carrying a space or punctuation is NOT matched. Postgres can quote such
 *   names; the consumers accept the miss because a miss is the cheap direction.
 * - the relation is `\S+` — quoted or bare, unparsed. This function answers
 *   "which COLUMN", never "which relation".
 *
 * The read-path phrasing `column "bogus" does not exist` is a different
 * sentence with no relation in it, so it does not match — and it does not need
 * to: it carries no missing-table substring, which is the whole hole this
 * module exists for.
 */
export function matchMissingColumnOfRelation(message: string): string | undefined {
    return MISSING_COLUMN_OF_RELATION.exec(message)?.[1];
}

/**
 * The same quirk, **wider**: does this message talk about any sub-object of a
 * relation, in any verdict?
 *
 * Drops all three of {@link matchMissingColumnOfRelation}'s anchors — the
 * literal `column`, the `[a-z0-9_]+` identifier shape, and the trailing
 * `does not exist` — so it also recognises `constraint "uq_x" of relation "y"
 * does not exist` (42704), `column "x" of relation "y" already exists` (42701),
 * and every other sub-object Postgres phrases this way.
 *
 * For **exclusion** callers only. A `true` here means "the relation is present,
 * so whatever else this error is, it is not a missing table"; it does not mean
 * the error is benign and it names nothing. Using it to extract would be a
 * category error — there is no capture group precisely so that it cannot be.
 */
export function isRelationSubObjectPhrase(message: string): boolean {
    return RELATION_SUB_OBJECT.test(message);
}

/**
 * The strict extractor's pattern. Module-private: exported behaviour is the two
 * functions above, so a consumer cannot read the wrong capture group, re-flag
 * the regex, or quietly widen one width toward the other.
 */
const MISSING_COLUMN_OF_RELATION =
    /column\s+["'`]([a-z0-9_]+)["'`]\s+of relation\s+\S+\s+does not exist/i;

/** The wide detector's pattern. Module-private for the same reason. */
const RELATION_SUB_OBJECT = /["'`][^"'`]+["'`]\s+of relation\s/i;
