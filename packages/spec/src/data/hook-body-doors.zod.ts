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
 */

/** The most recipients one `ctx.email.send` call may name, across `to`, `cc` and `bcc`. */
export const BODY_MAIL_RECIPIENT_LIMIT = 50;

/**
 * One recipient: a bare address, or a display name with an address. The same
 * two forms `SendEmailInput` takes (`@objectstack/spec/contracts`).
 */
const BodyMailAddressSchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().optional(), address: z.string().min(1) }).strict(),
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
    object: z.string().min(1).describe('Object name of the record'),
    id: z.string().min(1).describe('Record id'),
  })
  .strict()
  .describe('A record the door reads in the caller\'s scope before it acts');
export type BodyDoorRecordRef = z.input<typeof BodyDoorRecordRefSchema>;

/**
 * `ctx.email.send(input)` — a message a body hands to the mail service.
 *
 * The sender is the deployment's configured sender, and the door names the
 * calling user beside the organization in its display name; a reply goes to
 * `replyTo`. The message is recorded as sent by the calling user and under the
 * caller's organization. At least one of `text` or `html`. At most
 * {@link BODY_MAIL_RECIPIENT_LIMIT} recipients across `to`, `cc` and `bcc`
 * together: each slot is held to that number here, and the door refuses a call
 * whose three slots add up to more.
 */
export const BodyMailSendInputSchema = z
  .object({
    to: BodyMailAddressesSchema.describe('Recipient address, or a list of them'),
    cc: BodyMailAddressesSchema.optional().describe('Carbon-copy recipients'),
    bcc: BodyMailAddressesSchema.optional().describe('Blind carbon-copy recipients'),
    replyTo: BodyMailAddressSchema.optional().describe('Reply-To address; the sender itself is the configured one'),
    subject: z.string().min(1).describe('Subject line'),
    text: z.string().optional().describe('Plain-text body'),
    html: z.string().optional().describe('HTML body'),
    related: BodyDoorRecordRefSchema.optional().describe('The record the message is about'),
  })
  .strict()
  .refine(requiredOneOf(['text', 'html']), {
    message: 'A message needs a body: give `text`, `html`, or both.',
    path: ['text'],
  })
  .describe('ctx.email.send input: a message a script body hands to the mail service');
export type BodyMailSendInput = z.infer<typeof BodyMailSendInputSchema>;

/**
 * `ctx.activity.append(input)` — one entry a body adds to a record's activity
 * timeline.
 *
 * The door stamps the actor (the calling user), the organization, the time and
 * the origin (the package and the body that wrote it). `type` is the open
 * timeline vocabulary less the values only the platform records
 * (`SYS_ACTIVITY_PLATFORM_TYPES`); the record, and `source` when given, must be
 * readable by the caller. `metadata` is a plain object the timeline stores
 * beside the entry, and may not use the keys the platform's own entries carry.
 */
export const BodyActivityAppendInputSchema = z
  .object({
    object: z.string().min(1).describe('Object name of the record the entry is about'),
    recordId: z.string().min(1).describe('Id of the record the entry is about'),
    type: z.string().min(1).describe('Activity kind, from the open vocabulary less the platform-only values'),
    summary: z.string().min(1).max(500).describe('One-line summary'),
    recordLabel: z.string().optional().describe('Display label of the record, as of the entry'),
    source: BodyDoorRecordRefSchema.optional().describe('The record the entry points at for its detail'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Display hints stored beside the entry'),
  })
  .strict()
  .describe('ctx.activity.append input: one entry a script body adds to a record timeline');
export type BodyActivityAppendInput = z.infer<typeof BodyActivityAppendInputSchema>;
