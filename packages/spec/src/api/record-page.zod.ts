// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { ExplainDecisionSchema } from '../security/explain.zod';
import { GetRecordFieldAccessResponseSchema } from './protocol.zod';

/**
 * Record page payload — `POST /api/v1/data/{object}/{id}/page`.
 *
 * One request that answers everything a record page asks of the server when it
 * opens: the record (with the lookups it names resolved), the count and first
 * rows of every related list the page draws (with the lookups of those rows it
 * names resolved), the caller's field projection of the record, the approval
 * state that locks it, the record-grained access verdicts its header actions
 * are gated on, and the record's own streams the page draws — its discussion,
 * its activity feed and its attachments.
 *
 * The request NAMES the parts. Which related lists a page draws (their order,
 * their declared scope, which of them the reader may see) is the page's own
 * derivation, so the page sends the lists and the server answers each one; the
 * server never derives a list of its own. What the server owns is the parent
 * condition: each list is the child records whose `field` points at this
 * record, compiled to the field's arity, and AND-composed with the list's
 * declared `filter` — a declared filter can only narrow it.
 *
 * Every part is the answer of the read it replaces, asked as the same caller:
 * the record is `GET /data/{object}/{id}`, a related list is
 * `GET /data/{child}` with that filter, `$count` and the `$expand` it names,
 * `fieldAccess` is `GET /data/{object}/{id}/field-access`, `explain` is
 * `POST /security/explain` with the record id, `approvals` is
 * `GET /approvals/requests` for the record plus
 * `GET /approvals/records/{object}/{id}/lock`, `discussion` is
 * `GET /data/sys_comment` for the record's thread plus
 * `GET /data/sys_comment_reaction` for those comments, `activity` is
 * `GET /data/sys_activity` for the record with its actor expanded, and
 * `attachments` is `GET /data/sys_attachment` for the record with `$count`.
 * The three stream parts are each that read exactly as the table on
 * `RecordPageActivityRequestSchema` spells it: the route composes the record's
 * scope and the order, and the request names only whether a stream is wanted
 * and how many rows. Paging further, posting, reacting and uploading keep
 * their own routes. Object permissions, row-level security, sharing and
 * field-level security therefore apply exactly as they apply to those reads.
 * A part whose read refuses carries that refusal in place of an answer — a
 * related list the caller may not read carries neither a count nor rows — and
 * the other parts are answered. A record the caller
 * cannot read refuses the whole request with the record read's own answer, so
 * no part discloses a record the caller could not open.
 */

/** The most related lists one request may name. */
export const RECORD_PAGE_MAX_RELATED = 50;
/** The most rows one related list may ask for. */
export const RECORD_PAGE_MAX_RELATED_ROWS = 50;
/** The most sort keys one related list may order its rows by. */
export const RECORD_PAGE_MAX_RELATED_SORT = 8;
/**
 * The most activity rows the `activity` part may ask for: the window the
 * console's record feed reads (`$top: 200`), which its count and its 动态 tab
 * are drawn from.
 */
export const RECORD_PAGE_MAX_ACTIVITY_ROWS = 200;
/** The most attachment rows the `attachments` part may ask for: the Attachments panel's window. */
export const RECORD_PAGE_MAX_ATTACHMENT_ROWS = 100;

/** The record-grained operations a record page's header asks about. */
export const RecordPageExplainOperationSchema = z.enum(['update', 'delete', 'transfer']);
export type RecordPageExplainOperation = z.input<typeof RecordPageExplainOperationSchema>;
export type RecordPageExplainOperationParsed = z.infer<typeof RecordPageExplainOperationSchema>;

