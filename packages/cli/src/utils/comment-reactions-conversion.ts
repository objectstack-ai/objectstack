// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MigrationFlagEngine } from '@objectstack/platform-objects/system';
import type { DataMigrationFlag } from '@objectstack/spec/system';

/**
 * [#23281] The conversion of the emoji reactions a 17.x deployment stored in
 * `sys_comment.reactions` into `sys_comment_reaction` records, and the one
 * question `os migrate apply` asks of it before it drops that column.
 *
 * ## Why this exists
 *
 * v18 retired the column: a reaction is its reactor's own `sys_comment_reaction`
 * row (comment, emoji, user). Schema sync is additive, so an upgraded database
 * keeps the physical column with every map it holds, and the data door neither
 * returns nor accepts it. Without this step nothing reads that column again,
 * and the drop the drift report prescribes deletes it. An upgrade keeps
 * existing data, so each stored reaction becomes the row the reactor would own
 * had they reacted at v18.
 *
 * ## How the column is read
 *
 * Below the data door, the way `os migrate account-issuer` reads the retired
 * `sys_account.issuer`: through the driver the engine routes `sys_comment` to,
 * never through the engine's `find`, which projects the object's DECLARED
 * fields and no longer declares `reactions`. `sys_user` is read the same way,
 * because the data-migration boot composes no auth plugin and so registers no
 * user object.
 *
 * ## What a stored value converts into, and what it never converts into
 *
 * A v17 client stored `JSON.stringify({ [emoji]: userIds[] })`. Each distinct
 * (comment, emoji, user) in that map becomes one row carrying:
 *
 *  - `comment_id`, `emoji`, `user_id` from the map;
 *  - the comment's own `organization_id` — a reaction lives in its comment's
 *    organization (the ADR-0131 attribution the ownership inventory records);
 *  - `created_by` = the reactor. A reaction is its reactor's own record, and
 *    `created_by` is what the platform's own-record delete floor reads, so a
 *    converted reaction can be removed by the member who made it, exactly like
 *    one made at v18.
 *
 * Anything the map does not say is not made up. A value that does not read as
 * that map, an entry whose list is not a list of user ids, an emoji the
 * reaction object cannot hold, or a user id that names no `sys_user` row is
 * listed in the report with its comment id ({@link UnreadableReaction}) and
 * converted into nothing. The readable entries of the same map still convert.
 *
 * ## Idempotent, so a re-run is the resume
 *
 * Before writing, the reactions already stored for the page's comments are read
 * and every (comment, emoji, user) already present is skipped. A second run
 * inserts nothing; an interrupted run is finished by running it again. No
 * migration journal: each reaction is one atomic insert, so there is no partial
 * chunk for a journal to recover.
 *
 * ## The writes are bookkeeping, not member events
 *
 * {@link CONVERSION_WRITE_CTX} is the context the organization seed claim uses
 * for its own bookkeeping writes: system-elevated, with metadata-bound
 * automation off, so no app flow or metadata hook treats the conversion as a
 * member reacting. Code-registered hooks still run: the audit stamps, the
 * audit writer and sharing. plugin-audit's reaction create gate exempts a
 * system write, which is why `user_id` keeps the stored reactor rather than
 * being refused for want of a signed-in user.
 *
 * ## The verdict `os migrate apply` reads
 *
 * An `--apply` run records a `sys_migration` row under
 * {@link COMMENT_REACTIONS_MIGRATION_ID}, verified only when a read-back after
 * the writes finds every readable reaction converted and no value left
 * unreadable. That row, and nothing else, authorises dropping the column
 * ({@link readCommentReactionsConversion}). A ledger row rather than a live
 * probe, deliberately: once converted, a member may un-react, and a live probe
 * would read that deleted row as unconverted — refusing the drop forever, or,
 * worse, re-creating the reaction the member removed if the operator re-ran the
 * conversion to satisfy it. Nothing can write the column after v18 (the data
 * door refuses it), so the verified run stays true until the column is gone.
 */

/** The `sys_migration` row id this conversion records, and the drop gate reads. */
export const COMMENT_REACTIONS_MIGRATION_ID = 'sys-comment-reactions-to-records';

/** The comment table, read below the data door. */
export const COMMENT_OBJECT = 'sys_comment';
/** The retired column on it. */
export const REACTIONS_COLUMN = 'reactions';
/** The records a stored reaction becomes. */
export const COMMENT_REACTION_OBJECT = 'sys_comment_reaction';
/** The user table every stored user id must name a row of. */
const USER_OBJECT = 'sys_user';

