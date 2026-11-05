// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { strictObject } from '../shared/strict-object';
import { resolveFlowTriggerKind } from './flow-trigger-kind';
import { API_TRIGGER_SECRET_REF_KEY, apiTriggerSecretRefOf } from './api-trigger-secret-ref.zod';

/**
 * An inbound `api` hook's verifier for a THIRD-PARTY sender, declared.
 *
 * An `api` flow's start node arms an inbound hook (ADR-0041 Tier 1, whose
 * acceptance criteria name "HMAC signature verification (GitHub/Stripe style)
 * and a constant-time compare"). By default the hook admits a post only by
 * ObjectStack's own `x-objectstack-signature`: the timestamped HMAC-SHA256 of
 * `<t>.<raw body>` under the hook's secret. A vendor that signs its callbacks
 * its own way could not be admitted at all, whatever key it held: DocuSign
 * Connect's `X-DocuSign-Signature-1` (base64 HMAC-SHA256 of the raw body), a
 * Stripe-style `t=…,v1=…` header (hex HMAC-SHA256 of `<t>.<raw body>`), a
 * GitHub-style `sha256=<hex>`. `config.signature` declares how such a sender
 * signs: which header carries the digest, which HMAC, which encoding, and what
 * is signed.
 *
 * **The key is `config.secretRef`.** The same reference an ObjectStack-signed
 * hook names, resolved the same way at every post: one key per hook, by name
 * only. A vendor key is ⛔ never inline: a verifier beside a literal
 * `config.secret` is refused, and so is one with no `secretRef` at all.
 *
 * **One verifier per hook.** A declared `signature` REPLACES the
 * `x-objectstack-signature` check for its hook. The hook then verifies the
 * declared scheme and nothing else: it does not stack with the platform's own
 * check, and it is not optional (a post without the declared header is refused
 * like a post with a bad one). A start node with no `signature` is verified
 * exactly as it was before this key. {@link apiTriggerVerifierOf} is the one
 * reader that decides which verifier a hook has, and it decides on the key's
 * PRESENCE: a `signature` that is present and unusable is never read as
 * absent, so it can never fall back to the platform's check.
 *
 * What the implementer owes (the constant-time compare, the replay window for
 * a scheme that signs a timestamp and the absence of one for a scheme that
 * does not, the one `401 INVALID_SIGNATURE` for every failure) is stated in
 * `contracts/trigger-api-service.ts`, beside the platform's own verifier,
 * because the member that verifies is declared there.
 *
 * Refusals, each anchored on the start node's `config.signature`:
 *
 *  - a shape the schema refuses ({@link ApiTriggerSignatureSchema}): an
 *    unknown algorithm or encoding, a `signs` that is neither form, a
 *    `timestamp.body` scheme that names no timestamp source, a body-only
 *    scheme that names one, an undeclared key;
 *  - a `header` that names a reserved header, in any case, also refused by
 *    the schema ({@link API_TRIGGER_SIGNATURE_RESERVED_HEADERS}):
 *    `x-objectstack-signature`, the platform's own header, which stays the
 *    platform's (one verifier per hook; and a body-only scheme on it would
 *    re-admit the `sha256=` form the hook's own check refuses, with no replay
 *    bound), or the request's credentials, routing or framing, or the hook's
 *    idempotency key;
 *  - a `timestamp.body` scheme whose timestamp and digest are the same
 *    element of the header;
 *  - a verifier with no key reference (`config.secretRef` absent);
 *  - a verifier beside a literal `config.secret`: an inline key, and a second
 *    source for the one key the hook has;
 *  - a verifier on a flow that binds no inbound `api` trigger: nothing would
 *    ever read it.
 *
 * This is the vocabulary ADR-0138 D7 left to a follow-up (F1: an HMAC, a
 * timestamp, a replay window), placed on the signed inbound-hook channel
 * rather than on `ApiEndpointSchema`.
 */

/** The start-node `config` key that declares a third-party sender's signature scheme. */
export const API_TRIGGER_SIGNATURE_KEY = 'signature';

/** An HTTP field name: RFC 9110's `token`. */
const HTTP_FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Visible ASCII, `,` excepted: the literal text a sender writes before its digest. */
const DIGEST_PREFIX = /^[\x21-\x2B\x2D-\x7E]+$/;

