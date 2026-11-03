// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { requiredOneOf } from '../shared/refinement-projection';
import { strictObject } from '../shared/strict-object';

/**
 * Push Service Configuration Protocol — how the push channel reaches the
 * vendors.
 *
 * **Read by `@objectstack/service-push`.** `PushServicePlugin` parses its
 * `config` option with {@link PushServiceConfigSchema} when it initialises:
 * for the direct transport it builds one vendor transport per block, and it
 * refuses the relay transport, not yet served (#29920). The `push` channel in
 * `@objectstack/service-messaging` delivers through the push service it
 * registers.
 *
 * **Two transports, and the hosted relay is the default.** The store-published
 * ObjectOS app is signed with ObjectStack's own APNs key and Firebase project,
 * and those credentials never leave ObjectStack. So a server delivers to that
 * app through the hosted push relay (`transport: 'relay'`), which holds the
 * credentials and forwards each delivery to APNs or FCM. The relay
 * authenticates the server by its cloud binding credential (cloud ADR-0008,
 * the `oscc_…` bearer the server received when it was bound), so the relay
 * block carries no credential of its own. It sees only an opaque, ID-only
 * payload: the wire shape is `PushRelayRequestSchema`
 * (`api/push-relay.zod.ts`).
 *
 * The direct transport (`transport: 'direct'`) is for a white-label build: an
 * app signed with the operator's own APNs key and Firebase project, which the
 * relay cannot deliver to. It carries one block per vendor (ADR-0012 §4:
 * Apple Push Notification service with token-based auth, and Firebase Cloud
 * Messaging over its HTTP v1 API), each naming its secret by reference.
 *
 * **What a block without `transport` reads as.** `transport` is the
 * discriminator, and a block may leave it out: with no vendor block it reads
 * as the relay, the default; with an `apns` or `fcm` block it reads as
 * direct, which is the shape this schema had before the relay existed. A
 * block that names `transport` is judged by that transport alone. Two mixed
 * shapes are refused when they are written: a relay block that carries a
 * credential (a vendor block, or a key an operator would reach for), and a
 * direct block with no vendor block, which names no `credentialRef` and so
 * could deliver to nothing.
 *
 **What is served today.** The direct transport is: it ships as
 * `@objectstack/service-push` (ADR-0012, amended 2026-11-03, #29041). The
 * relay transport is not yet: the relay sender is follow-up card #29920, and
 * until it ships `PushServicePlugin` refuses a relay block, the default `{}`
 * included, when it initialises, so a server is never left believing it
 * pushes when nothing would deliver.
 *
 * It sits beside `EmailServiceConfigSchema` (`email-config.zod.ts`), the
 * declaration of the email channel's transport selection.
 *
 * **Secrets are references, never values (ADR-0143 D3, ADR-0097 §3).** Each
 * direct vendor block has one secret — the APNs `.p8` signing key and the FCM
 * service-account JSON — and each is named by a `credentialRef`, the same key
 * every other secret an author names is written under (ADR-0143 D3), which
 * the push transport resolves through the secrets layer when it first signs
 * (in the open tier, the name of an environment variable). An inline secret is
 * refused two ways: written under a key an operator would reach for (`key`,
 * `privateKey`, `serviceAccount`, …), it is refused by name with
 * `credentialRef` as the prescription; written into the reference itself, it
 * is refused because a reference is one token — a PEM block carries
 * whitespace and a JSON document carries braces, and a name carries neither.
 *
 * **What reads it, and why it is not a stack key.** `PushServicePlugin`
 * (`@objectstack/service-push`) is its one reader, through the plugin's
 * constructor: the host that composes the plugin hands it the value. The email
 * transport selection it sits beside is read from `config.email` of the stack
 * definition (`StackEmailConfigSchema`) and `OS_EMAIL_*`; this shape has no
 * stack-definition key and no `os serve` capability yet, so it is authorable
 * only where a host composes the plugin.
 *
 * Out of scope here: the other vendors ADR-0012 §6 routes to alternate
 * channel plugins (HMS, Xiaomi, OPPO, vivo).
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
).describe('APNs transport with token-based auth (.p8 signing key by reference)'));
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
).describe('FCM HTTP v1 transport (service-account JSON by reference)'));
export type FcmTransportConfig = z.input<typeof FcmTransportConfigSchema>;

const RELAY_CREDENTIAL_GUIDANCE =
  'Not authorable on the relay push transport. The hosted relay holds the APNs and FCM credentials and '
  + 'authenticates this server by its cloud binding credential, so a relay block carries no credential. To deliver '
  + "with your own APNs key or Firebase project (a white-label build), write `transport: 'direct'` with the vendor "
  + 'blocks.';

const DIRECT_ENDPOINT_GUIDANCE =
  "Not authorable on the direct push transport: it sends straight to APNs and FCM. `endpoint` addresses the hosted "
  + "relay, so write `transport: 'relay'` (or leave out the vendor blocks) to use it.";

/** The message a direct block with no vendor block meets. */
const PUSH_DIRECT_TRANSPORT_EMPTY_MESSAGE =
  "A direct push transport names at least one vendor block (`apns` or `fcm`), each with its `credentialRef`. "
  + "With no vendor block it delivers to nothing: to deliver through the hosted relay, write `transport: 'relay'` "
  + 'or leave `transport` out.';

