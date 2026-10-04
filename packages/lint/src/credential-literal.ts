// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module credential-literal
 *
 * **Is this name/value pair a credential typed into metadata as a literal?** —
 * the ONE predicate `@objectstack/lint` answers that question with.
 *
 * ## Why it exists
 *
 * A flow definition is served to every member who can read flows. The flow
 * read projection withholds the credential slots the spec DECLARES (an `api`
 * flow's inbound secret, an `http` node's `signingSecret`), but it cannot
 * withhold a value inside an OPEN map — an `http` node's `config.headers`, a
 * connector node's `connectorConfig.input` — or inside an `http` node's `url`:
 * an open map cannot tell a credential from an ordinary value, and withholding
 * an ordinary value breaks the edit round trip. So a credential an author types
 * into one of those positions is served back, intact, to every flow reader.
 *
 * The platform's supported route for an outbound credential is a declarative
 * connector: its `auth: { type, credentialRef }` names a secrets-layer
 * reference that is resolved at boot and never stored in metadata (ADR-0097
 * §3). The remedy ruled for the open positions is therefore a steer, not a
 * projection: the describes say it, and an author-time ADVISORY
 * (`flow-credential-literal`, `lint-flow-credential-literals.ts`) names the
 * literal and the connector route at every authoring door. Nothing is withheld.
 *
 * ## The rule
 *
 * Measured first as an exposure scanner over this repository and a downstream
 * app (0 literals in either), then ruled into this module whole — the rule is
 * that scanner's R1/R2, unchanged:
 *
 *  - **R1 — the name.** Lower-cased, with `_` read as `-`, the name is
 *    `authorization`, `proxy-authorization` or `cookie`; or it contains one of
 *    the pairs `api-key`, `private-key`, `access-key`, `client-secret`; or one
 *    of its segments — split on `-`, and on camelCase humps, so `apiKey` and
 *    `clientSecret` split too — is a credential word (`auth`, `token`,
 *    `secret`, `password`, …) or two adjacent segments form one of the pairs.
 *  - **R2 — the value.** It opens with an auth scheme followed by a
 *    credential: `Bearer x`, `Basic x`, `Token x`, `Digest x`, `ApiKey x` —
 *    whatever the name is.
 *
 * A pair is credential-shaped when R1 or R2 holds AND the value is a
 * **literal**: a non-blank string carrying no `{…}` platform template. A
 * template (`Bearer {api_token}`) is resolved per run from flow variables — the
 * pattern is `http-nodes.ts`'s own interpolation token, `/\{([^{}]+)\}/g` in
 * `template.ts` — so it is not a credential sitting in the definition, and it
 * draws nothing. A non-string value draws nothing either: the positions this
 * guards hold strings, and a `true` / `3600` under a credential-sounding name
 * is a setting, not a secret.
 *
 * ## One home
 *
 * The name lists below are module-private and read by
 * {@link isCredentialShapedLiteral} alone. ⛔ Never copy them into a rule, a
 * test helper, the CLI or a runtime: a second list is a second rule, and the
 * two drift. A caller that needs the verdict asks this function.
 *
 * ## A heuristic — so its callers ADVISE, never refuse
 *
 * A key named `token` can hold something that is not a secret, and a
 * credential can hide under a name this rule does not know. A false positive
 * must therefore cost the author a line of reading, never a blocked save: every
 * caller reports at `warning`, and the rule that uses this predicate is
 * registered `tier: 'advisory'`, which the registry's wiring guard verifies by
 * reading its source. Promoting it to a refusal is a triage decision first.
 */

/** Names that are a credential header in full. */
const CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
]);

/** A name segment that reads as a credential on its own. */
const CREDENTIAL_NAME_SEGMENTS: ReadonlySet<string> = new Set([
  'auth',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'credentials',
  'apikey',
  'bearer',
  'jwt',
  'session',
]);

/** Two adjacent segments that read as a credential together. */
const CREDENTIAL_NAME_PAIRS: readonly string[] = ['api-key', 'private-key', 'access-key', 'client-secret'];

/** R2: an auth scheme followed by a credential. */
const AUTH_SCHEME_VALUE = /^\s*(?:bearer|basic|token|digest|apikey)\s+\S/i;

/** A `{…}` platform template — the `http` executor's own interpolation token. */
const PLATFORM_TEMPLATE = /\{[^{}]+\}/;

/** R1. */
function isCredentialName(name: string): boolean {
  const flat = name.toLowerCase().replace(/_/g, '-');
  if (CREDENTIAL_NAMES.has(flat)) return true;
  if (CREDENTIAL_NAME_PAIRS.some((pair) => flat.includes(pair))) return true;
  const segments = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/_/g, '-')
    .split('-');
  if (segments.some((segment) => CREDENTIAL_NAME_SEGMENTS.has(segment))) return true;
  for (let i = 0; i + 1 < segments.length; i++) {
    if (CREDENTIAL_NAME_PAIRS.includes(`${segments[i]}-${segments[i + 1]}`)) return true;
  }
  return false;
}

/**
 * `true` when `value` is a LITERAL credential under `name`: a non-blank string
 * with no `{…}` template whose name reads as a credential (R1) or whose value
 * opens with an auth scheme and a credential (R2).
 *
 * `name` is the key the value sits under — a header name, a connector input
 * key at any depth, or a query parameter name read out of a url.
 *
 * @example
 * isCredentialShapedLiteral('Authorization', 'Bearer abc')   // true  (R1 + R2)
 * isCredentialShapedLiteral('x-api-key', 'abc')              // true  (R1)
 * isCredentialShapedLiteral('X-Custom', 'Bearer abc')        // true  (R2)
 * isCredentialShapedLiteral('Authorization', 'Bearer {tok}') // false (a template)
 * isCredentialShapedLiteral('X-Trace', 'abc')                // false
 */
export function isCredentialShapedLiteral(name: string, value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (PLATFORM_TEMPLATE.test(value)) return false;
  return isCredentialName(name) || AUTH_SCHEME_VALUE.test(value);
}