/** One related list a record page draws. */
export const RecordPageRelatedRequestSchema = lazySchema(() => z.object({
  object: z.string().min(1).describe('The child object whose records the list shows.'),
  field: z.string().min(1).describe(
    'The relationship field on the child object that points at this record (a lookup or master-detail field '
    + 'referencing the page\'s object). The list is the child records whose field holds this record\'s id.',
  ),
  filter: z.unknown().optional().describe(
    'The list\'s own declared scope, in the filter syntax `GET /data/{object}` accepts. AND-composed with the '
    + 'parent condition, so it can only narrow the list. A filter that syntax refuses refuses the whole request '
    + '(a located 400 at `related.N.filter`) before anything is read.',
  ),
  top: z.number().int().min(0).max(RECORD_PAGE_MAX_RELATED_ROWS).describe(
    'How many of the list\'s first rows to return with its count; 0 returns the count alone.',
  ),
  sort: z.array(z.object({
    field: z.string().min(1).describe('A field of the child object.'),
    order: z.enum(['asc', 'desc']).describe('The direction.'),
  }).strict()).max(RECORD_PAGE_MAX_RELATED_SORT).optional().describe(
    'The order of the list\'s first rows, as `GET /data/{object}` orders them by `$orderby`. Absent for the default order.',
  ),
  expand: z.array(z.string().min(1)).optional().describe(
    'Lookup fields of the child object to resolve on the list\'s rows, as `GET /data/{object}?$expand=` resolves '
    + 'them: each named reference is answered with the referenced record the caller may read in place of its id, so '
    + 'the rows carry the display names the list draws. Absent: the rows carry the bare ids.',
  ),
}).strict());
export type RecordPageRelatedRequest = z.input<typeof RecordPageRelatedRequestSchema>;
export type RecordPageRelatedRequestParsed = z.infer<typeof RecordPageRelatedRequestSchema>;

/**
 * The record's own streams, each the read it replaces (the record is
 * `{object}` / `{id}` of the route):
 *
 * | part          | the read                                                                                       |
 * | ------------- | ---------------------------------------------------------------------------------------------- |
 * | `discussion`  | `sys_comment` where `thread_id` = `{object}:{id}` (the id the comment writer stores), by       |
 * |               | `created_at` asc, no page size (the whole thread, as the record feed reads it); then           |
 * |               | `sys_comment_reaction` where `comment_id` is among those comments, by `created_at` asc         |
 * | `activity`    | `sys_activity` where `object_name` = `{object}` and `record_id` = `{id}`, by `timestamp` desc, |
 * |               | `top` rows with `$count`, `actor_id` expanded                                                  |
 * | `attachments` | `sys_attachment` where `parent_object` = `{object}` and `parent_id` = `{id}`, by `created_at`  |
 * |               | desc, `top` rows with `$count`                                                                 |
 *
 * Each is asked of the data door as the caller, behind that object's own API
 * exposure gate, so a stream the caller may not read is that read's refusal.
 *
 * This schema is the `activity` part of a request: how many of the newest rows.
 */
export const RecordPageActivityRequestSchema = lazySchema(() => z.object({
  top: z.number().int().min(1).max(RECORD_PAGE_MAX_ACTIVITY_ROWS).describe(
    'How many of the record\'s newest activity rows to return with their count.',
  ),
}).strict());
export type RecordPageActivityRequest = z.input<typeof RecordPageActivityRequestSchema>;
export type RecordPageActivityRequestParsed = z.infer<typeof RecordPageActivityRequestSchema>;

/** The `attachments` part of a request: how many of the newest attachments. */
export const RecordPageAttachmentsRequestSchema = lazySchema(() => z.object({
  top: z.number().int().min(0).max(RECORD_PAGE_MAX_ATTACHMENT_ROWS).describe(
    'How many of the record\'s newest attachments to return with their count; 0 returns the count alone.',
  ),
}).strict());
export type RecordPageAttachmentsRequest = z.input<typeof RecordPageAttachmentsRequestSchema>;
export type RecordPageAttachmentsRequestParsed = z.infer<typeof RecordPageAttachmentsRequestSchema>;

/** The request body of `POST /data/{object}/{id}/page`. */
export const RecordPageRequestSchema = lazySchema(() => z.object({
  expand: z.array(z.string().min(1)).optional().describe(
    'Lookup fields of the record to resolve, as `GET /data/{object}/{id}?expand=` resolves them.',
  ),
  related: z.array(RecordPageRelatedRequestSchema).max(RECORD_PAGE_MAX_RELATED).optional().describe(
    'The related lists the page draws, in the order it draws them. Each is answered with its count and first rows.',
  ),
  explain: z.array(RecordPageExplainOperationSchema).optional().describe(
    'The operations to answer a record-grained access verdict for, as `POST /security/explain` answers them '
    + 'with this record id.',
  ),
  fieldAccess: z.boolean().optional().describe(
    'Return the caller\'s field projection of the record, as `GET /data/{object}/{id}/field-access` does.',
  ),
  approvals: z.boolean().optional().describe(
    'Return the record\'s approval requests and its approval lock.',
  ),
  discussion: z.boolean().optional().describe(
    'Return the record\'s discussion: its comment thread and those comments\' reactions (`RecordPageDiscussionSchema`).',
  ),
  activity: RecordPageActivityRequestSchema.optional().describe(
    'Return the record\'s newest activity rows and their count (`RecordPageStreamRowsSchema`).',
  ),
  attachments: RecordPageAttachmentsRequestSchema.optional().describe(
    'Return the record\'s newest attachments and their count (`RecordPageStreamRowsSchema`).',
  ),
}).strict());
export type RecordPageRequest = z.input<typeof RecordPageRequestSchema>;
export type RecordPageRequestParsed = z.infer<typeof RecordPageRequestSchema>;

