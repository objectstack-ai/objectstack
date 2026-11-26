// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * A record citation — the passage of a record an answer rests on
 * (ADR-0160 D9, as amended a third time).
 *
 * One citation is `{ object, id, context?, anchor?, quote }`. It is the record
 * sibling of a dataset answer's `sourceLine` (`dataset-tools.zod.ts`), with one
 * difference: a dataset answer's provenance is composed by the tool, while a
 * citation is written by the model, so it is a claim. The shape lets the
 * platform check the claim without a model: `quote` must be found verbatim in
 * the data member of what `get_record_context` answers for `object`, `id`,
 * `context` and `anchor` to the asking user (`record-context-tools.zod.ts`,
 * `RecordContextDataSchema`).
 *
 * - `object`, `id` name the root record of the pack the statement was read
 *   through. A quote taken from a related row still names the root.
 * - `context` names that pack, spelt as `get_record_context`'s `context`
 *   argument takes it. It may be omitted when the object has one pack; on an
 *   object with several, a citation without it is not verified.
 * - `anchor` is a heading of the root record's body, as the body outline
 *   issued it (`record-body-anchor.ts`, `headingsOf`). Omitted when the
 *   citation is to the record as a whole or to a field.
 * - `quote` is the passage relied on, verbatim from text the tool returned.
 *
 * A citation is verified once, when the answer is produced, by the platform
 * as the asking user; one whose quote is not found, or whose verifying call is
 * refused, is dropped before the answer is shown. The verified list is
 * persisted with the message, and no surface re-verifies it on display. The
 * verifier is `@objectstack/service-record-context`'s `verifyRecordCitations`;
 * only the shapes are spec.
 *
 * The verified list rides an answer as a UI-message data part named
 * {@link RECORD_CITATIONS_PART_TYPE}, whose `data` is a
 * {@link RecordCitationsSchema} list.
 */

/**
 * The stream part name a verified citation list rides, as a UI-message-stream
 * custom data-part name (the precedent is `BUILD_PROGRESS_FRAME_TYPE`). The
 * producer and every surface that draws the list select the part by exactly
 * this string.
 */
export const RECORD_CITATIONS_PART_TYPE = 'data-record-citations';

/**
 * The most citations one answer carries. The verifier reads at most this many
 * from the list a model wrote, so a model's list cannot make the platform read
 * without bound; the same number bounds the persisted list.
 */
export const RECORD_CITATIONS_MAX = 20;

/** One citation: the root record, the pack, the body section, and the passage. */
export const RecordCitationSchema = lazySchema(() => strictObject(
  {
    surface: 'a record citation',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    // `get_record_context`'s own spellings, and the near-misses a model reaches for.
    aliases: {
      objectName: 'object',
      table: 'object',
      recordId: 'id',
      pack: 'context',
      contextName: 'context',
      section: 'anchor',
      text: 'quote',
      excerpt: 'quote',
      passage: 'quote',
    },
    guidance: {
      field: 'A citation names no field: quote the passage in `quote`, and it is found wherever the record\'s answer carries it.',
    },
  },
  {
    object: z.string().min(1).describe('The root record\'s object, as `get_record_context` was called with it'),
    id: z.string().min(1).describe('The root record\'s id'),
    context: z.string().min(1).optional().describe(
      'The context pack the record was read through, spelt as `get_record_context`\'s `context` argument takes it. '
      + 'Omit it only when the object has one pack',
    ),
    anchor: z.string().min(1).optional().describe(
      'A heading of the root record\'s body, by the `anchor` the body outline issued. Omit it when the citation is '
      + 'to the record as a whole or to a field',
    ),
    quote: z.string().min(1).describe('The passage relied on, verbatim from text the tool returned'),
  },
));

/** The citations of one answer, at most {@link RECORD_CITATIONS_MAX}. */
export const RecordCitationsSchema = lazySchema(() => z.array(RecordCitationSchema).max(RECORD_CITATIONS_MAX));

export type RecordCitation = z.input<typeof RecordCitationSchema>;
export type RecordCitationParsed = z.infer<typeof RecordCitationSchema>;
export type RecordCitations = z.input<typeof RecordCitationsSchema>;
export type RecordCitationsParsed = z.infer<typeof RecordCitationsSchema>;