/** The name of one `NAME=value` element of a signature header. */
const ELEMENT_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * The header names a declared scheme may not read its signature from,
 * lower-case, compared without regard to case. A closed list:
 *
 *  - `x-objectstack-signature`: the platform's own header, which stays the
 *    platform's. A hook that declares a scheme never reads it (one verifier
 *    per hook), and the hook's own check accepts it only in its timestamped
 *    form; a declared body-only scheme on it would re-admit the `sha256=`
 *    form that check refuses, with no replay bound.
 *  - `authorization`, `proxy-authorization`, `cookie`: the request's
 *    credentials. The hook reads no session, cookie or `Authorization` header
 *    (`contracts/trigger-api-service.ts`), and a declaration cannot make it.
 *  - `host`, `content-length`, `transfer-encoding`: the request's routing and
 *    framing, which a proxy may rewrite, never a sender's digest.
 *  - `x-idempotency-key`: the hook's delivery id, which it reads for its own
 *    purpose.
 */
export const API_TRIGGER_SIGNATURE_RESERVED_HEADERS = Object.freeze([
  'x-objectstack-signature',
  'authorization',
  'proxy-authorization',
  'cookie',
  'host',
  'content-length',
  'transfer-encoding',
  'x-idempotency-key',
] as const);

const RESERVED_HEADERS: ReadonlySet<string> = new Set(API_TRIGGER_SIGNATURE_RESERVED_HEADERS);

/**
 * Matches every header name EXCEPT a reserved one, in any case: a negative
 * lookahead over the list, each ASCII letter spelled `[xX]`. Built from the
 * list, so the two cannot drift, and without a flag, so the published JSON
 * Schema `pattern` refuses exactly what the runtime refuses.
 */
const NOT_A_RESERVED_HEADER = new RegExp(
  `^(?!(?:${API_TRIGGER_SIGNATURE_RESERVED_HEADERS.map((name) =>
    name.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`),
  ).join('|')})$)`,
);

/** The refusal a reserved `header` raises, or `undefined` for a header a sender may sign in. */
function reservedHeaderMessage(header: string): string | undefined {
  const name = header.toLowerCase();
  if (!RESERVED_HEADERS.has(name)) return undefined;
  if (name === 'x-objectstack-signature') {
    // The body-only `sha256=` form on this header is refused inbound by ruling B on #22805.
    return (
      `\`config.signature.header\` names \`${header}\`, the platform's own signature header, which stays the ` +
      'platform\'s: a hook has one verifier, and a hook that declares its sender\'s scheme never reads ' +
      '`x-objectstack-signature`. (Declared `signs: \'body\'`, it would also re-admit the body-only `sha256=` form ' +
      'the hook\'s own check refuses, with no replay bound.) Remove `signature` to have the hook verify ' +
      '`x-objectstack-signature`, or name the header the sender writes its own signature in.'
    );
  }
  return (
    `\`config.signature.header\` names \`${header}\`, which carries the request's credentials, routing or framing ` +
    '(or, for `x-idempotency-key`, the hook\'s delivery id), never a sender\'s signature: the hook reads no ' +
    'session, cookie or `Authorization` header. Name the header the sender writes its signature in ' +
    '(`X-DocuSign-Signature-1`).'
  );
}

const BORN_CLOSED =
  'Declared closed from its first day: a key a verifier does not read is refused, never dropped, because an ' +
  'ignored setting on an auth boundary reads as a check that is not made.';

const NO_TIMESTAMP_ON_BODY =
  'A body-only scheme (`signs: \'body\'`) signs no time, so it has no timestamp to bound a replay with and no ' +
  'element list to read: `timestampElement` and `digestElement` belong to `signs: \'timestamp.body\'`. Declare ' +
  '`signs: \'timestamp.body\'` when the sender signs `<t>.<raw body>`, or remove them.';

const header = z
  .string({
    error: () =>
      '`config.signature.header` names the HTTP header the sender puts its signature in, as a string ' +
      '(`X-DocuSign-Signature-1`, `Stripe-Signature`).',
  })
  .regex(
    HTTP_FIELD_NAME,
    '`config.signature.header` must be an HTTP header name: letters, digits and `!#$%&\'*+-.^_`|~`, nothing else ' +
      '(`X-DocuSign-Signature-1`). It is matched without regard to case, as HTTP matches header names.',
  )
  .regex(NOT_A_RESERVED_HEADER, { error: (issue) => reservedHeaderMessage(String(issue.input)) })
  .describe(
    'The HTTP header the sender puts its signature in (`X-DocuSign-Signature-1`, `Stripe-Signature`), matched without ' +
      'regard to case. The hook reads this header and never `x-objectstack-signature`. A reserved name is refused, ' +
      'in any case: `x-objectstack-signature`, `authorization`, `proxy-authorization`, `cookie`, `host`, ' +
      '`content-length`, `transfer-encoding` and `x-idempotency-key`.',
  );