/**
 * The hosted push relay: the default transport. The relay holds the APNs and
 * FCM credentials of the store-published app and authenticates this server by
 * its cloud binding credential, so the block carries none.
 */
export const PushRelayTransportConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the relay push transport',
    history: 'This block is strict from birth — no relay configuration existed before it.',
    aliases: { url: 'endpoint', relayUrl: 'endpoint' },
    guidance: {
      apns: RELAY_CREDENTIAL_GUIDANCE,
      fcm: RELAY_CREDENTIAL_GUIDANCE,
      credentialRef: RELAY_CREDENTIAL_GUIDANCE,
      credential: RELAY_CREDENTIAL_GUIDANCE,
      token: RELAY_CREDENTIAL_GUIDANCE,
      apiKey: RELAY_CREDENTIAL_GUIDANCE,
      key: RELAY_CREDENTIAL_GUIDANCE,
      secret: RELAY_CREDENTIAL_GUIDANCE,
    },
  },
  {
    transport: z.literal('relay').default('relay')
      .describe('The hosted push relay. The default: a block with no vendor block reads as relay'),
    endpoint: z.string().url().regex(/^https:\/\//, {
      message: 'The push relay endpoint is an https URL: every request carries the server binding credential.',
    }).optional().describe(
      'The push relay URL, for a staging relay only. Absent: the production relay. https only, because every request '
      + 'carries the server binding credential',
    ),
  },
).describe('[PLANNED — not yet served] The hosted push relay transport (the default): authenticated by the server cloud binding credential, so it carries none. '
  + 'The push service refuses it at boot until the relay sender ships'));
export type PushRelayTransportConfig = z.input<typeof PushRelayTransportConfigSchema>;
/** Post-parse shape of {@link PushRelayTransportConfig} — `transport` filled in (ADR-0122). */
export type PushRelayTransportConfigParsed = z.infer<typeof PushRelayTransportConfigSchema>;

/**
 * Direct delivery to APNs and FCM with the operator's own credentials, for a
 * white-label build: one optional block per vendor, at least one present. A
 * vendor with no block is a vendor this deployment does not deliver through.
 */
export const PushDirectTransportConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the direct push transport',
    history: 'This block is strict from birth — before the relay existed it was the whole push configuration, with the same two vendor blocks.',
    guidance: {
      endpoint: DIRECT_ENDPOINT_GUIDANCE,
    },
  },
  {
    transport: z.literal('direct').default('direct')
      .describe('Direct delivery with your own APNs key and Firebase project, for a white-label build. A block with a vendor block and no transport reads as direct'),
    apns: ApnsTransportConfigSchema.optional().describe('APNs transport (token-based auth). Absent: no delivery to apns devices'),
    fcm: FcmTransportConfigSchema.optional().describe('FCM HTTP v1 transport. Absent: no delivery to fcm devices'),
  },
).refine(requiredOneOf(['apns', 'fcm']), { message: PUSH_DIRECT_TRANSPORT_EMPTY_MESSAGE })
  .describe('Direct push transport for a white-label build: one block per vendor (apns, fcm), at least one, each naming its credential by reference; read by the push service'));
export type PushDirectTransportConfig = z.input<typeof PushDirectTransportConfigSchema>;
/** Post-parse shape of {@link PushDirectTransportConfig} — `transport` filled in (ADR-0122). */
export type PushDirectTransportConfigParsed = z.infer<typeof PushDirectTransportConfigSchema>;

/**
 * The push channel's transport configuration: the hosted relay (the default)
 * or direct delivery, discriminated by `transport`.
 *
 * A block that names `transport` is judged by that transport alone. A block
 * that leaves it out is tried as the relay and then as direct, so `{}` reads
 * as the relay and a block with a vendor block reads as direct.
 */
export const PushServiceConfigSchema = lazySchema(() => z.discriminatedUnion(
  'transport',
  [PushRelayTransportConfigSchema, PushDirectTransportConfigSchema],
  // Both members default `transport`, so neither owns its absence: an absent
  // tag falls back to trying the members in order, relay first.
  { unionFallback: true },
).describe('Push channel transport configuration: the hosted relay (the default) or direct delivery to apns and fcm for a white-label build. '
  + 'The push service reads it: direct drives the vendor transports, and relay is refused at boot until the relay sender ships'));
export type PushServiceConfig = z.input<typeof PushServiceConfigSchema>;
/** Post-parse shape of {@link PushServiceConfig} — `transport` filled in (ADR-0122). */
export type PushServiceConfigParsed = z.infer<typeof PushServiceConfigSchema>;
