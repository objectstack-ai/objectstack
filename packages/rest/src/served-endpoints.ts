// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DECLARED -> SERVED: the filter both machine-readable endpoint faces run
 * before they announce anything (#5224).
 *
 * ## The break this closes
 *
 * `GET /meta/api` and `GET /openapi.json` enumerated `api` items through
 * `protocol.getMetaItems` — ObjectQL's SchemaRegistry plus the `sys_metadata`
 * rows. The thing that decides whether a declared route is actually SERVED is
 * a different reader entirely: `IMetadataService.matchEndpoint` ->
 * `EndpointMatcher` -> `MetadataManager.listForIndex('api')`, which sees the
 * manager's own registry and its registered loaders (`filesystem`, `memory`)
 * and nothing else. A real showcase boot measured the gap exactly: a row
 * written straight through `PUT /meta/api/{name}` is enumerated by
 * `getMetaItems` and invisible to the matcher, so both faces advertised
 * `GET /api/v1/apps/showcase/backdoor` — the OpenAPI one with `security: []`,
 * i.e. as an endpoint needing no credentials — while every request to it
 * answered 404.
 *
 * A wrong answer on `/openapi.json` does not stay on `/openapi.json`: it is
 * the document SDKs, codegen and AI clients build from, so a fabricated public
 * endpoint propagates into everything generated from it. "Machine-readable
 * surfaces must not lie" (AGENTS.md, Route & surface ownership Rule 4;
 * ADR-0076 D12) is the invariant, and this module is how the two faces keep it.
 *
 * ## The shape: the faces ASK the matcher, they do not re-derive it
 *
 * There is exactly one authority on "will this declaration be served" — the
 * endpoint matcher — and it is reachable through a contract method that
 * already exists, `IMetadataService.matchEndpoint`. So this module asks it,
 * once per candidate, and keeps only what comes back. It deliberately does
 * NOT re-implement the matcher's judgement (parse, the ADR-0121 identity-free
 * publish gates, duplicate resolution): a second copy of that judgement is a
 * second truth source, which is the disease and not the cure — and it would go
 * stale the first time the matcher's rules changed, silently, in the direction
 * of announcing more than is served.
 *
 * It equally does not touch the matcher's own data source. Whether
 * `matchEndpoint` and `getMetaItems` should read ONE store is a real and
 * larger architectural question (the issue's first option); this module is
 * correct under either answer, because it never assumes where the matcher
 * looks — only that it is the one that decides.
 *
 * ## Why the match is confirmed by NAME, not by mere presence
 *
 * Two stored items may claim the same METHOD+path. `buildEndpointIndex`
 * resolves that deterministically — lexicographically-first `name` keeps the
 * route — and the loser is served by nobody. Asking "does something own this
 * route" would announce both claimants; asking "does THIS declaration own this
 * route" announces the winner alone, which is what the runtime does. The
 * duplicate rule therefore stays spelled in exactly one place, and this file is
 * not one of them.
 *
 * ## An outage is not an empty set
 *
 * `matchEndpoint` throws when its store cannot be read, precisely so an outage
 * cannot masquerade as a miss (its contract in
 * `packages/spec/src/contracts/metadata-service.ts`, and ADR-0110 D3 for the
 * singular read). This module preserves that: a throw propagates to the caller
 * untouched. Swallowing it into "nothing matched" would turn a store outage
 * into the confident claim that a deployment declares no endpoints — the same
 * class of lie, pointing the other way.
 *
 * ## Omissions are named
 *
 * Every dropped declaration is reported at `error`, in ONE aggregated line per
 * call rather than one per item, naming each omitted declaration and the fact
 * that its route answers 404. An endpoint an author declared and the runtime
 * will not serve is a capability that silently went missing, and absence must
 * be loud (AGENTS.md, Route & surface ownership Rule 3). The message says the
 * face is now telling the truth, so the line is not misread as this filter
 * having broken something.
 */

import type { ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';

/**
 * The one question the faces ask: does the runtime serve this METHOD+path, and
 * which declaration owns it?
 *
 * Structurally `Pick<IMetadataService, 'matchEndpoint'>` with the optionality
 * removed — the same narrow slice `runAppEndpointStep` takes in
 * `@objectstack/runtime`, for the same reason: the caller needs one method, and
 * naming only that method keeps this package free of any dependency on the
 * metadata engine.
 */
export interface EndpointMatchAuthority {
  matchEndpoint(query: { path: string; method: string }): Promise<ApiEndpointMatch | undefined>;
}

/** Where an omitted declaration is reported. */
export interface ServedEndpointLogger {
  error(message: string, meta?: unknown): void;
}

/**
 * A declaration the matcher confirmed it will serve.
 *
 * Both halves are kept on purpose, because the two faces need different ones:
 * `/meta/api` answers with the STORED item (its `_packageId` / `_provenance` /
 * `_diagnostics` decorations are what the Studio list reads), while the OpenAPI
 * document is built from `endpoint` — the matcher's own parsed value, with
 * `ApiEndpointSchema` defaults materialized, i.e. literally the object the
 * runtime will act on.
 */
export interface ServedEndpoint<T> {
  /** The stored item as the enumerating face received it. */
  item: T;
  /** The parsed declaration the matcher resolved this route to. */
  endpoint: ApiEndpoint;
}

/** Read a string property off an unknown stored item. */
function readString(item: unknown, key: string): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const value = (item as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Whether a resolved service can answer the served question at all.
 *
 * `matchEndpoint` is OPTIONAL on `IMetadataService`, so an occupant of the
 * `metadata` slot may not implement it — in which case nothing declared is
 * served either (`runAppEndpointStep` returns `undefined` on exactly this
 * probe), and the caller must decide what to do with an authority it does not
 * have. Probed here so both faces spell the test once.
 */
export function isEndpointMatchAuthority(candidate: unknown): candidate is EndpointMatchAuthority {
  return (
    candidate != null &&
    typeof (candidate as { matchEndpoint?: unknown }).matchEndpoint === 'function'
  );
}

/**
 * Narrow enumerated `api` items to the ones the matcher will actually serve.
 *
 * @param items stored `api` items, exactly as the enumerating face received them.
 * @param authority the endpoint matcher, reached through `matchEndpoint`.
 * @param logger where omissions are named.
 * @returns one entry per served declaration, in input order.
 * @throws whatever `matchEndpoint` threw — an outage is never an empty set.
 */
export async function selectServedEndpoints<T>(
  items: readonly T[],
  authority: EndpointMatchAuthority,
  logger: ServedEndpointLogger,
): Promise<ServedEndpoint<T>[]> {
  const served: ServedEndpoint<T>[] = [];
  const omitted: Array<{ name: string; route: string; reason: string }> = [];

  for (const item of items) {
    const name = readString(item, 'name');
    const path = readString(item, 'path');
    const method = readString(item, 'method');

    if (!name || !path || !method) {
      omitted.push({
        name: name ?? '<unnamed>',
        route: `${method ?? '<no method>'} ${path ?? '<no path>'}`,
        reason: 'declares no usable name/method/path, so no route can resolve to it',
      });
      continue;
    }

    // Deliberately unguarded — see the module header. A store that cannot be
    // read must reach the caller as a failure, not as "nothing is declared".
    const match = await authority.matchEndpoint({ path, method });

    if (!match) {
      omitted.push({
        name,
        route: `${method} ${path}`,
        reason: 'the endpoint matcher resolves this route to no declaration',
      });
      continue;
    }

    if (match.endpoint.name !== name) {
      omitted.push({
        name,
        route: `${method} ${path}`,
        reason: `the endpoint matcher resolves this route to '${match.endpoint.name}' instead`,
      });
      continue;
    }

    served.push({ item, endpoint: match.endpoint });
  }

  if (omitted.length > 0) {
    logger.error(
      `[REST] ${omitted.length} declared api item(s) are OMITTED from this surface because the endpoint ` +
        `matcher will not serve them — their routes answer 404, so announcing them would describe ` +
        `endpoints that do not exist: ` +
        omitted.map((o) => `'${o.name}' (${o.route}) — ${o.reason}`).join('; ') +
        `. This surface now reports only what the runtime serves; to make one of these live, publish it ` +
        `through a gated path (a stack artifact, or \`publishPackage\` with the package's ` +
        `\`manifest.namespace\`) rather than a direct metadata write.`,
      { omitted },
    );
  }

  return served;
}