const algorithm = z
  .enum(['hmac-sha256'], {
    error: () =>
      '`config.signature.algorithm` must be `hmac-sha256`, the one algorithm an inbound hook verifies. A sender that ' +
      'signs with anything else cannot be admitted by a declared verifier.',
  })
  .describe('The MAC the sender computes under the key `config.secretRef` names. `hmac-sha256` is the only one.');

const encoding = z
  .enum(['hex', 'base64'], {
    error: () =>
      '`config.signature.encoding` must be `hex` or `base64`: how the sender writes the 32-byte digest in the header ' +
      '(DocuSign Connect writes `base64`; a Stripe-style or GitHub-style sender writes `hex`).',
  })
  .describe(
    'How the sender writes the digest in the header: `hex` or `base64` (the RFC 4648 standard alphabet). The digest ' +
      'is decoded and compared as the 32 bytes of the HMAC.',
  );

const element = (key: 'timestampElement' | 'digestElement', what: string) =>
  z
    .string({
      error: () =>
        `A scheme that signs \`timestamp.body\` reads its header as \`NAME=value\` elements separated by \`,\` and ` +
        `names the element that carries ${what}: \`config.signature.${key}\`.`,
    })
    .regex(
      ELEMENT_NAME,
      `\`config.signature.${key}\` is the NAME of one \`NAME=value\` element of the header: letters, digits, \`_\` ` +
        `and \`-\`, without the \`=\`.`,
    );

/**
 * A body-only scheme: the sender signs the raw body and nothing else
 * (DocuSign Connect, a GitHub-style `sha256=` sender). The whole header value,
 * after `prefix`, is the one digest. It signs no time, so it carries no
 * timestamp source and the hook bounds no replay for it: the sender offers
 * nothing to bound one with.
 *
 * Exported as its own def so the published surface records its keys (a union's
 * arms are otherwise invisible to the authorable-surface ledger).
 */
export const ApiTriggerBodySignatureSchema = strictObject(
  {
    surface: '`config.signature` (`signs: \'body\'`)',
    history: BORN_CLOSED,
    guidanceSets: [
      { name: 'TIMESTAMPED_SIGNATURE_ELEMENT_KEYS', keys: ['timestampElement', 'digestElement'], prescription: NO_TIMESTAMP_ON_BODY },
    ],
  },
  {
    signs: z.literal('body').describe('The sender signs the raw body alone. No replay window applies.'),
    header,
    algorithm,
    encoding,
    prefix: z
      .string({ error: () => '`config.signature.prefix` is the literal text before the digest, as a string (`sha256=`).' })
      .regex(
        DIGEST_PREFIX,
        '`config.signature.prefix` must be visible ASCII with no space and no `,` (`sha256=`).',
      )
      .optional()
      .describe(
        'Literal text the sender writes before the digest in the header value (`sha256=` for a GitHub-style ' +
          'sender), checked and removed before decoding. Absent: the whole value is the digest.',
      ),
  },
).describe(
  'A sender that signs the raw body alone (DocuSign Connect, a GitHub-style `sha256=` sender): the header value, ' +
    'after `prefix`, is the one digest. No replay window applies.',
);

/**
 * A timestamped scheme, Stripe-style: the sender signs `<t>.<raw body>` and
 * writes `t` beside the digest in the one header, as `NAME=value` elements
 * separated by `,` (`t=1700000000,v1=<hex>`). The timestamp is inside the
 * signed material, so the hook refuses a `t` outside the same window the
 * `x-objectstack-signature` check applies. Exported as its own def for the
 * same reason as {@link ApiTriggerBodySignatureSchema}.
 */
export const ApiTriggerTimestampedSignatureSchema = strictObject(
  {
    surface: '`config.signature` (`signs: \'timestamp.body\'`)',
    history: BORN_CLOSED,
    guidance: {
      prefix:
        'A `timestamp.body` scheme locates its digest by `digestElement` (`v1` for `t=…,v1=…`), not by a `prefix`. ' +
        'Remove `prefix`.',
    },
  },
  {
    signs: z
      .literal('timestamp.body')
      .describe('The sender signs `<t>.<raw body>`, `t` read from `timestampElement`. The replay window applies.'),
    header,
    algorithm,
    encoding,
    timestampElement: element('timestampElement', 'the timestamp (`t` for a Stripe-style `t=…,v1=…`)').describe(
      'Where the timestamp comes from: the NAME of the header element `NAME=<unix seconds>` (`t`). Its value, exactly ' +
        'as received, is the `<t>` of the signed `<t>.<raw body>`.',
    ),
    digestElement: element('digestElement', 'the digest (`v1` for a Stripe-style `t=…,v1=…`)').describe(
      'The NAME of the header element that carries the digest (`v1`). A sender may send it more than once while it ' +
        'rolls its key; the post verifies when one of them matches.',
    ),
  },
).describe(
  'A sender that signs `<t>.<raw body>` and writes `t` beside the digest as `NAME=value` elements of one header ' +
    '(Stripe-style `t=…,v1=…`). The same replay window as `x-objectstack-signature` applies.',
);