/** The refusal a replaced read answers: its code, status and message. */
export const RecordPagePartRefusalSchema = lazySchema(() => z.object({
  code: z.string().describe('The error code the replaced read answers.'),
  status: z.number().int().describe('The HTTP status the replaced read answers.'),
  message: z.string().describe('The message the replaced read answers.'),
}));
export type RecordPagePartRefusal = z.input<typeof RecordPagePartRefusalSchema>;
export type RecordPagePartRefusalParsed = z.infer<typeof RecordPagePartRefusalSchema>;

/** A part whose read refused, carried in place of that part's answer. */
export const RecordPagePartErrorSchema = lazySchema(() => z.object({
  error: RecordPagePartRefusalSchema.describe('The refusal the replaced read answers, in place of this part\'s answer.'),
}));
export type RecordPagePartError = z.input<typeof RecordPagePartErrorSchema>;
export type RecordPagePartErrorParsed = z.infer<typeof RecordPagePartErrorSchema>;

/** A related list the caller may read: its count and first rows. */
export const RecordPageRelatedRowsSchema = lazySchema(() => z.object({
  object: z.string().describe('The child object, as the request named it.'),
  field: z.string().describe('The relationship field, as the request named it.'),
  total: z.number().int().describe('How many child records the list holds for this caller.'),
  records: z.array(z.record(z.string(), z.unknown())).describe('The list\'s first rows, as the caller may read them.'),
}).strict());
export type RecordPageRelatedRows = z.input<typeof RecordPageRelatedRowsSchema>;
export type RecordPageRelatedRowsParsed = z.infer<typeof RecordPageRelatedRowsSchema>;

/** A related list whose read refused: the refusal, and neither a count nor rows. */
export const RecordPageRelatedRefusalSchema = lazySchema(() => z.object({
  object: z.string().describe('The child object, as the request named it.'),
  field: z.string().describe('The relationship field, as the request named it.'),
  error: RecordPagePartRefusalSchema.describe('The refusal of the list\'s read.'),
}).strict());
export type RecordPageRelatedRefusal = z.input<typeof RecordPageRelatedRefusalSchema>;
export type RecordPageRelatedRefusalParsed = z.infer<typeof RecordPageRelatedRefusalSchema>;

/**
 * One related list's answer, in the order the request named the lists: its
 * count and rows, or its refusal. Never both, and never neither, so a refused
 * list cannot be read as an empty one.
 */
export const RecordPageRelatedAnswerSchema = lazySchema(() => z.union([RecordPageRelatedRowsSchema, RecordPageRelatedRefusalSchema]));
export type RecordPageRelatedAnswer = z.input<typeof RecordPageRelatedAnswerSchema>;
export type RecordPageRelatedAnswerParsed = z.infer<typeof RecordPageRelatedAnswerSchema>;

/** The approval part: the record's requests and its lock. */
export const RecordPageApprovalsSchema = lazySchema(() => z.object({
  requests: z.array(z.record(z.string(), z.unknown())).describe(
    'The record\'s approval requests the caller may see, as `GET /approvals/requests` lists them for the record; '
    + 'empty when the deployment runs no approval service.',
  ),
  lock: z.object({ locked: z.boolean() }).nullable().describe(
    'Whether a locking approval holds the record; null when the deployment answers no lock.',
  ),
}));
export type RecordPageApprovals = z.input<typeof RecordPageApprovalsSchema>;
export type RecordPageApprovalsParsed = z.infer<typeof RecordPageApprovalsSchema>;

/**
 * A stream part whose read refused: the refusal alone, so a refused stream
 * cannot be read as an empty one and an answered one carries no refusal.
 */
export const RecordPageStreamRefusalSchema = lazySchema(() => z.object({
  error: RecordPagePartRefusalSchema.describe('The refusal the replaced read answers, in place of this part\'s answer.'),
}).strict());
export type RecordPageStreamRefusal = z.input<typeof RecordPageStreamRefusalSchema>;
export type RecordPageStreamRefusalParsed = z.infer<typeof RecordPageStreamRefusalSchema>;

