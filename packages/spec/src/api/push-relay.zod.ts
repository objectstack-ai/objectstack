// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { PushVendorSchema } from '../system/push-config.zod';
import { EnhancedApiErrorSchema, ErrorResponseSchema } from './errors.zod';
import { PushDeliveryDataSchema } from './push-delivery.zod';

/**
 * Push relay wire protocol — what a server sends the hosted push relay, and
 * what the relay answers.
 *
 * **Why there is a relay.** The store-published ObjectOS app is signed with
 * ObjectStack's own APNs key and Firebase project, and those credentials
 * never leave ObjectStack. So a server whose push transport is the relay
 * (`PushRelayTransportConfigSchema`, `system/push-config.zod.ts`, the
 * default) does not call APNs or FCM itself: it POSTs one
 * {@link PushRelayRequestSchema} to the relay endpoint, and the relay
 * forwards each delivery to its vendor. One schema, pinned by both ends: the
 * push channel that sends (the server) and the relay that receives it (in
 * objectstack-ai/cloud).
 *
 * **Who is asking.** The relay authenticates the server by its cloud binding
 * credential (cloud ADR-0008, the `oscc_…` bearer the server received when
 * it was bound), sent as the request's bearer token. The body carries no
 * credential. A bad or revoked binding answers 401
 * ({@link PushRelayErrorResponseSchema}).
 *
 * **ID-only payload.** The relay is a third party to the notification, so it
 * never sees its content. A delivery's payload carries the push delivery data
 * (`PushDeliveryDataSchema`: the notification id, its same-server route and
 * the sending server's origin) and one generic line of visible text, and
 * nothing else. There is no title or body: the shell reads the notification
 * from the server after the tap, by its id. To the relay the payload is
 * opaque: it puts it in the vendor message unchanged.
 *
 * **Served.** `@objectstack/service-push` sends this request: its relay
 * transport (`RelayPushSender`) builds one delivery per device token, parses
 * the request with {@link PushRelayRequestSchema} before it leaves the
 * server, and reads the answer with {@link PushRelayResponseSchema} and
 * {@link PushRelayErrorResponseSchema}. The relay that receives it is served
 * by the cloud's control plane (objectstack-ai/cloud#3519).
 */

/** Guidance for a notification-content key written into the ID-only payload. */
const PAYLOAD_CONTENT_GUIDANCE =
  'Not carried. A push through the relay is ID-only: the payload holds the push delivery data (`data`) and one '
  + 'generic visible line (`text`), never the notification content. The shell reads the notification from the '
  + 'server after the tap, by `data.notificationId`.';

/**
 * How urgently the vendor delivers: `high` at once, waking the device (APNs
 * priority 10, FCM `high`); `normal` when the device's power state allows
 * (APNs priority 5, FCM `normal`).
 */
export const PushRelayPrioritySchema = z.enum(['high', 'normal'])
  .describe('Vendor delivery priority: high delivers at once and wakes the device (APNs 10, FCM high); normal may wait for the device power state (APNs 5, FCM normal)');
export type PushRelayPriority = z.input<typeof PushRelayPrioritySchema>;

/**
 * The push delivery data as the relay payload carries it: the members of
 * `PushDeliveryDataSchema`, judged strictly. The relay forwards the payload
 * unchanged, so a key the data does not declare (a notification `title`, say)
 * is refused here rather than stripped: a stripped key would read as carried.
 */
const PushRelayPayloadDataSchema = lazySchema(() => strictObject(
  {
    surface: 'the push relay payload data',
    history: 'Judged strictly from the first relay sender on; before it, no relay payload was produced.',
    guidance: {
      title: PAYLOAD_CONTENT_GUIDANCE,
      body: PAYLOAD_CONTENT_GUIDANCE,
      subtitle: PAYLOAD_CONTENT_GUIDANCE,
      message: PAYLOAD_CONTENT_GUIDANCE,
      content: PAYLOAD_CONTENT_GUIDANCE,
    },
  },
  PushDeliveryDataSchema.shape,
));

