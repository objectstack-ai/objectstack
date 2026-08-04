// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Endpoint matcher — the producer side of `IMetadataService.matchEndpoint`.
 *
 * [#5089, #5040 E2] A declared `api` metadata item owns a `method`+`path`
 * pair; this module turns the stored `api` items into a lookup the HTTP
 * dispatcher can perform once per request, between "no built-in domain
 * claimed this path" and "answer a semantic 404".
 *
 * The binding specification is the contract text on
 * `IMetadataService.matchEndpoint` and {@link ApiEndpointMatch} in
 * `packages/spec/src/contracts/metadata-service.ts` (landed by #5080/#5097).
 * This module implements it literally; where the text is silent the choice is
 * documented here rather than invented in a caller.
 *
 * ## What this module is NOT
 *
 * It is not a router. `ApiEndpointSchema.path` is a frozen vocabulary
 * (ADR-0121) that defines no template syntax — no `:param`, no `{param}` — so
 * there is nothing to compile and nothing to rank. Matching is a `Map` lookup
 * on an exact key, and {@link ApiEndpointMatch.params} is always `{}`.
 * Inventing a template syntax here would create a dialect that exists only
 * inside an implementation, which Prime Directive #12 forbids.
 *
 * ## Normalization (both sides, identically)
 *
 * - **method** — upper-cased. `ApiEndpointSchema.method` is already an
 *   upper-case `HttpMethod` enum, so this only ever changes the *query* side,
 *   which is the point: a request verb is compared case-insensitively.
 * - **path** — exactly ONE trailing slash is trimmed, and never from a lone
 *   `/`. Trimming one (not all) keeps `/x//` and `/x/` distinct, matching how
 *   every router in this stack treats an empty path segment; keeping `/`
 *   whole means the normalized form is still a legal `ApiEndpointSchema.path`
 *   and a query for `""` can never collide with a declaration of `/`.
 *   Nothing else happens to the path: **no** percent-decoding, **no** Unicode
 *   normalization, **no** case folding. 17.x compares the raw string. (Design
 *   §7-5 keeps RFC 3986 canonicalization as an explicit open question — it is
 *   a vocabulary-level decision, not an implementation detail to smuggle in.)
 *
 * ## Loud, never half-valid
 *
 * Every stored item is `ApiEndpointSchema.safeParse`-d. The answer handed back
 * is the PARSED object, so schema defaults are materialized — most importantly
 * `authRequired`, which the schema defaults to `true`: a consumer can never
 * read an author's omission as "no auth required". An item that fails to parse
 * is skipped and named at `error` level: an endpoint the author declared and
 * the runtime will not serve is a capability that silently went missing, and
 * "absence must be loud" (AGENTS.md, Route & surface ownership §3). Skipping
 * one bad item never disturbs the good ones.
 *
 * ## Duplicate claims
 *
 * Two stored items may claim the same METHOD+path (publish rejects that inside
 * one stack, but a direct `metadata.register()` write bypasses publish). The
 * resolution is deterministic and announced, never last-write-wins: the
 * endpoint whose `name` sorts FIRST lexicographically keeps the route, and the
 * discarded claimant is named at `error` level together with the winner and
 * the rule. Deterministic because a coin flip would make the same deployment
 * behave differently per node and per boot; loud because a declaration that
 * does not serve is exactly the "declared ≠ enforced" state this repo keeps
 * paying to remove. (#5040 design §1.3.)
 *
 * ## An outage is not a 404
 *
 * `undefined` means "no declaration owns this route". A store that cannot be
 * read must THROW — the same distinction `loadDiagnosed` draws for the
 * singular read (ADR-0110 D3), for the same reason: a miss becomes a 404, and
 * an unreachable metadata store must never masquerade as one. So the read this
 * matcher performs is deliberately NOT wrapped in a `try`/`catch`, and a
 * failed build is not cached — the next call retries against a store that may
 * have recovered.
 */

import { ApiEndpointSchema, normalizeEndpointPath, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { Logger } from '@objectstack/spec/contracts';

/**
 * Upper-case a request verb so `method` compares case-insensitively.
 */
export function normalizeEndpointMethod(method: string): string {
  return String(method ?? '').toUpperCase();
}

/**
 * Trim exactly one trailing slash, never from a lone `/`.
 *
 * Applied to BOTH the stored declaration and the query, so the two sides can
 * never disagree about which form is canonical — and re-exported from
 * `@objectstack/spec/api`, which OWNS the rule (#5040 E7), rather than
 * re-implemented here. The publish gate that rejects two endpoints claiming the
 * same METHOD + path must normalize exactly as this matcher does, or a stack
 * could publish a duplicate the index then silently resolves to one winner.
 */
export { normalizeEndpointPath };

/** The index key for a normalized method+path pair. */
export function endpointIndexKey(method: string, path: string): string {
  return `${normalizeEndpointMethod(method)} ${normalizeEndpointPath(path)}`;
}

/** The lazily-built lookup: `"METHOD /path"` → parsed endpoint. */
export type EndpointIndex = ReadonlyMap<string, ApiEndpoint>;

export interface EndpointMatcherDeps {
  /**
   * Enumerate the stored `api` metadata items.
   *
   * MUST reject when the store cannot be read. Resolving with `[]` on a failed
   * read would turn an outage into "nothing is declared", i.e. into a 404 —
   * precisely what the contract forbids. See `MetadataManager.listForIndex`.
   */
  listApiItems(): Promise<unknown[]>;
  logger: Logger;
}

/**
 * Build the METHOD→path→endpoint index from raw stored items.
 *
 * Exported for tests and for any future occupant of the `metadata` slot that
 * wants the same load-time discipline without inheriting `MetadataManager`.
 */
export function buildEndpointIndex(items: readonly unknown[], logger: Logger): EndpointIndex {
  const index = new Map<string, ApiEndpoint>();

  for (const item of items) {
    const parsed = ApiEndpointSchema.safeParse(item);
    if (!parsed.success) {
      // LOUD skip (contract: "MUST skip (loudly) any stored item that fails to
      // parse rather than returning a half-valid shape"). Name the item so the
      // author can find it; say what the consequence is.
      const declaredName =
        item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
          ? (item as { name: string }).name
          : '<unnamed>';
      logger.error(
        `[EndpointMatcher] stored api item '${declaredName}' does not satisfy ApiEndpointSchema — ` +
          `it is EXCLUDED from endpoint matching and its declared route will answer 404. ` +
          `Fix the declaration (or remove it); the endpoint index never serves a half-valid shape.`,
        undefined,
        { issues: parsed.error.issues },
      );
      continue;
    }

    const endpoint = parsed.data;
    const key = endpointIndexKey(endpoint.method, endpoint.path);
    const incumbent = index.get(key);

    if (!incumbent) {
      index.set(key, endpoint);
      continue;
    }

    // Deterministic + loud: lexicographically-first `name` keeps the route.
    // `<` (not `<=`) keeps the first-seen entry when names are equal, so the
    // rule is total even in the degenerate case.
    const challengerWins = endpoint.name < incumbent.name;
    const winner = challengerWins ? endpoint : incumbent;
    const loser = challengerWins ? incumbent : endpoint;
    if (challengerWins) index.set(key, endpoint);

    logger.error(
      `[EndpointMatcher] duplicate endpoint claim on '${key}': api items '${incumbent.name}' and ` +
        `'${endpoint.name}' both declare it. '${winner.name}' KEEPS the route and '${loser.name}' is ` +
        `IGNORED — the rule is lexicographically-first \`name\` wins, chosen so every node and every ` +
        `boot resolves it identically. Rename or repath '${loser.name}' to make it reachable.`,
      undefined,
      { key, winner: winner.name, ignored: loser.name },
    );
  }

  return index;
}

/**
 * Lazy, invalidating endpoint index.
 *
 * Built on the first {@link match} call and rebuilt on the next call after any
 * {@link invalidate}. Endpoint counts are single- to triple-digit, so a whole
 * rebuild is cheaper than per-item bookkeeping and cannot drift from the store.
 */
export class EndpointMatcher {
  private readonly deps: EndpointMatcherDeps;
  /** Resolved index, or `undefined` while dirty. */
  private index?: EndpointIndex;
  /** In-flight build, so concurrent requests share one store read. */
  private building?: Promise<EndpointIndex>;

  constructor(deps: EndpointMatcherDeps) {
    this.deps = deps;
  }

  /** Mark the index stale; the next {@link match} rebuilds it. */
  invalidate(): void {
    this.index = undefined;
    this.building = undefined;
  }

  /**
   * Resolve `method`+`path` to the owning declaration.
   *
   * @returns the parsed endpoint plus `params: {}`, or `undefined` on a miss.
   * @throws whatever the store read threw — an outage is never a miss.
   */
  async match(query: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> {
    const index = await this.ensureIndex();
    const endpoint = index.get(endpointIndexKey(query.method, query.path));
    if (!endpoint) return undefined;
    // `params` is always {} in 17.x — the frozen vocabulary defines no path
    // template syntax. See ApiEndpointMatch.params.
    return { endpoint, params: {} };
  }

  private async ensureIndex(): Promise<EndpointIndex> {
    if (this.index) return this.index;
    if (this.building) return this.building;

    const build = (async () => {
      // Deliberately NOT guarded: a store read failure propagates to the
      // caller so an outage surfaces as an outage, never as a 404.
      const items = await this.deps.listApiItems();
      return buildEndpointIndex(items, this.deps.logger);
    })();

    this.building = build;
    try {
      const built = await build;
      // Only publish the result if no invalidation raced us mid-build.
      if (this.building === build) {
        this.index = built;
        this.building = undefined;
      }
      return built;
    } catch (error) {
      // A failed build is never cached — the next request retries against a
      // store that may have recovered.
      if (this.building === build) this.building = undefined;
      throw error;
    }
  }
}
