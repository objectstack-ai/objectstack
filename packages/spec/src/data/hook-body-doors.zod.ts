// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { requiredOneOf } from '../shared/refinement-projection';

/**
 * The two platform doors a sandboxed script body (a hook, action or job body)
 * reaches for records it may not write itself: mail goes through the mail
 * service, and a timeline entry goes through the activity door. A body asks for
 * each with its own capability token (`email.send`, `activity.append`,
 * {@link HookBodyCapability}), and calls it as `ctx.email.send(input)` /
 * `ctx.activity.append(input)`.
 *
 * Each input below is what the BODY may say. What the platform says about the
 * message or the entry is stamped by the door and is not an input: the sender,
 * the user the mail is sent by, the organization it belongs to, the actor of a
 * timeline entry and the origin naming the body that wrote it. A key outside
 * the shape is refused, never dropped, so a body that names one of those is
 * told at the call.
 *
 * A message cannot be taken back, so mail is sent from an action or a job
 * body, never from a hook body; mail on a record change goes through an
 * action, a job or a flow. A timeline entry is written with the write that
 * runs the body, and commits or rolls back with it.
 */

/** The most recipients one `ctx.email.send` call may name, across `to`, `cc` and `bcc`. */
export const BODY_MAIL_RECIPIENT_LIMIT = 50;

/**
 * The most characters each of `to`, `cc` and `bcc` may take as the mail log
 * records it: every recipient as `"Name" <address>` (or the bare address),
 * joined by `", "`. The log's address columns hold this many.
 */
export const BODY_MAIL_ADDRESS_LIST_LIMIT = 4000;

/** The most characters an address may have, and a `replyTo` as recorded (`"Name" <address>`). */
export const BODY_MAIL_ADDRESS_LIMIT = 320;

/** The most characters `ctx.activity.append`'s `metadata` may take, written as JSON. */
export const BODY_ACTIVITY_METADATA_LIMIT = 8000;

/**
 * One recipient: a bare address, or a display name with an address. The same
 * two forms `SendEmailInput` takes (`@objectstack/spec/contracts`).
 */
const BodyMailAddressSchema = z.union([
  z.string().min(1).max(BODY_MAIL_ADDRESS_LIMIT),
  z
    .object({
      name: z.string().max(200).optional(),
      address: z.string().min(1).max(BODY_MAIL_ADDRESS_LIMIT),
    })
    .strict(),
]);

const BodyMailAddressesSchema = z.union([
  BodyMailAddressSchema,
  z.array(BodyMailAddressSchema).min(1).max(BODY_MAIL_RECIPIENT_LIMIT),
]);

/**
 * A record the body points at, by object name and record id. The door reads it
 * in the caller's scope before it acts, and refuses one the caller cannot read
 * with the answer it gives one that does not exist.
 */
export const BodyDoorRecordRefSchema = z
  .object({
    object: z.string().min(1).max(100).describe('Object name of the record'),
    id: z.string().min(1).max(100).describe('Record id'),
  })
  .strict()
  .describe('A record the door reads in the caller\'s scope before it acts');
export type BodyDoorRecordRef = z.input<typeof BodyDoorRecordRefSchema>;

/**
 * `ctx.email.send(input)` — a message an action or a job body hands to the
 * mail service. A hook body cannot send mail.
 *
 * The sender is the deployment's configured sender, and the door names the
 * calling user beside the organization in its display name; a reply goes to
 * `replyTo`. The message is recorded as sent by the calling user and under the
 * caller's organization. At least one of `text` or `html`.
 *
 * Two limits read across fields, which a JSON Schema cannot state exactly, so
 * the schema's description states them and the door holds them: at most
 * {@link BODY_MAIL_RECIPIENT_LIMIT} recipients across `to`, `cc` and `bcc`
 * together (each slot alone is held to that number here), and each of the
 * three at most {@link BODY_MAIL_ADDRESS_LIST_LIMIT} characters as the mail log
 * records it; a `replyTo` as recorded is at most
 * {@link BODY_MAIL_ADDRESS_LIMIT}.
 */
export const BodyMailSendInputSchema = z
  .object({
    to: BodyMailAddressesSchema.describe('Recipient address, or a list of them'),
    cc: BodyMailAddressesSchema.optional().describe('Carbon-copy recipients'),
    bcc: BodyMailAddressesSchema.optional().describe('Blind carbon-copy recipients'),
    replyTo: BodyMailAddressSchema.optional().describe('Reply-To address; the sender itself is the configured one'),
    subject: z.string().min(1).max(998).describe('Subject line'),
    text: z.string().max(1_000_000).optional().describe('Plain-text body'),
    html: z.string().max(1_000_000).optional().describe('HTML body'),
    related: BodyDoorRecordRefSchema.optional().describe('The record the message is about'),
  })
  .strict()
  .refine(requiredOneOf(['text', 'html']), {
    message: 'A message needs a body: give `text`, `html`, or both.',
    path: ['text'],
  })
  .describe(
    'ctx.email.send input: a message an action or a job body hands to the mail service; a hook body cannot send mail. ' +
      `At most ${BODY_MAIL_RECIPIENT_LIMIT} recipients across to, cc and bcc together; ` +
      `each of to, cc and bcc at most ${BODY_MAIL_ADDRESS_LIST_LIMIT} characters as recorded ` +
      '("Name" <address>, joined by ", "); ' +
      `a replyTo at most ${BODY_MAIL_ADDRESS_LIMIT} characters as recorded.`,
  );
export type BodyMailSendInput = z.input<typeof BodyMailSendInputSchema>;

/**
 * `ctx.activity.append(input)` — one entry a body adds to a record's activity
 * timeline. The entry commits or rolls back with the write that runs the body.
 *
 * The door stamps the actor (the calling user), the organization, the time and
 * the origin (the package and the body that wrote it). `type` is the open
 * timeline vocabulary less the values only the platform records
 * (`SYS_ACTIVITY_PLATFORM_TYPES`); the record, and `source` when given, must be
 * readable by the caller. `metadata` is a plain object the timeline stores
 * beside the entry, at most {@link BODY_ACTIVITY_METADATA_LIMIT} characters as
 * JSON (a limit the door holds, stated in the description), and may not use the
 * keys the platform's own entries carry.
 */
export const BodyActivityAppendInputSchema = z
  .object({
    object: z.string().min(1).max(255).describe('Object name of the record the entry is about'),
    recordId: z.string().min(1).max(255).describe('Id of the record the entry is about'),
    type: z.string().min(1).max(100).describe('Activity kind, from the open vocabulary less the platform-only values'),
    summary: z.string().min(1).max(500).describe('One-line summary'),
    recordLabel: z.string().max(255).optional().describe('Display label of the record, as of the entry'),
    source: BodyDoorRecordRefSchema.optional().describe('The record the entry points at for its detail'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(`Display hints stored beside the entry, at most ${BODY_ACTIVITY_METADATA_LIMIT} characters as JSON`),
  })
  .strict()
  .describe(
    'ctx.activity.append input: one entry a script body adds to a record timeline; it commits or rolls back with the write that runs the body. ' +
      `metadata is at most ${BODY_ACTIVITY_METADATA_LIMIT} characters as JSON.`,
  );
export type BodyActivityAppendInput = z.input<typeof BodyActivityAppendInputSchema>;
