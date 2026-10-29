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
 * rows of every related list the page draws, the caller's field projection of
 * the record, the approval state that locks it, and the record-grained access
 * verdicts its header actions are gated on.
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
 * `GET /data/{child}` with that filter and `$count`, `fieldAccess` is
 * `GET /data/{object}/{id}/field-access`, `explain` is
 * `POST /security/explain` with the record id, and `approvals` is
 * `GET /approvals/requests` for the record plus
 * `GET /approvals/records/{object}/{id}/lock`. Object permissions, row-level
 * security, sharing and field-level security therefore apply exactly as they
 * apply to those reads. A part whose read refuses carries that refusal in place
 * of an answer — a related list the caller may not read carries neither a
 * count nor rows — and the other parts are answered. A record the caller
 * cannot read refuses the whole request with the record read's own answer, so
 * no part discloses a record the caller could not open.
 */

/** The most related lists one request may name. */
export const RECORD_PAGE_MAX_RELATED = 50;
/** The most rows one related list may ask for. */
export const RECORD_PAGE_MAX_RELATED_ROWS = 50;
/** The most sort keys one related list may order its rows by. */
export const RECORD_PAGE_MAX_RELATED_SORT = 8;

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
    + 'parent condition, so it can only narrow the list.',
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
}).strict());
export type RecordPageRelatedRequest = z.input<typeof RecordPageRelatedRequestSchema>;
export type RecordPageRelatedRequestParsed = z.infer<typeof RecordPageRelatedRequestSchema>;

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

/** One related list's answer, in the order the request named the lists. */
export const RecordPageRelatedAnswerSchema = lazySchema(() => z.object({
  object: z.string().describe('The child object, as the request named it.'),
  field: z.string().describe('The relationship field, as the request named it.'),
  total: z.number().int().optional().describe('How many child records the list holds for this caller. Absent on a refused list.'),
  records: z.array(z.record(z.string(), z.unknown())).optional().describe(
    'The list\'s first rows, as the caller may read them. Absent on a refused list.',
  ),
  error: RecordPagePartRefusalSchema.optional().describe(
    'The refusal of the list\'s read. A refused list carries no count and no rows.',
  ),
}));
export type RecordPageRelatedAnswer = z.input<typeof RecordPageRelatedAnswerSchema>;
export type RecordPageRelatedAnswerParsed = z.infer<typeof RecordPageRelatedAnswerSchema>;

/** The approval part: the record's requests and its lock. */
export const RecordPageApprovalsSchema = lazySchema(() => z.object({
  requests: z.array(z.record(z.string(), z.unknown())).describe(
    'The record\'s approval requests the caller may see, as `GET /approvals/requests` lists them for the record.',
  ),
  lock: z.object({ locked: z.boolean() }).nullable().describe(
    'Whether a locking approval holds the record; null when the deployment answers no lock.',
  ),
}));
export type RecordPageApprovals = z.input<typeof RecordPageApprovalsSchema>;
export type RecordPageApprovalsParsed = z.infer<typeof RecordPageApprovalsSchema>;

/** One requested operation's access decision, or the refusal of the explain read. */
const RecordPageExplainAnswerSchema = lazySchema(() => z.union([ExplainDecisionSchema, RecordPagePartErrorSchema]));

/** The `data` of the answer to `POST /data/{object}/{id}/page`. */
export const RecordPageResponseSchema = lazySchema(() => z.object({
  object: z.string().describe('The record\'s object.'),
  id: z.string().describe('The record id.'),
  record: z.record(z.string(), z.unknown()).describe('The record, as `GET /data/{object}/{id}` answers it.'),
  related: z.array(RecordPageRelatedAnswerSchema).describe('One answer per requested related list, in request order.'),
  fieldAccess: z.union([GetRecordFieldAccessResponseSchema, RecordPagePartErrorSchema]).optional().describe(
    'The field projection, when the request asked for it.',
  ),
  explain: z.object({
    update: RecordPageExplainAnswerSchema.optional(),
    delete: RecordPageExplainAnswerSchema.optional(),
    transfer: RecordPageExplainAnswerSchema.optional(),
  }).optional().describe('One access decision per requested operation, keyed by operation, when the request asked for any.'),
  approvals: z.union([RecordPageApprovalsSchema, RecordPagePartErrorSchema]).optional().describe(
    'The approval part, when the request asked for it.',
  ),
}));
export type RecordPageResponse = z.input<typeof RecordPageResponseSchema>;
export type RecordPageResponseParsed = z.infer<typeof RecordPageResponseSchema>;