/** The payload of one delivery: the push delivery data and one generic visible line. */
export const PushRelayPayloadSchema = lazySchema(() => strictObject(
  {
    surface: 'the push relay payload',
    history: 'This shape is strict from birth — no relay payload existed before it.',
    guidance: {
      title: PAYLOAD_CONTENT_GUIDANCE,
      body: PAYLOAD_CONTENT_GUIDANCE,
      subtitle: PAYLOAD_CONTENT_GUIDANCE,
      message: PAYLOAD_CONTENT_GUIDANCE,
      content: PAYLOAD_CONTENT_GUIDANCE,
    },
  },
  {
    data: PushRelayPayloadDataSchema.describe(
      'The push delivery data: the notification id, its same-server route and the origin of the sending server, and '
      + 'no other key. The relay puts it in the vendor message unchanged',
    ),
    text: z.string().min(1).describe(
      'One generic visible line the device shows (for example "You have a new notification"), in the recipient\'s '
      + 'language. Never the notification title or body',
    ),
  },
).describe('The ID-only payload of one relay delivery: the push delivery data and one generic visible line, with no title or body. Opaque to the relay'));
export type PushRelayPayload = z.input<typeof PushRelayPayloadSchema>;

/** One delivery: a device token, its vendor, the payload and the priority. */
export const PushRelayDeliverySchema = lazySchema(() => strictObject(
  {
    surface: 'a push relay delivery',
    history: 'This shape is strict from birth — no relay delivery existed before it.',
  },
  {
    token: z.string().min(1).describe('The vendor device token, as the device registered it'),
    vendor: PushVendorSchema.describe('The vendor the token belongs to: apns or fcm'),
    payload: PushRelayPayloadSchema.describe('The ID-only payload'),
    priority: PushRelayPrioritySchema.describe('Vendor delivery priority'),
  },
).describe('One relay delivery: a device token, its vendor, the ID-only payload and the delivery priority'));
export type PushRelayDelivery = z.input<typeof PushRelayDeliverySchema>;

/**
 * The request a server POSTs to the relay endpoint. Its bearer token is the
 * server's cloud binding credential; the body carries none.
 */
export const PushRelayRequestSchema = lazySchema(() => strictObject(
  {
    surface: 'the push relay request',
    history: 'This shape is strict from birth — no relay request existed before it.',
  },
  {
    deliveries: z.array(PushRelayDeliverySchema).min(1).describe(
      'The deliveries, one per device token. The response answers each one, in the same order',
    ),
  },
).describe('The request a server sends the hosted push relay: one delivery per device token. Authenticated by the server cloud binding credential as its bearer token'));
export type PushRelayRequest = z.input<typeof PushRelayRequestSchema>;

/**
 * What the relay did with one delivery:
 *
 * - `ok` — the vendor accepted it;
 * - `invalid` — the vendor reports the token dead (the app was removed, or
 *   the token was rotated). The sender stops delivering to it: the device row
 *   keeps `enabled: false` and `invalidatedAt` (`UserDeviceSchema`);
 * - `retry` — a transient failure (the vendor was unavailable or throttled).
 *   The sender may send the delivery again later.
 */
export const PushRelayResultStatusSchema = z.enum(['ok', 'invalid', 'retry'])
  .describe('Outcome of one delivery: ok (the vendor accepted it), invalid (the vendor reports the token dead; stop delivering to it) or retry (a transient failure; the delivery may be sent again later)');
export type PushRelayResultStatus = z.input<typeof PushRelayResultStatusSchema>;

/** The relay's answer for one delivery. */
export const PushRelayResultSchema = lazySchema(() => z.object({
  token: z.string().min(1).describe('The device token of the delivery this result answers'),
  status: PushRelayResultStatusSchema.describe('What happened to the delivery'),
}).describe('The relay answer for one delivery: its device token and its outcome'));
export type PushRelayResult = z.input<typeof PushRelayResultSchema>;

/**
 * The relay's 200 answer: one result per delivery, in request order. A
 * delivery the vendor refused is a result, never an error status: an error
 * status ({@link PushRelayErrorResponseSchema}) answers the whole request.
 */
export const PushRelayResponseSchema = lazySchema(() => z.object({
  results: z.array(PushRelayResultSchema).describe(
    'One result per delivery, in the order of the request deliveries',
  ),
}).describe('The push relay answer: one result per delivery token, ok, invalid or retry'));
export type PushRelayResponse = z.input<typeof PushRelayResponseSchema>;

