// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The client-address trust rule: the ONE answer to "which address made this
 * request", for every consumer that keys a decision on it.
 *
 * ## The rule
 *
 *  - Forwarded headers are believed **only** when the deployment declares
 *    `server.trustProxy`. Untrusted, those headers are caller input, and a
 *    decision keyed on them is a decision the caller makes.
 *  - The trusted-network form, `server.trustProxy: { networks, header }`,
 *    believes them only from a transport peer inside `networks`. The header it
 *    names is then read: `X-Forwarded-For` (the default), every header line
 *    merged, walked right to left past each hop inside `networks`, the first
 *    entry outside them being the client; or `X-Real-IP`, read only when the
 *    form names it. A peer outside `networks` is the client itself.
 *  - `server.trustProxy: true` believes `X-Forwarded-For` (its leftmost
 *    entry, header lines merged), then `X-Real-IP`, from any peer. That is
 *    sound only behind a proxy that OVERWRITES those headers, never one that
 *    appends to them, and the rule warns once per process when a multi-entry
 *    `X-Forwarded-For` arrives under it.
 *  - Otherwise the address is the transport's own peer address
 *    (`IHttpRequest.remoteAddress`, `@objectstack/spec` `contracts/http-server.ts`),
 *    which a client cannot influence.
 *  - Neither available ⇒ `undefined`: the address is UNDETERMINED. This never
 *    fabricates a value and never substitutes a header for the peer silently.
 *    What "undetermined" means is each consumer's own deliberate decision, made
 *    where the consumer is: the inbound rate limiter keys one shared bucket
 *    (over-throttling rather than failing open), and the ADR-0069 D5 allow-list
 *    refuses the request. A trusted hop that reports an entry which is not an
 *    address establishes none.
 *
 * ## Consumers (each hands over the same three facts)
 *
 *  - `@objectstack/runtime` `security/inbound-rate-limit.ts` `resolveRateLimitKey`:
 *    the key of an anonymous caller's bucket.
 *  - `AuthManager.resolveClientAddress` (this package): the address the
 *    ADR-0069 D5 allow-list judges and the D7 login audit stamps as
 *    `last_login_ip` — and the only address `AuthManager.handleRequest` hands
 *    the vendored auth library's own reader (`client-address-vendor.ts`).
 *
 * ## Why it lives here
 *
 * `@objectstack/runtime` depends on this package (it already counts through the
 * `./rate-limit-storage` entry), so the rule cannot stay in the runtime and be
 * read from plugin-auth: that would close a dependency cycle. It moved here
 * unchanged and the runtime imports it back. It is published as its own
 * `./client-address` subpath entry, like `./rate-limit-storage`, so the runtime
 * reaches it without loading the better-auth family (see `tsup.config.ts`).
 * ⛔ Keep this module free of imports: a value import here becomes a load-time
 * dependency of every consumer of the entry. The two exceptions are internal
 * and themselves import-free: the list of forwarded headers the rule reads,
 * from `./client-address-forwarding.ts` (#24877), and the one reading of an
 * address range, from `./ip-range.ts`, which the allow-list gate shares.
 */

// [#24877] The forwarded headers this rule reads, in the order it believes
// them. The list lives in an internal module so the in-process re-dispatches
// carry exactly these facts without the list being published on this entry.
import { FORWARDED_CLIENT_ADDRESS_HEADERS } from './client-address-forwarding.js';

// ADR-0069 D5 — the one reading of an address and of a range, shared with the
// allow-list gate, so a trusted network matches exactly as an allow-list entry.
import { ipMatchesRange, parseIpRange } from './ip-range.js';

/** The headers the trusted-network form of `server.trustProxy` may name, lower-cased. */
export const TRUSTED_PROXY_HEADERS = Object.freeze(['x-forwarded-for', 'x-real-ip'] as const);

/** One of {@link TRUSTED_PROXY_HEADERS}. */
export type TrustedProxyHeader = (typeof TRUSTED_PROXY_HEADERS)[number];

/**
 * The trusted-network form of `server.trustProxy`, as authored: the proxies
 * this deployment runs, and the one header they set.
 */
export interface TrustedProxyNetworks {
  /**
   * The transport peers whose forwarded header is believed, and the hops the
   * walk of that header skips: each an address or a CIDR range, IPv4 or IPv6,
   * read as the ADR-0069 D5 allow-list reads its entries (`./ip-range.ts`).
   * EVERY address inside them is taken for a proxy hop, so they name the
   * proxies' own addresses, never a range clients connect from. A range of
   * prefix length 0 is refused: it would stand in for `true`.
   */
  readonly networks: readonly string[];
  /** The header those proxies set; `x-forwarded-for` when absent. */
  readonly header?: TrustedProxyHeader;
}

/**
 * `server.trustProxy` as the rule reads it ({@link readTrustProxy}): `false`
 * (no forwarded header believed), `true` (believed from any peer), or the
 * trusted-network form.
 */
export type ClientAddressTrust = boolean | TrustedProxyNetworks;

/** The facts the rule decides from. */
export interface ClientAddressInput {
  /** Request headers, lower-cased as every adapter delivers them. */
  headers?: Record<string, string | string[] | undefined>;
  /** The transport's peer address (`IHttpRequest.remoteAddress`). */
  remoteAddress?: string;
  /** `server.trustProxy`, as {@link readTrustProxy} reads it. */
  trustProxy: ClientAddressTrust;
  /**
   * Where the rule's one operator warning goes ({@link LEGACY_TRUST_PROXY_WARNING}).
   * A consumer with a logger passes its `warn`; without one, nothing is said
   * and the warning stays owed to the next consumer that has one.
   */
  warn?: (message: string) => void;
}

/**
 * The warning the rule logs, at `warn` and once per process, the first time an
 * `X-Forwarded-For` with more than one entry arrives under
 * `server.trustProxy: true`.
 */
export const LEGACY_TRUST_PROXY_WARNING =
  '[server.trustProxy] an X-Forwarded-For header with more than one entry arrived while `server.trustProxy: true` '
  + 'is declared. `true` believes the leftmost entry from any peer, which is sound only behind a reverse proxy that '
  + 'OVERWRITES X-Forwarded-For on every request, never one that appends to it. Declare the proxies instead: '
  + "`server.trustProxy: { networks: ['10.20.0.0/28'] }` with your proxies' own addresses believes the header "
  + 'only from those peers and reads it from the right, past them. `server.trustProxy: true` is refused at boot '
  + 'from the next major. Logged once per process.';

/**
 * The once-per-process latch for {@link LEGACY_TRUST_PROXY_WARNING}. Held on
 * `globalThis` under a registered symbol, not in a module variable: this module
 * is bundled into more than one entry of the package (`tsup.config.ts`,
 * `splitting: false`), and a module variable would be one latch per bundle.
 */
const LEGACY_TRUST_PROXY_WARNED = Symbol.for('@objectstack/plugin-auth/client-address:legacy-trust-proxy-warned');

function warnLegacyTrustProxyOnce(warn: ((message: string) => void) | undefined): void {
  if (!warn) return;
  const latch = globalThis as unknown as Record<symbol, true | undefined>;
  if (latch[LEGACY_TRUST_PROXY_WARNED]) return;
  latch[LEGACY_TRUST_PROXY_WARNED] = true;
  warn(LEGACY_TRUST_PROXY_WARNING);
}

/**
 * Read an authored `server.trustProxy` (or the option a host hands a consumer
 * of the rule) as {@link ClientAddressTrust}. `true` is `true`; an object is the
 * trusted-network form; anything else is `false`, as an undeclared value always
 * was. Every reader of the declaration reads it through this function, so the
 * trusted-network form reaches every consumer of the rule.
 *
 * An object that is not a well-formed trusted-network form is REFUSED, loudly,
 * naming what is wrong: `networks` must be a non-empty list whose every entry
 * is an address or a CIDR range other than one of prefix length 0 (which would
 * stand in for `true`), `header` (default `x-forwarded-for`) one of
 * {@link TRUSTED_PROXY_HEADERS}, and no other key is read. A dropped entry
 * would trust fewer hops than declared, and a dropped form would trust none,
 * and neither would say so.
 */
export function readTrustProxy(value: unknown): ClientAddressTrust {
  if (value === true) return true;
  if (value === null || typeof value !== 'object') return false;
  const refuse = (problem: string): never => {
    throw new Error(
      `[server.trustProxy] invalid trusted-network form: ${problem}. Write it as `
        + "{ networks: ['10.20.0.0/28', '2001:db8::10'], header: 'x-forwarded-for' }: `networks` lists the "
        + "addresses or CIDR ranges of the proxies this deployment runs, and nothing else (every address inside "
        + "them is taken for a proxy), and `header` is 'x-forwarded-for' (the default) or 'x-real-ip', the one "
        + 'header those proxies set.',
    );
  };
  if (Array.isArray(value)) refuse('it is a list, not an object carrying `networks`');
  const form = value as Record<string, unknown>;
  const unknownKeys = Object.keys(form).filter((key) => key !== 'networks' && key !== 'header');
  if (unknownKeys.length > 0) refuse(`unknown key(s) ${unknownKeys.map((k) => JSON.stringify(k)).join(', ')}`);
  const networks = form.networks;
  if (!Array.isArray(networks) || networks.length === 0) refuse('`networks` must be a non-empty list');
  const unreadable = (networks as unknown[]).filter((entry) => parseIpRange(entry) === null);
  if (unreadable.length > 0) {
    refuse(
      `${unreadable.map((entry) => JSON.stringify(entry) ?? String(entry)).join(', ')} `
        + `${unreadable.length === 1 ? 'is' : 'are'} not an IP address or a CIDR range`,
    );
  }
  const everyAddress = (networks as unknown[]).filter((entry) => parseIpRange(entry)?.bits === 0);
  if (everyAddress.length > 0) {
    refuse(
      `${everyAddress.map((entry) => JSON.stringify(entry)).join(', ')} `
        + `${everyAddress.length === 1 ? 'matches' : 'match'} every address (prefix length 0), which would trust `
        + 'every connection as a proxy; name the proxies, or declare `true` if that is what you mean',
    );
  }
  const header = form.header === undefined ? 'x-forwarded-for' : form.header;
  if (!(TRUSTED_PROXY_HEADERS as readonly unknown[]).includes(header)) {
    refuse(`\`header\` ${JSON.stringify(header)} is not one of ${TRUSTED_PROXY_HEADERS.join(', ')}`);
  }
  return Object.freeze({
    networks: Object.freeze([...(networks as string[])]),
    header: header as TrustedProxyHeader,
  });
}

/**
 * Every entry of a header, its lines merged in arrival order: a header sent
 * as several lines is one list (RFC 9110 §5.3), so a later line is never
 * dropped in favour of an earlier one. Blank entries are dropped.
 */
function headerEntries(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string[] {
  if (!headers) return [];
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const lines = (Array.isArray(raw) ? raw : [raw]).filter((line): line is string => typeof line === 'string');
  return lines
    .join(',')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Is `entry` one address (not a range), read as the allow-list reads one? */
function isAddress(entry: string): boolean {
  return !entry.includes('/') && parseIpRange(entry) !== null;
}

/**
 * Is `address` inside one of `networks`? A range of prefix length 0 counts for
 * nothing here, whoever handed it over: {@link readTrustProxy} refuses it, and
 * a value that skipped that reading must not stand in for `true` either.
 */
function insideNetworks(address: string, networks: readonly string[]): boolean {
  return networks.some((range) => parseIpRange(range)?.bits !== 0 && ipMatchesRange(address, range));
}

/** `server.trustProxy: true`: the leftmost `X-Forwarded-For` entry, then `X-Real-IP`, from any peer. */
function believedFromAnyPeer(input: ClientAddressInput): string | undefined {
  for (const name of FORWARDED_CLIENT_ADDRESS_HEADERS) {
    const entries = headerEntries(input.headers, name);
    if (entries.length === 0) continue;
    if (name === 'x-forwarded-for' && entries.length > 1) warnLegacyTrustProxyOnce(input.warn);
    return entries[0];
  }
  return undefined;
}

/**
 * The trusted-network form: the named header, believed only from a peer inside
 * `networks`, walked right to left past every hop inside them.
 */
function believedFromTrustedNetworks(input: ClientAddressInput, trust: TrustedProxyNetworks): string | undefined {
  const peer = input.remoteAddress ? input.remoteAddress : undefined;
  if (!peer || !Array.isArray(trust.networks) || !insideNetworks(peer, trust.networks)) return peer;
  // The header defaults as authored, and is held to the closed list: a value
  // that skipped `readTrustProxy` and names any other header believes none.
  const header = trust.header ?? 'x-forwarded-for';
  if (!(TRUSTED_PROXY_HEADERS as readonly unknown[]).includes(header)) return peer;
  const entries = headerEntries(input.headers, header);
  if (entries.length === 0) return peer;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    // A trusted hop reported something that is not an address: no address is
    // established from it, and the walk does not guess past it.
    if (!isAddress(entry)) return undefined;
    if (i === 0 || !insideNetworks(entry, trust.networks)) return entry;
  }
  return undefined;
}

/**
 * The address the server has established for this request, or `undefined`
 * when it has established none. See the module header for the rule.
 */
export function resolveClientAddress(input: ClientAddressInput): string | undefined {
  const trust = input.trustProxy;
  let address: string | undefined;
  if (trust === true) address = believedFromAnyPeer(input) ?? input.remoteAddress;
  else if (trust && typeof trust === 'object') address = believedFromTrustedNetworks(input, trust);
  else address = input.remoteAddress;
  return address ? address : undefined;
}
