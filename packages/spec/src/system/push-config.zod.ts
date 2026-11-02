// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Push Service Configuration Protocol — the push channel's transports.
 *
 * Operator-facing configuration for the `push` channel ADR-0012 §4 ships in
 * core: Apple Push Notification service with token-based auth, and Firebase
 * Cloud Messaging over its HTTP v1 API. It sits beside
 * `EmailServiceConfigSchema` (`email-config.zod.ts`), the declaration of
 * the email channel's transport selection.
 *
 * **Secrets are references, never values (ADR-0143 D3, ADR-0097 §3).** Each
 * transport has one secret — the APNs `.p8` signing key and the FCM
 * service-account JSON — and each is named by a reference the push channel
 * resolves through the secrets layer when it sends (in the open tier, the
 * name of an environment variable). An inline secret is refused two ways:
 * written under a key an operator would reach for (`key`, `privateKey`,
 * `serviceAccount`, …), it is refused by name with the reference key as the
 * prescription; written into the reference itself, it is refused because a
 * reference is one token — a PEM block carries whitespace and a JSON document
 * carries braces, and a name carries neither.
 *
 * **What reads it.** The push channel plugin (`plugin-notification-push`,
 * ADR-0012 §11) is its one reader, and it is a later change than this
 * declaration: until it lands nothing reads this shape, and it is not a key
 * of the stack definition. Wiring it into a configuration door is that
 * change's to make, together with the reader, so a key is never authorable
 * before something honours it.
 *
 * Out of scope here: a hosted (cloud-side) configuration surface, and the
 * other vendors ADR-0012 §6 routes to alternate channel plugins (HMS,
 * Xiaomi, OPPO, vivo).
 */

/**
 * Push vendors core delivers through: `apns` (Apple) and `fcm` (Firebase).
 *
 * Closed on purpose. ADR-0012 §6 plugs the domestic Android vendors in as
 * alternate channel implementations, not as transports of this channel, so a
 * new value here is a spec change made together with its transport.
 */
export const PushVendorSchema = z.enum(['apns', 'fcm'])
  .describe('Push vendor core delivers through: apns (Apple Push Notification service) or fcm (Firebase Cloud Messaging HTTP v1)');
export type PushVendor = z.input<typeof PushVendorSchema>;

/**
 * A secrets-layer reference: one token, never the secret it names.
 * Whitespace and braces are refused because the secrets in question cannot
 * be written without them (a PEM block, a JSON document) and a reference
 * never needs them.
 */
function secretReference(secret: string) {
  return z.string()
    .min(1)
    .regex(/^[^\s{}]+$/, {
      message: `This names the ${secret} in the secrets layer and never contains it: put the value in the secrets layer `
        + '(an environment variable in the open tier) and write its name here.',
    });
}

/** The guidance an inline secret meets on a push transport block. */
function inlineSecretGuidance(transport: string, secret: string, refKey: string): string {
  return `Not authorable on the ${transport} push transport. The ${secret} is a credential and is never written inline — `
    + `put it in the secrets layer (an environment variable in the open tier) and name it with \`${refKey}\`.`;
}

const APNS_KEY_GUIDANCE = inlineSecretGuidance('APNs', '.p8 signing key', 'keyRef');
const FCM_ACCOUNT_GUIDANCE = inlineSecretGuidance('FCM', 'service-account JSON', 'serviceAccountRef');

/** APNs with token-based (`.p8` signing key) authentication. */
export const ApnsTransportConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the APNs push transport',
    history: 'This block is strict from birth — no APNs configuration existed before it.',
    aliases: { bundleId: 'topic', credentialRef: 'keyRef' },
    guidance: {
      key: APNS_KEY_GUIDANCE,
      privateKey: APNS_KEY_GUIDANCE,
      p8: APNS_KEY_GUIDANCE,
      authKey: APNS_KEY_GUIDANCE,
      signingKey: APNS_KEY_GUIDANCE,
      secret: APNS_KEY_GUIDANCE,
    },
  },
  {
    teamId: z.string().min(1).describe('Apple Developer Team ID (10 characters) that issued the signing key'),
    keyId: z.string().min(1).describe('Key ID of the APNs auth key (10 characters)'),
    topic: z.string().min(1).describe('APNs topic: the app bundle ID the pushes are for'),
    environment: z.enum(['sandbox', 'production'])
      .describe('APNs gateway: sandbox (development builds) or production (TestFlight and App Store builds)'),
    keyRef: secretReference('APNs .p8 signing key')
      .describe('Secrets-layer reference to the .p8 signing key (an environment-variable name in the open tier). Never the key itself'),
  },
));
export type ApnsTransportConfig = z.input<typeof ApnsTransportConfigSchema>;

/** FCM over the HTTP v1 API, authenticated by a service account. */
export const FcmTransportConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the FCM push transport',
    history: 'This block is strict from birth — no FCM configuration existed before it.',
    aliases: { credentialRef: 'serviceAccountRef' },
    guidance: {
      serviceAccount: FCM_ACCOUNT_GUIDANCE,
      serviceAccountJson: FCM_ACCOUNT_GUIDANCE,
      credentials: FCM_ACCOUNT_GUIDANCE,
      privateKey: FCM_ACCOUNT_GUIDANCE,
      secret: FCM_ACCOUNT_GUIDANCE,
      serverKey:
        'Not authorable. FCM legacy server keys belong to the retired legacy API; the HTTP v1 transport authenticates '
        + 'with a service account — name its JSON with `serviceAccountRef`.',
    },
  },
  {
    projectId: z.string().min(1).describe('Firebase project ID the HTTP v1 send endpoint is addressed to'),
    serviceAccountRef: secretReference('FCM service-account JSON')
      .describe('Secrets-layer reference to the service-account JSON (an environment-variable name in the open tier). Never the JSON itself'),
  },
));
export type FcmTransportConfig = z.input<typeof FcmTransportConfigSchema>;

/**
 * The push channel's transport configuration: one optional block per vendor.
 * A vendor with no block is a vendor this deployment does not deliver
 * through.
 */
export const PushServiceConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the push transport configuration',
    history: 'This block is strict from birth — no push configuration existed before it.',
  },
  {
    apns: ApnsTransportConfigSchema.optional().describe('APNs transport (token-based auth). Absent: no delivery to apns devices'),
    fcm: FcmTransportConfigSchema.optional().describe('FCM HTTP v1 transport. Absent: no delivery to fcm devices'),
  },
));
export type PushServiceConfig = z.input<typeof PushServiceConfigSchema>;