/**
 * `config.signature` — how a third-party sender signs its posts to this hook.
 * Two forms, told apart by `signs`; see the module header for what declaring
 * one changes.
 *
 * @example DocuSign Connect — base64 HMAC-SHA256 of the raw body
 * { signs: 'body', header: 'X-DocuSign-Signature-1', algorithm: 'hmac-sha256', encoding: 'base64' }
 *
 * @example Stripe-style — `Stripe-Signature: t=1700000000,v1=<hex of HMAC-SHA256("1700000000.<raw body>")>`
 * { signs: 'timestamp.body', header: 'Stripe-Signature', algorithm: 'hmac-sha256', encoding: 'hex',
 *   timestampElement: 't', digestElement: 'v1' }
 *
 * @example GitHub-style — `X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(raw body)>`
 * { signs: 'body', header: 'X-Hub-Signature-256', algorithm: 'hmac-sha256', encoding: 'hex', prefix: 'sha256=' }
 */
export const ApiTriggerSignatureSchema = z
  .discriminatedUnion('signs', [ApiTriggerBodySignatureSchema, ApiTriggerTimestampedSignatureSchema], {
    error: (issue) =>
      issue.code === 'invalid_union'
        ? '`config.signature.signs` says what the sender signs: `body` (the raw body alone, as DocuSign Connect ' +
          'signs it) or `timestamp.body` (`<t>.<raw body>`, as a Stripe-style `t=…,v1=…` sender signs it).'
        : issue.code === 'invalid_type'
          ? '`config.signature` is an object declaring how the sender signs (`signs`, `header`, `algorithm`, ' +
            '`encoding`), never a header name or a key on its own.'
          : undefined,
  })
  .describe(
    'How a third-party sender signs its posts to this inbound hook, verified under the key `config.secretRef` names. ' +
      'Declared, it REPLACES the `x-objectstack-signature` check for this hook: the one verifier, never optional. ' +
      'A trigger that does not implement it refuses every post 401, never admits one unverified.',
  );

export type ApiTriggerSignature = z.input<typeof ApiTriggerSignatureSchema>;
export type ApiTriggerBodySignature = z.input<typeof ApiTriggerBodySignatureSchema>;
export type ApiTriggerTimestampedSignature = z.input<typeof ApiTriggerTimestampedSignatureSchema>;

/**
 * Which verifier an `api` hook has. Exactly one, decided by whether the start
 * node's `config` HAS a `signature` key:
 *
 *  - `objectstack-signature`: no `signature`. The hook verifies
 *    `x-objectstack-signature` under its secret (a literal `secret`, the
 *    write-only flow credential store, or `secretRef`), as before this key.
 *  - `declared`: a usable `signature` and the `secretRef` naming its key. The
 *    hook verifies this scheme and nothing else.
 *  - `unusable`: a `signature` the flow parse refuses (an unparsable shape, a
 *    reserved `header` among them, no usable key reference, a literal `secret` beside
 *    it). A hook in this state admits no post: every post to it gets the one
 *    `401 INVALID_SIGNATURE`, whether the trigger declines to arm the
 *    declaration or refuses each post. It is ⛔ never read as
 *    `objectstack-signature`, so a broken declaration cannot fall back to the
 *    platform's check, and never admitted unsigned.
 */
export type ApiTriggerVerifier =
  | { readonly kind: 'objectstack-signature' }
  | { readonly kind: 'declared'; readonly signature: ApiTriggerSignature; readonly secretRef: string }
  | { readonly kind: 'unusable' };