/** System-elevated reads of the reaction rows already stored. */
const SYSTEM_READ_CTX = { isSystem: true };
/** The conversion's writes. See "The writes are bookkeeping" above. */
const CONVERSION_WRITE_CTX = { isSystem: true, skipAutomations: true };

/** Comments per page of the walk; also the width of each batched reaction read. */
const DEFAULT_PAGE_SIZE = 200;
/** Ids per `sys_user` read. */
const USER_READ_BATCH = 500;
/** How much of a stored value the report quotes. The column keeps the whole value. */
const QUOTE_LIMIT = 200;

/** Why a stored value, or one entry of it, converted into nothing. */
export type UnreadableReactionReason =
  /** A string that does not parse as JSON. */
  | 'not_json'
  /** It parses, but not as a map of emoji to user ids. */
  | 'not_a_map'
  /** An emoji's value is not a list. */
  | 'not_a_user_list'
  /** An entry of an emoji's list is not a user id (a non-empty string). */
  | 'not_a_user_id'
  /** The emoji is empty, or longer than `sys_comment_reaction.emoji` holds. */
  | 'emoji_not_storable'
  /** The user id names no `sys_user` row. */
  | 'unknown_user';

/** One stored value, or one entry of it, the conversion could not read. */
export interface UnreadableReaction {
  commentId: string;
  reason: UnreadableReactionReason;
  /** The emoji the entry sits under, once the map itself has read. */
  emoji?: string;
  /** What was stored — the whole value or the offending entry — JSON-encoded, quoted up to 200 characters. */
  stored: string;
}

/** One reaction the conversion read and could not write. */
export interface ReactionWriteFailure {
  commentId: string;
  emoji: string;
  userId: string;
  error: string;
  code?: string;
}

/** What one walk of the column found, and on `apply` what it wrote. */
export interface CommentReactionsConversionReport {
  apply: boolean;
  /** `sys_comment` rows read. */
  scannedComments: number;
  /** Of those, the rows whose stored value is not empty. */
  commentsWithReactions: number;
  /** Distinct readable (comment, emoji, user) reactions in the column. */
  storedReactions: number;
  /** Of those, the ones a `sys_comment_reaction` row already holds. */
  alreadyConverted: number;
  /** The rest: written on `apply`, to write on a dry run. */
  converted: number;
  /** A user id listed twice under one emoji of one comment: one reaction, one row. */
  collapsedDuplicates: number;
  unreadable: UnreadableReaction[];
  failures: ReactionWriteFailure[];
}

/** The driver read the walk issues: `find` only. */
interface ReadDriver {
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
}

