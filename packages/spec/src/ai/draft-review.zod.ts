// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { RuntimeAuthoringIssueSchema } from '../api/protocol.zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * The draft review list — the drafts one ask turn saved, as the console's chat
 * draws them in a card under the answer.
 *
 * ## Who writes it, who reads it
 *
 * - **Producer:** the host whose admin skill saves metadata drafts from an ask
 *   turn. At the end of a streamed turn that saved at least one draft, before
 *   the stream's `finish`, it sends one UI-message-stream data part named
 *   {@link DRAFT_REVIEW_PART_TYPE} whose `data` is a
 *   {@link DraftReviewListSchema} list, in save order.
 * - **Reader:** the console's chat (`extractDraftReview` in
 *   `@object-ui/plugin-chatbot`). It reads the part through this schema; a part
 *   the schema refuses draws no card, and the answer renders as it does
 *   without one.
 *
 * ## What each row states
 *
 * - `type`, `name`, `package` name the saved draft; `label` is its display
 *   label when the draft has one.
 * - `verdict` is the light authoring door's own `list_drafts` verdict on the
 *   draft — `publishable` is "no refusal", `refusals` are what a publish would
 *   refuse it on and `advisories` are findings that do not block it — read as
 *   the person who asked. `null` when no verdict was read: `verdictWithheld`
 *   then says why the person may not read one, or `verdictError` that reading
 *   it failed. Both carry the door's `{ code, message, status }`.
 * - `verdictRead` says when the verdict was read: `turn-end`, after the turn's
 *   last save, or `save`, by the save that wrote this draft (a later save in
 *   the same turn can change it).
 * - `review` holds the two Studio routes where a person reviews the draft, as
 *   the door hands them out (`studioChangesReviewLink`,
 *   `studioItemReviewLink` in `@objectstack/types`): `changes`, the package's
 *   Changes drawer, where it is published, and `item`, the draft's own review.
 *   Both are Console paths, so each starts with one `/`.
 *
 * ## What the card does not do
 *
 * Nothing is published or discarded from the chat: a person publishes in
 * Studio, through the review routes, as for any draft. The part is drawn live
 * only: it is not stored with the message, so a conversation reloaded from
 * history shows no card.
 */

/**
 * The stream part name the draft review list rides, as a UI-message-stream
 * custom data-part name (the precedent is `RECORD_CITATIONS_PART_TYPE`). The
 * producer and every surface that draws the list select the part by exactly
 * this string.
 */
export const DRAFT_REVIEW_PART_TYPE = 'data-draft-review';

/**
 * The most drafts one part lists. A turn that saved more lists the first this
 * many, in save order, and counts the rest in `omitted`.
 */
export const DRAFT_REVIEW_MAX = 50;

/** A Console path: one leading `/`, never `//` (which a browser reads as another host). */
const consolePath = (what: string) => z.string().regex(/^\/(?!\/)/).describe(what);

/** Why no verdict was read, as the door states it: its error code, sentence and HTTP status. */
export const DraftReviewVerdictRefusalSchema = lazySchema(() => strictObject(
  {
    surface: 'a draft review verdict refusal',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
  },
  {
    code: z.string().min(1).describe('The error code the door answered (`PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `INTERNAL_ERROR`, …)'),
    message: z.string().describe('The door\'s sentence for it'),
    status: z.number().int().describe('The HTTP status the door answered'),
  },
));

/** The door's publish verdict on one draft. */
export const DraftReviewVerdictSchema = lazySchema(() => strictObject(
  {
    surface: 'a draft review verdict',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
  },
  {
    publishable: z.boolean().describe('`true` when a publish would refuse the draft on nothing: `refusals` is empty'),
    refusals: z.array(RuntimeAuthoringIssueSchema).describe('What a publish would refuse the draft on'),
    advisories: z.array(RuntimeAuthoringIssueSchema).describe('Findings that do not block a publish'),
  },
));

/** The two Studio routes where a person reviews the draft. */
export const DraftReviewLinksSchema = lazySchema(() => strictObject(
  {
    surface: 'a draft review links block',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
  },
  {
    changes: consolePath('The package\'s Changes drawer in Studio, where its drafts are reviewed and published (`studioChangesReviewLink`)'),
    item: consolePath('The draft\'s own review in Studio (`studioItemReviewLink`)'),
  },
));

/** One saved draft. */
export const DraftReviewItemSchema = lazySchema(() => strictObject(
  {
    surface: 'a draft review row',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: {
      packageId: 'package',
      links: 'review',
    },
  },
  {
    type: z.string().min(1).describe('The metadata type of the draft, singular (`object`, `view`, `flow`, …)'),
    name: z.string().min(1).describe('The draft\'s machine name'),
    package: z.string().min(1).describe('The package the draft was saved into'),
    label: z.string().min(1).optional().describe('The draft\'s display label, when it has one'),
    verdict: DraftReviewVerdictSchema.nullable().describe(
      'The door\'s `list_drafts` verdict, read as the person who asked; `null` when none was read '
      + '(see `verdictWithheld` and `verdictError`)',
    ),
    verdictWithheld: DraftReviewVerdictRefusalSchema.optional().describe('Why the person may not read a verdict, when `verdict` is `null` for that reason'),
    verdictError: DraftReviewVerdictRefusalSchema.optional().describe('That reading the verdict failed, when `verdict` is `null` for that reason'),
    verdictRead: z.enum(['turn-end', 'save']).describe(
      'When the verdict was read: `turn-end`, after the turn\'s last save, or `save`, by the save that wrote this draft',
    ),
    review: DraftReviewLinksSchema,
  },
));

/** The drafts one ask turn saved, in save order. */
export const DraftReviewListSchema = lazySchema(() => strictObject(
  {
    surface: 'a draft review list',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: {
      items: 'drafts',
      more: 'omitted',
    },
  },
  {
    drafts: z.array(DraftReviewItemSchema).min(1).max(DRAFT_REVIEW_MAX).describe(
      `The saved drafts, in save order, at most ${DRAFT_REVIEW_MAX}`,
    ),
    omitted: z.number().int().min(1).optional().describe(
      `How many more drafts the turn saved beyond the ${DRAFT_REVIEW_MAX} listed; absent when none`,
    ),
  },
));

export type DraftReviewVerdictRefusal = z.input<typeof DraftReviewVerdictRefusalSchema>;
export type DraftReviewVerdict = z.input<typeof DraftReviewVerdictSchema>;
export type DraftReviewLinks = z.input<typeof DraftReviewLinksSchema>;
export type DraftReviewItem = z.input<typeof DraftReviewItemSchema>;
export type DraftReviewItemParsed = z.infer<typeof DraftReviewItemSchema>;
export type DraftReviewList = z.input<typeof DraftReviewListSchema>;
export type DraftReviewListParsed = z.infer<typeof DraftReviewListSchema>;
