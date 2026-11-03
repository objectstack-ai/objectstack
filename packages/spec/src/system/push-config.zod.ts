// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Push Service Configuration Protocol — the push channel's transports.
 *
 * **Declared ahead of its reader.** Every schema here carries a
 * `[PLANNED — not yet read]` marker in its `.describe()`: nothing reads this
 * shape until the push channel plugin lands, so a value written to it today
 * changes nothing. The marker comes off with the change that wires the reader.
 *
 * Operator-facing configuration for the `push` channel ADR-0012 §4 ships in
 * core: Apple Push Notification service with token-based auth, and Firebase
 * Cloud Messaging over its HTTP v1 API. It sits beside
 * `EmailServiceConfigSchema` (`email-config.zod.ts`), the declaration of
 * the email channel's transport selection.
 *
 * **Secrets are references, never values (ADR-0143 D3, ADR-0097 §3).** Each
 * transport has one secret — the APNs `.p8` signing key and the FCM
 * service-account JSON — and each is named by a `credentialRef`, the same key
 * every other secret an author names is written under (ADR-0143 D3), which
 * the push channel resolves through the secrets layer when it sends (in the
 * open tier, the name of an environment variable). An inline secret is
 * refused two ways: written under a key an operator would reach for (`key`,
 * `privateKey`, `serviceAccount`, …), it is refused by name with
 * `credentialRef` as the prescription; written into the reference itself, it
 * is refused because a reference is one token — a PEM block carries
 * whitespace and a JSON document carries braces, and a name carries neither.
 *
 * **What reads it, and why it is not a stack key yet.** The push channel
 * plugin (`plugin-notification-push`, ADR-0012 §11) is its one reader, and it
 * is a later change than this declaration. The email transport selection it
 * sits beside is read from `config.email` of the stack definition
 * (`StackEmailConfigSchema`) and `OS_EMAIL_*`; this shape gets its own
 * configuration door in the change that ships the reader, not here, so a key
 * is never authorable before something honours it.
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
// Stricter than the house `credentialRef` (`z.string().min(1)`,
// shared/connector-auth.zod.ts) on purpose. A bearer token or an API key looks
// like a name, so a connector's reference cannot tell a pasted secret from a
// reference and checks only that one is there. The two push secrets can be
// told apart: a .p8 key is a PEM block and a service-account file is a JSON
// document, and every name the house writes (an environment-variable name in
// the open tier) has neither whitespace nor braces. If a secrets layer ever
// names a secret with either, this widens to the house shape.
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

const APNS_KEY_GUIDANCE = inlineSecretGuidance('APNs', '.p8 signing key', 'credentialRef');
const FCM_ACCOUNT_GUIDANCE = inlineSecretGuidance('FCM', 'service-account JSON', 'credentialRef');

/** APNs with token-based (`.p8` signing key) authentication. */
export const ApnsTransportConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the APNs push transport',
    history: 'This block is strict from birth — no APNs configuration existed before it.',
    aliases: { bundleId: 'topic', keyRef: 'credentialRef' },
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
    credentialRef: secretReference('APNs .p8 signing key')
      .describe('Secrets-layer reference to the .p8 signing key (an environment-variable name in the open tier). Never the key itself'),
  },
).describe('[PLANNED — not yet read] APNs transport with token-based auth (.p8 signing key by reference)'));
export type ApnsTransportConfig = z.input<typeof ApnsTransportConfigSchema>;

/** FCM over the HTTP v1 API, authenticated by a service account. */
export const FcmTransportConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the FCM push transport',
    history: 'This block is strict from birth — no FCM configuration existed before it.',
    aliases: { serviceAccountRef: 'credentialRef' },
    guidance: {
      serviceAccount: FCM_ACCOUNT_GUIDANCE,
      serviceAccountJson: FCM_ACCOUNT_GUIDANCE,
      credentials: FCM_ACCOUNT_GUIDANCE,
      privateKey: FCM_ACCOUNT_GUIDANCE,
      secret: FCM_ACCOUNT_GUIDANCE,
      serverKey:
        'Not authorable. FCM legacy server keys belong to the retired legacy API; the HTTP v1 transport authenticates '
        + 'with a service account — name its JSON with `credentialRef`.',
    },
  },
  {
    projectId: z.string().min(1).describe('Firebase project ID the HTTP v1 send endpoint is addressed to'),
    credentialRef: secretReference('FCM service-account JSON')
      .describe('Secrets-layer reference to the service-account JSON (an environment-variable name in the open tier). Never the JSON itself'),
  },
).describe('[PLANNED — not yet read] FCM HTTP v1 transport (service-account JSON by reference)'));
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
).describe('[PLANNED — not yet read] Push channel transport configuration: one optional block per vendor (apns, fcm). Nothing reads it until the push channel plugin ships'));
export type PushServiceConfig = z.input<typeof PushServiceConfigSchema>;