/**
 * Why the relay refused the binding: `binding_invalid` (the credential is not
 * one the relay recognises: malformed, unknown, or for another environment)
 * or `binding_revoked` (it was valid and has been revoked).
 */
const PushRelayBindingRefusalSchema = z.enum(['binding_invalid', 'binding_revoked']);

/**
 * 401: the binding credential is bad or revoked. `details.reason` says which;
 * `helpText` is the next step (bind the server again).
 */
function unauthenticatedError() {
  return EnhancedApiErrorSchema.extend({
    code: z.literal('UNAUTHENTICATED').describe('The server binding credential was not accepted'),
    httpStatus: z.literal(401).describe('HTTP status code'),
    details: z.object({
      reason: PushRelayBindingRefusalSchema.describe(
        'binding_invalid: the relay does not recognise the credential; binding_revoked: it was valid and has been revoked',
      ),
    }).describe('Why the binding was refused'),
    helpText: z.string().min(1).describe('The next step: bind the server to the cloud again'),
  });
}

/**
 * 429, request pacing: the server sent too many requests. `retryAfterSeconds`
 * says when to send again, and the relay sets the `Retry-After` header to the
 * same value.
 */
function rateLimitError() {
  return EnhancedApiErrorSchema.extend({
    code: z.literal('RATE_LIMIT_EXCEEDED').describe('The server sent the relay too many requests'),
    httpStatus: z.literal(429).describe('HTTP status code'),
    retryable: z.literal(true).default(true).describe('Always true: the same request succeeds once retryAfterSeconds has passed'),
    retryAfterSeconds: z.number().int().positive().describe('Seconds to wait before sending again'),
    helpText: z.string().min(1).describe('The next step: send again after retryAfterSeconds'),
  });
}

/**
 * 429, quota: the push quota of the server's plan is used up. `helpText` is
 * the next step (raise the plan, or wait for the quota to reset);
 * `retryAfterSeconds`, when present, is when the quota resets.
 */
function quotaError() {
  return EnhancedApiErrorSchema.extend({
    code: z.literal('QUOTA_EXCEEDED').describe('The push quota of the server plan is used up'),
    httpStatus: z.literal(429).describe('HTTP status code'),
    retryAfterSeconds: z.number().int().positive().optional().describe('Seconds until the quota resets, when known'),
    helpText: z.string().min(1).describe('The next step: raise the plan, or wait for the quota to reset'),
  });
}

/**
 * The error the relay answers a whole request with, discriminated by `code`:
 * `UNAUTHENTICATED` (401, bad or revoked binding), `RATE_LIMIT_EXCEEDED`
 * (429, request pacing) or `QUOTA_EXCEEDED` (429, plan quota). Each is the
 * house `EnhancedApiErrorSchema` (ADR-0112) with its code, status and next
 * step fixed.
 */
export const PushRelayErrorSchema = lazySchema(() => z.discriminatedUnion('code', [
  unauthenticatedError(),
  rateLimitError(),
  quotaError(),
]).describe('A push relay error: UNAUTHENTICATED (401, bad or revoked binding), RATE_LIMIT_EXCEEDED or QUOTA_EXCEEDED (429), each with its next step in helpText'));
export type PushRelayError = z.input<typeof PushRelayErrorSchema>;
/** Post-parse shape of {@link PushRelayError} — defaults applied (ADR-0122). */
export type PushRelayErrorParsed = z.infer<typeof PushRelayErrorSchema>;

/** The relay's error response: the house `ErrorResponseSchema` envelope around a {@link PushRelayErrorSchema}. */
export const PushRelayErrorResponseSchema = lazySchema(() => ErrorResponseSchema.extend({
  error: PushRelayErrorSchema.describe('Error details'),
}).describe('The push relay error response: the house error envelope, for 401 (bad or revoked binding) and 429 (rate limit or quota)'));
export type PushRelayErrorResponse = z.input<typeof PushRelayErrorResponseSchema>;
/** Post-parse shape of {@link PushRelayErrorResponse} — defaults applied (ADR-0122). */
export type PushRelayErrorResponseParsed = z.infer<typeof PushRelayErrorResponseSchema>;