/** The engine surface the conversion needs. */
export interface CommentReactionsEngine {
  getObject(name: string): unknown;
  getDriverForObject(name: string): ReadDriver | undefined;
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface ConvertCommentReactionsOptions {
  apply: boolean;
  /**
   * Answers a read of a table the read-only boot measured absent with no rows,
   * without issuing it (`absentTableReads(…).rows`). Every read is issued when
   * omitted.
   */
  rows?: <T>(object: string, read: () => Promise<T[]>) => Promise<T[]>;
  pageSize?: number;
}

type Row = Record<string, unknown>;

/** A stored value read as its readable reactions and the entries that did not read. */
interface ParsedValue {
  /** Distinct emoji → distinct user ids. */
  reactions: Map<string, Set<string>>;
  unreadable: Array<Omit<UnreadableReaction, 'commentId'>>;
  collapsedDuplicates: number;
  /** Was anything stored at all? */
  stored: boolean;
}

const quote = (value: unknown): string => {
  let text: string;
  try {
    text = typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
  } catch {
    text = String(value);
  }
  return text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT)}…` : text;
};

const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Read one stored `sys_comment.reactions` value.
 *
 * `null`, `undefined`, the empty string and a stored JSON `null` hold no
 * reaction. A string is parsed as JSON; a value a driver already decoded is
 * taken as it is. `emojiMaxLength` is the reaction object's own declared bound,
 * read from the registry by the caller, never a copy of it.
 */
export function parseStoredReactions(raw: unknown, emojiMaxLength?: number): ParsedValue {
  const out: ParsedValue = { reactions: new Map(), unreadable: [], collapsedDuplicates: 0, stored: false };
  if (raw === null || raw === undefined || raw === '') return out;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      out.stored = true;
      out.unreadable.push({ reason: 'not_json', stored: quote(raw) });
      return out;
    }
  }
  if (value === null) return out;
  out.stored = true;
  if (!isPlainMap(value)) {
    out.unreadable.push({ reason: 'not_a_map', stored: quote(raw) });
    return out;
  }
  for (const [emoji, ids] of Object.entries(value)) {
    if (emoji === '' || (typeof emojiMaxLength === 'number' && emoji.length > emojiMaxLength)) {
      out.unreadable.push({ reason: 'emoji_not_storable', emoji, stored: quote({ [emoji]: ids }) });
      continue;
    }
    if (!Array.isArray(ids)) {
      out.unreadable.push({ reason: 'not_a_user_list', emoji, stored: quote(ids) });
      continue;
    }
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') {
        out.unreadable.push({ reason: 'not_a_user_id', emoji, stored: quote(id) });
        continue;
      }
      let users = out.reactions.get(emoji);
      if (!users) {
        users = new Set();
        out.reactions.set(emoji, users);
      }
      if (users.has(id)) out.collapsedDuplicates += 1;
      else users.add(id);
    }
  }
  return out;
}

const reactionKey = (commentId: string, emoji: string, userId: string): string =>
  JSON.stringify([commentId, emoji, userId]);

const asRows = (result: unknown): Row[] => (Array.isArray(result) ? (result as Row[]) : []);

/** The registered `maxLength` of `sys_comment_reaction.emoji`, when it declares one. */
function emojiBound(engine: CommentReactionsEngine): number | undefined {
  const schema = engine.getObject(COMMENT_REACTION_OBJECT) as { fields?: Record<string, { maxLength?: unknown }> } | undefined;
  const bound = schema?.fields?.emoji?.maxLength;
  return typeof bound === 'number' ? bound : undefined;
}

function driverFor(engine: CommentReactionsEngine, object: string): ReadDriver {
  const driver = engine.getDriverForObject(object);
  // No driver is not an empty table: refused, never read as "nothing stored".
  if (!driver || typeof driver.find !== 'function') throw new Error(`no driver serves ${object} on this stack`);
  return driver;
}

/** The subset of `ids` that name a `sys_user` row. */
async function existingUsers(engine: CommentReactionsEngine, ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (ids.length === 0) return found;
  const driver = driverFor(engine, USER_OBJECT);
  for (let i = 0; i < ids.length; i += USER_READ_BATCH) {
    const batch = ids.slice(i, i + USER_READ_BATCH);
    const rows = asRows(await driver.find(USER_OBJECT, { fields: ['id'], where: { id: { $in: batch } } }));
    for (const row of rows) if (row.id != null) found.add(String(row.id));
  }
  return found;
}

/**
 * Walk every `sys_comment` row, read its stored reactions, and — on `apply` —
 * write each one not yet held by a `sys_comment_reaction` row.
 *
 * Every write failure is caught and reported per reaction, so one refused
 * insert never hides the rest of the walk; the caller decides what a failure
 * means for its exit status. A refused READ is not caught: an unread page is
 * not an empty one.
 */
export async function convertStoredCommentReactions(
  engine: CommentReactionsEngine,
  options: ConvertCommentReactionsOptions,
): Promise<CommentReactionsConversionReport> {
  const { apply } = options;
  const rows = options.rows ?? (<T>(_object: string, read: () => Promise<T[]>) => read());
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const emojiMaxLength = emojiBound(engine);
  const report: CommentReactionsConversionReport = {
    apply,
    scannedComments: 0,
    commentsWithReactions: 0,
    storedReactions: 0,
    alreadyConverted: 0,
    converted: 0,
    collapsedDuplicates: 0,
    unreadable: [],
    failures: [],
  };

  const commentDriver = driverFor(engine, COMMENT_OBJECT);
  let after: string | undefined;
  for (;;) {
    // Keyset paging on the primary key: a page is the next `pageSize` ids, so a
    // reaction row written mid-walk can never shift a comment out of the walk.
    // ⛔ No WHERE on the retired column: a database whose column is already
    // gone answers a projection of it by dropping the projection, and a filter
    // on it with a refusal.
    const page = await rows<Row>(COMMENT_OBJECT, async () => asRows(await commentDriver.find(COMMENT_OBJECT, {
      fields: ['id', 'organization_id', REACTIONS_COLUMN],
      ...(after !== undefined ? { where: { id: { $gt: after } } } : {}),
      orderBy: [{ field: 'id', order: 'asc' }],
      limit: pageSize,
    })));
    if (page.length === 0) break;
    after = String(page[page.length - 1].id);
    report.scannedComments += page.length;

    // Read the page: readable reactions per comment, and what did not read.
    const pending: Array<{ commentId: string; organizationId: unknown; emoji: string; userId: string }> = [];
    for (const row of page) {
      const commentId = String(row.id);
      const parsed = parseStoredReactions(row[REACTIONS_COLUMN], emojiMaxLength);
      if (!parsed.stored) continue;
      report.commentsWithReactions += 1;
      report.collapsedDuplicates += parsed.collapsedDuplicates;
      for (const entry of parsed.unreadable) report.unreadable.push({ commentId, ...entry });
      for (const [emoji, users] of parsed.reactions) {
        for (const userId of users) pending.push({ commentId, organizationId: row.organization_id, emoji, userId });
      }
    }
    if (pending.length > 0) {
      // A user id that names nobody converts into nothing.
      const known = await existingUsers(engine, [...new Set(pending.map((p) => p.userId))]);
      // The reactions already stored for this page's comments: the idempotency guard.
      const commentIds = [...new Set(pending.map((p) => p.commentId))];
      const held = new Set<string>();
      const stored = await rows<Row>(COMMENT_REACTION_OBJECT, async () => asRows(await engine.find(COMMENT_REACTION_OBJECT, {
        where: { comment_id: { $in: commentIds } },
        fields: ['comment_id', 'emoji', 'user_id'],
        context: { ...SYSTEM_READ_CTX },
      })));
      for (const r of stored) held.add(reactionKey(String(r.comment_id), String(r.emoji), String(r.user_id)));

      for (const p of pending) {
        if (!known.has(p.userId)) {
          report.unreadable.push({ commentId: p.commentId, reason: 'unknown_user', emoji: p.emoji, stored: quote(p.userId) });
          continue;
        }
        report.storedReactions += 1;
        if (held.has(reactionKey(p.commentId, p.emoji, p.userId))) {
          report.alreadyConverted += 1;
          continue;
        }
        if (!apply) {
          report.converted += 1;
          continue;
        }
        try {
          await engine.insert(
            COMMENT_REACTION_OBJECT,
            {
              comment_id: p.commentId,
              emoji: p.emoji,
              user_id: p.userId,
              created_by: p.userId,
              ...(p.organizationId != null && p.organizationId !== '' ? { organization_id: p.organizationId } : {}),
            },
            { context: { ...CONVERSION_WRITE_CTX } },
          );
          report.converted += 1;
        } catch (error: any) {
          report.failures.push({
            commentId: p.commentId,
            emoji: p.emoji,
            userId: p.userId,
            error: error?.message ?? String(error),
            ...(typeof error?.code === 'string' ? { code: error.code } : {}),
          });
        }
      }
    }
    if (page.length < pageSize) break;
  }
  return report;
}

/**
 * Did an `--apply` run convert everything, as its own read-back measured?
 * `check` is a dry walk taken after the writes: nothing left to convert,
 * nothing unreadable, and the writing run itself failed nothing.
 */
export function conversionVerified(
  applied: CommentReactionsConversionReport,
  check: CommentReactionsConversionReport,
): boolean {
  return applied.failures.length === 0 && check.converted === 0 && check.unreadable.length === 0
    && check.failures.length === 0;
}

/** The blocking count the ledger row records: everything that keeps the column from being dropped. */
export function conversionBlocking(
  applied: CommentReactionsConversionReport,
  check: CommentReactionsConversionReport,
): number {
  return applied.failures.length + check.converted + check.unreadable.length;
}

/** Record an `--apply` run's verdict in `sys_migration`. */
export async function recordCommentReactionsConversion(
  engine: MigrationFlagEngine,
  applied: CommentReactionsConversionReport,
  check: CommentReactionsConversionReport,
): Promise<DataMigrationFlag> {
  const { recordDataMigrationRun } = await import('@objectstack/platform-objects/system');
  return recordDataMigrationRun(engine, {
    migrationId: COMMENT_REACTIONS_MIGRATION_ID,
    passed: conversionVerified(applied, check),
    blocking: conversionBlocking(applied, check),
    advisory: 0,
    applied: true,
    details: {
      scannedComments: check.scannedComments,
      commentsWithReactions: check.commentsWithReactions,
      storedReactions: check.storedReactions,
      convertedThisRun: applied.converted,
      unconverted: check.converted,
      unreadable: check.unreadable.length,
      failures: applied.failures.length,
    },
  });
}

/**
 * The question `os migrate apply` asks before it drops `sys_comment.reactions`:
 * is a verified conversion recorded on this database? Fails toward retention —
 * no `sys_migration` object, no row, an unreadable row or an unverified one all
 * answer `verified: false`.
 */
export async function readCommentReactionsConversion(
  engine: MigrationFlagEngine,
): Promise<{ verified: boolean; flag: DataMigrationFlag | null }> {
  const { readDataMigrationFlag } = await import('@objectstack/platform-objects/system');
  const { isDataMigrationFlagVerified } = await import('@objectstack/spec/system');
  const flag = await readDataMigrationFlag(engine, COMMENT_REACTIONS_MIGRATION_ID);
  return { verified: isDataMigrationFlagVerified(flag), flag };
}