/** One refusal, at a path relative to the flow (`['nodes', 0, 'config', 'signature', 'encoding']`). */
export interface ApiTriggerSignatureRefusal {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function has(config: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(config, key);
}

/**
 * Every refusal one start node's `config.signature` raises that does not
 * depend on the flow around it, at paths relative to that `config`. Empty for
 * a `config` with no `signature`. The judge {@link apiTriggerSignatureRefusals}
 * and the reader {@link apiTriggerVerifierOf} share it, so the two cannot
 * disagree about which declarations are usable.
 */
function signatureConfigRefusals(config: Record<string, unknown>): ApiTriggerSignatureRefusal[] {
  if (!has(config, API_TRIGGER_SIGNATURE_KEY)) return [];
  const out: ApiTriggerSignatureRefusal[] = [];
  const parsed = ApiTriggerSignatureSchema.safeParse(config[API_TRIGGER_SIGNATURE_KEY]);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      out.push({ path: [API_TRIGGER_SIGNATURE_KEY, ...(issue.path as Array<string | number>)], message: issue.message });
    }
  } else if (parsed.data.signs === 'timestamp.body' && parsed.data.timestampElement === parsed.data.digestElement) {
    out.push({
      path: [API_TRIGGER_SIGNATURE_KEY, 'digestElement'],
      message:
        `\`config.signature\` names the element \`${parsed.data.digestElement}\` for both the timestamp and the digest. ` +
        'They are two elements of the header (`t` and `v1` in `t=…,v1=…`); name each one.',
    });
  }
  if (has(config, 'secret')) {
    out.push({
      path: [API_TRIGGER_SIGNATURE_KEY],
      message:
        'The start node declares `config.signature` beside a literal `config.secret`. A sender\'s signature is ' +
        'verified only under a key named by reference, never an inline one: name the key in `config.secretRef` (the ' +
        'deployment fills that name) and remove `secret`.',
    });
  } else if (!has(config, API_TRIGGER_SECRET_REF_KEY)) {
    out.push({
      path: [API_TRIGGER_SIGNATURE_KEY],
      message:
        '`config.signature` declares how the sender signs, but the start node names no key to verify it under. Name ' +
        'the key in `config.secretRef` (an environment variable\'s name the deployment fills, such as ' +
        '`DOCUSIGN_CONNECT_KEY`). A vendor key is never written inline.',
    });
  }
  return out;
}

/**
 * The verifier a start node's `config` declares for its hook — the one reader
 * the engine, the trigger and the lint share, so none restates the rule. See
 * {@link ApiTriggerVerifier} for the three answers. Structural: a `config` that
 * is not an object answers `objectstack-signature`, as it declares nothing.
 */
export function apiTriggerVerifierOf(config: unknown): ApiTriggerVerifier {
  if (!isRecord(config) || !has(config, API_TRIGGER_SIGNATURE_KEY)) return { kind: 'objectstack-signature' };
  if (signatureConfigRefusals(config).length > 0) return { kind: 'unusable' };
  const secretRef = apiTriggerSecretRefOf(config);
  // An unusable `secretRef` is refused by its own judge, not this one; it
  // still leaves the verifier without a key.
  if (secretRef === undefined) return { kind: 'unusable' };
  return {
    kind: 'declared',
    signature: ApiTriggerSignatureSchema.parse(config[API_TRIGGER_SIGNATURE_KEY]),
    secretRef,
  };
}

/**
 * Every refusal the start nodes of `flow` raise for `config.signature` — the
 * six in this module's header. Structural, like
 * {@link resolveFlowTriggerKind}: a value that is not a flow yields none.
 */
export function apiTriggerSignatureRefusals(flow: unknown): ApiTriggerSignatureRefusal[] {
  if (!flow || typeof flow !== 'object') return [];
  const nodes = (flow as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const bindsApi = resolveFlowTriggerKind(flow) === 'api';
  const out: ApiTriggerSignatureRefusal[] = [];
  nodes.forEach((node, index) => {
    if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'start') return;
    const config = (node as { config?: unknown }).config;
    if (!isRecord(config) || !has(config, API_TRIGGER_SIGNATURE_KEY)) return;
    const own = signatureConfigRefusals(config);
    for (const refusal of own) out.push({ path: ['nodes', index, 'config', ...refusal.path], message: refusal.message });
    if (own.length === 0 && !bindsApi) {
      out.push({
        path: ['nodes', index, 'config', API_TRIGGER_SIGNATURE_KEY],
        message:
          '`config.signature` declares how an inbound hook\'s sender signs, but this flow binds no inbound `api` ' +
          'trigger, so nothing ever reads it. Declare `type: \'api\'` (or start-node `triggerType: \'api\'`) for a ' +
          'flow that receives signed posts, or remove `signature`.',
      });
    }
  });
  return out;
}