/** A stream's newest rows and how many it holds: the `activity` and `attachments` parts. */
export const RecordPageStreamRowsSchema = lazySchema(() => z.object({
  total: z.number().int().describe('How many rows the stream holds for this caller.'),
  records: z.array(z.record(z.string(), z.unknown())).describe('The stream\'s newest rows, as the caller may read them.'),
}).strict());
export type RecordPageStreamRows = z.input<typeof RecordPageStreamRowsSchema>;
export type RecordPageStreamRowsParsed = z.infer<typeof RecordPageStreamRowsSchema>;

/** The reactions of the discussion's comments: their rows, or the refusal of their read. */
export const RecordPageDiscussionReactionsSchema = lazySchema(() => z.union([
  z.object({
    records: z.array(z.record(z.string(), z.unknown())).describe(
      'The `sys_comment_reaction` rows of the thread\'s comments, oldest first; empty for a thread with no comment.',
    ),
  }).strict(),
  RecordPageStreamRefusalSchema,
]));
export type RecordPageDiscussionReactions = z.input<typeof RecordPageDiscussionReactionsSchema>;
export type RecordPageDiscussionReactionsParsed = z.infer<typeof RecordPageDiscussionReactionsSchema>;

/**
 * The discussion part: the record's comment thread and its reactions. The
 * reactions are a part of their own: their refusal (a deployment without
 * `sys_comment_reaction` answers its 404) leaves the comments answered.
 */
export const RecordPageDiscussionSchema = lazySchema(() => z.object({
  comments: z.array(z.record(z.string(), z.unknown())).describe('The thread\'s comments, oldest first, as the caller may read them.'),
  reactions: RecordPageDiscussionReactionsSchema.describe('The reactions of those comments, or the refusal of their read.'),
}).strict());
export type RecordPageDiscussion = z.input<typeof RecordPageDiscussionSchema>;
export type RecordPageDiscussionParsed = z.infer<typeof RecordPageDiscussionSchema>;

/** One requested operation's access decision, or the refusal of the explain read. */
export const RecordPageExplainAnswerSchema = lazySchema(() => z.union([ExplainDecisionSchema, RecordPagePartErrorSchema]));
export type RecordPageExplainAnswer = z.input<typeof RecordPageExplainAnswerSchema>;
export type RecordPageExplainAnswerParsed = z.infer<typeof RecordPageExplainAnswerSchema>;

/**
 * The explain part's keys are the request enum's own options, so an operation
 * the request admits is always one the answer can carry.
 */
const explainAnswerShape = () => Object.fromEntries(
  RecordPageExplainOperationSchema.options.map((operation) => [operation, RecordPageExplainAnswerSchema.optional()]),
) as { [K in z.infer<typeof RecordPageExplainOperationSchema>]: z.ZodOptional<typeof RecordPageExplainAnswerSchema> };

/** The `data` of the answer to `POST /data/{object}/{id}/page`. */
export const RecordPageResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The record\'s object.'),
  id: z.string().describe('The record id.'),
  record: z.record(z.string(), z.unknown()).describe('The record, as `GET /data/{object}/{id}` answers it.'),
  related: z.array(RecordPageRelatedAnswerSchema).describe('One answer per requested related list, in request order.'),
  fieldAccess: z.union([GetRecordFieldAccessResponseSchema, RecordPagePartErrorSchema]).optional().describe(
    'The field projection, when the request asked for it.',
  ),
  explain: z.object(explainAnswerShape()).optional().describe('One access decision per requested operation, keyed by operation, when the request asked for any.'),
  approvals: z.union([RecordPageApprovalsSchema, RecordPagePartErrorSchema]).optional().describe(
    'The approval part, when the request asked for it.',
  ),
  discussion: z.union([RecordPageDiscussionSchema, RecordPageStreamRefusalSchema]).optional().describe(
    'The discussion part, when the request asked for it: the thread and its reactions, or the refusal of the comment read.',
  ),
  activity: z.union([RecordPageStreamRowsSchema, RecordPageStreamRefusalSchema]).optional().describe(
    'The activity part, when the request asked for it: the newest rows and their count, or the refusal of their read.',
  ),
  attachments: z.union([RecordPageStreamRowsSchema, RecordPageStreamRefusalSchema]).optional().describe(
    'The attachments part, when the request asked for it: the newest rows and their count, or the refusal of their read.',
  ),
}));
export type RecordPageResponse = z.input<typeof RecordPageResponseSchema>;
export type RecordPageResponseParsed = z.infer<typeof RecordPageResponseSchema>;
