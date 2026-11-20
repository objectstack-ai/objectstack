// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23050 slice 7] The API-description routes of `RestServer` — the discovery
 * document (`GET {basePath}` and `GET {basePath}/discovery`) and the OpenAPI
 * document (`GET {basePath}/openapi.json`) — moved out of `rest-server.ts`
 * whole. Both registrars run once per mounted base, so an environment-scoped
 * deployment mounts each family twice.
 *
 * [#25104] The OpenAPI document's HTML viewer page, `GET {basePath}/docs`,
 * moved here with it and has since been RETIRED on both route shapes: nothing
 * read it, and the API origin serves no HTML viewer. A request to that path
 * meets the host's ordinary not-found answer; the machine-readable document
 * stays. `rest-docs-viewer-retired.pin.test.ts` pins both halves.
 *
 * A MOVE, not a redesign. The two functions below are the bodies of
 * `RestServer#registerDiscoveryEndpoints` and
 * `RestServer#registerOpenApiEndpoints` as they stood, each re-indented one
 * level — the same routes, registered in the same order, by the same
 * handlers, answering the same bodies. Every path expression (`basePath`,
 * `realBase`, `unscopedBase`) is as written. The imports only these bodies
 * read moved with them; the two
 * registrars share ONE module because they are the one API-description family
 * (`/discovery` advertises the surfaces `/openapi.json` describes), and they
 * still share no code, exactly as before.
 *
 * ## How the moved bodies reach the class
 *
 * The shape slice 1 set (`data-action-routes.ts`' header carries the full
 * reasoning), with slice 2's refinement. The class keeps both private methods
 * — the published `dist/*.d.ts` lists their names, docblocks and positions —
 * and each body is one host literal ({@link DiscoveryRouteHost},
 * {@link OpenApiRouteHost}) plus `.call(host, basePath)`. A method is handed
 * over as a closure that calls it on the server at call time, so a test double
 * or spy set on the server is still the one the body reaches.
 *
 * Each field was checked on its own, not inherited from an earlier slice:
 *
 * - `routeManager` goes BY VALUE. Both bodies read it only for their
 *   `register` calls, all of which run while registration runs, and the
 *   class's one `routeManager` reassignment wraps
 *   `registerMetadataEndpointsInner`, never these registrars.
 * - `config` goes as a GETTER in both literals. Every read of it in either
 *   body is inside a handler, so it happens at REQUEST time, and the field is
 *   not `readonly`, so a value copied at registration could part from it. The
 *   getter reads the field the handler read, when it read it.
 *
 * ## The one line that is not byte-identical
 *
 * The OpenAPI body overlays the publisher's identity on the served `info`
 * through the class's PRIVATE STATIC `overlayDocumentationInfo`, which it used
 * to call as `RestServer.overlayDocumentationInfo(…)`. A private static is
 * reachable by name only inside the class, so that spelling does not compile
 * here, and making the member public, or moving it, changes the published
 * declaration the move must keep byte-identical. So it is reached the way
 * every other class member these bodies read is reached: through the host, as
 * `this.overlayDocumentationInfo(…)`, a closure on {@link OpenApiRouteHost}
 * that calls `RestServer.overlayDocumentationInfo` with the same two
 * arguments. The member is pure (its only inputs are its arguments), so the
 * receiver is the whole difference. That one call's receiver is the only token
 * of either body that changed.
 *
 * Module-level helpers stay where they were: the one the discovery body reads
 * from `rest-server.ts` itself, `DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS`, was
 * already exported, and is imported from there; it is read only at request
 * time, so the two modules importing each other cannot see it uninitialised.
 * No export was added anywhere, and the published surface does not move.
 */

// [#4024] The flag half of the `/discovery` document's `mcp` advertisement: on
// unless `OS_MCP_SERVER_ENABLED=false` opts the environment out. The serveable
// half is the class's `probeMcpServeable`, reached through the host.
import { isMcpServerEnabled } from '@objectstack/types';
import { handleRouteError, sendThrownError } from './error-response.js';
import { logError } from './log.js';
// [#5040 E6] The `api`-metadata endpoints the OpenAPI document folds in.
import { enrichOpenApiWithEndpoints } from './openapi-endpoints.js';
// [#5588] The built-in route section, produced from this server's own mounted
// routes rather than inherited from the static artifact.
import { buildBuiltinPaths } from './openapi-builtin-paths.js';
// [#5224] Enumerated is not served: the matcher's own verdict on which declared
// endpoints the document describes.
import { selectServedEndpoints } from './served-endpoints.js';
import { DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS, type RestProtocol, type RestServer } from './rest-server.js';

/**
 * The `RestServer` members {@link registerDiscoveryEndpoints} reads — every
 * one of them, and no other. Each is typed AS the class member (an indexed
 * access on the class), so a change to a member's signature on the class is a
 * change here too, and naming a member the class does not have is a compile
 * error. See the module header for why `config` is a getter.
 */
export interface DiscoveryRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    resolveProtocol: RestServer['resolveProtocol'];
    probeMcpServeable: RestServer['probeMcpServeable'];
    getDirectMountRouteBases: RestServer['getDirectMountRouteBases'];
    getMountedEmailRouteBase: RestServer['getMountedEmailRouteBase'];
}

/**
 * The `RestServer` members {@link registerOpenApiEndpoints} reads — every one
 * of them, and no other, typed as {@link DiscoveryRouteHost}'s are. Its last
 * member is the class's private STATIC `overlayDocumentationInfo`, typed as
 * the static it is; the module header says why the body reaches it through the
 * host. See the module header for why `config` is a getter.
 */
export interface OpenApiRouteHost {
    readonly config: RestServer['config'];
    readonly routeManager: RestServer['routeManager'];
    resolveExecCtx: RestServer['resolveExecCtx'];
    enforceAuth: RestServer['enforceAuth'];
    loadOpenApiSpec: RestServer['loadOpenApiSpec'];
    getRoutes: RestServer['getRoutes'];
    resolveProtocol: RestServer['resolveProtocol'];
    resolveEndpointMatchAuthority: RestServer['resolveEndpointMatchAuthority'];
    notifyMissingEndpointAuthority: RestServer['notifyMissingEndpointAuthority'];
    overlayDocumentationInfo: (typeof RestServer)['overlayDocumentationInfo'];
}

/**
 * Register the discovery endpoints — `RestServer#registerDiscoveryEndpoints`'
 * body, called by that method with the server as `this`. The method's own
 * docblock, which the published declaration carries, names the route.
 */
export function registerDiscoveryEndpoints(this: DiscoveryRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');
    const discoveryHandler = async (req: any, res: any) => {
            try {
                // [#9292] The document describes the environment the REQUEST
                // names, not the control plane this server was constructed
                // against. `this.protocol` is the host's; ~30 sibling
                // handlers in this file obtain theirs from
                // `resolveProtocol(environmentId, req)`, and `/discovery` —
                // the surface SDKs, codegen and AI clients read (AGENTS.md
                // "Route & surface ownership" #4) — was the one that did not.
                //
                // Measured on a two-kernel host before the fix: the scoped
                // route `/environments/<id>/discovery` served the HOST's
                // document to every environment, so two environments with
                // genuinely different kernels received byte-identical
                // `capabilities`, `services` and `locale`. Everything below
                // this line composes over `discovery`, so the whole document
                // followed the wrong kernel — not only the two capability
                // keys derived from `engine.transaction` and `searchAll`,
                // but every `services` slot, `locale` (from the kernel's own
                // i18n service) and the route keys this handler does not
                // itself overwrite (`analytics`, `automation`, `ai`, `i18n`,
                // `notifications`, `realtime`, `storage`) — an environment's
                // real surfaces missing, the host's advertised in their place.
                //
                // The unscoped route reaches the same resolution and keeps
                // its control-plane answer where one is correct: with no
                // environment in scope `resolveProtocol` falls through to
                // `this.protocol`, so a control-plane boot is unchanged
                // while a single-environment boot (step 3, the default
                // provider) and a hostname-routed host now answer for the
                // kernel that actually serves the request.
                //
                // The placeholder normalisation is `probeMcpServeable`'s,
                // for its reason (#9120): an unsubstituted route pattern is
                // the ABSENCE of an id, not an id, and the shared entry
                // point short-circuits on any truthy explicit value — so
                // `getOrCreate(':environmentId')` would go looking for a
                // kernel named after the pattern.
                const routeParam: string | undefined = req.params?.environmentId;
                const environmentId = isScoped && routeParam !== ':environmentId'
                    ? routeParam
                    : undefined;
                const protocol = await this.resolveProtocol(environmentId, req);
                const discovery = await protocol.getDiscovery();

                // [#11292] `version` is the PRODUCER's, and is deliberately
                // NOT overwritten here. `DiscoverySchema` declares the field
                // under "System Identity", grouped with `name` and
                // `environment` — the "what server is this" question, settled
                // by the #10993 ruling, landed by commits 98ea3443f and 376c70f98.
                //
                // This line used to read `discovery.version =
                // this.config.api.version`, which is a different fact
                // entirely: `normalizeConfig()` defaults it to `'v1'` and the
                // SAME value builds the mounted path (`${basePath}/${version}`
                // → `/api/v1`), so `GET /api/v1/discovery` answered with the
                // path segment the caller had just typed to get there. On the
                // one producer most clients actually hit, the identity field
                // carried no identity.
                //
                // It also masked the producer. `getDiscovery()` derives the
                // value from `OS_RUNTIME_VERSION` (commit 376c70f98) — the same stamp
                // `/health` and the runtime dispatcher's own `/discovery`
                // read (#10993, commit 98ea3443f) — so after #11297 this overwrote a
                // value that already AGREED with the other producer, turning
                // one answer back into two dialects of one field.
                //
                // The API-version fact is not lost: every entry in `routes`
                // below is prefixed with the mounted base path, which is
                // built from `api.version`. It is recoverable from the same
                // document, in the field that means it.

                // Substitute the resolved environmentId into the advertised routes so
                // clients can consume them verbatim (e.g. /api/v1/environments/abc/data).
                const realBase = isScoped
                    ? basePath.replace(':environmentId', req.params?.environmentId ?? ':environmentId')
                    : basePath;

                if (discovery.routes) {
                    // Ensure routes match the actual mounted paths
                    if (this.config.api.enableCrud) {
                        discovery.routes.data = `${realBase}${this.config.crud.dataPrefix}`;
                    }

                    if (this.config.api.enableMetadata) {
                        discovery.routes.metadata = `${realBase}${this.config.metadata.prefix}`;
                    }

                    if (this.config.api.enableUi) {
                        discovery.routes.ui = `${realBase}/ui`;
                    }

                    // MCP (Streamable HTTP) is a default-on core capability —
                    // advertise it unless OS_MCP_SERVER_ENABLED=false opts the
                    // env out, so the objectui Integrations page surfaces the
                    // connect card. The /mcp route is mounted bare (not
                    // project-scoped), so point at the unscoped base. This
                    // `/discovery` (served by @objectstack/rest) is separate
                    // from the dispatcher's getDiscoveryInfo — both must
                    // advertise `mcp` on the same terms.
                    //
                    // Enabled is NOT the same as serveable (#4024). The flag
                    // alone used to gate this, on the reasoning that `os serve`
                    // auto-loads plugin-mcp from the same flag. But that
                    // lockstep belongs to the CLI: `@objectstack/rest` has no
                    // `@objectstack/mcp` dependency, mounts no /mcp route and
                    // performs no auto-load, so an embedder that skips
                    // plugin-mcp had `mcp` advertised here while the route
                    // 501'd — the `declared ≠ enforced` failure #3369 forbids.
                    // A `null` probe means we genuinely cannot tell; keep the
                    // old flag-only answer there rather than hiding a working
                    // endpoint (fail-open, ADR-0057 D10) — the dispatcher's own
                    // discovery is service-aware and stays authoritative.
                    const mcpServeable = await this.probeMcpServeable(req);
                    if (isMcpServerEnabled() && mcpServeable !== false) {
                        const unscopedBase = isScoped
                            ? basePath.replace(/\/(environments|projects)\/:environmentId$/, '')
                            : basePath;
                        discovery.routes.mcp = `${unscopedBase}/mcp`;
                    } else {
                        delete discovery.routes.mcp;
                    }

                    // Align auth route with the versioned base path if present.
                    // Auth is a control-plane concern, so use the unscoped base.
                    //
                    // [#16538] The strip names BOTH spellings, exactly as the MCP
                    // sibling above does. It used to name only the retired
                    // `/projects/:environmentId`, while `isScoped` — the condition
                    // guarding this very branch — keys on `/environments/:environmentId`
                    // alone. So the replace could never match where it ran: it returned
                    // `basePath` unchanged and a scoped `/discovery` advertised
                    // `/api/v1/environments/:environmentId/auth`, keeping both the scope
                    // this comment says to drop and a literal, unsubstituted route
                    // parameter. Pinned in `discovery-per-request-protocol.test.ts`.
                    if (discovery.routes.auth) {
                        const unscopedBase = isScoped
                            ? basePath.replace(/\/(environments|projects)\/:environmentId$/, '')
                            : basePath;
                        discovery.routes.auth = `${unscopedBase}/auth`;
                    }

                    // [#6633] Direct-mount surfaces — the mounted ⇒ advertised
                    // half of ADR-0076 D12. `routes.packages` and
                    // `routes.datasources` are PROJECTIONS of the recorded
                    // direct mounts (#5822): the advertised base is read off
                    // the very route arrays the registrars iterated to mount,
                    // so advertisement and mounting derive from one fact and
                    // cannot drift. Since commit fec784863 those registrars mount at
                    // this server's own `getApiBasePath()` — the single
                    // base — so an `apiPath` deployment advertises
                    // `{apiPath}/packages` and `{apiPath}/datasources`.
                    // That move landed with NO edit in this block, which is
                    // exactly the property #6633 was built to provide.
                    //
                    // A boot that mounted nothing advertises nothing: the
                    // protocol's service-presence `packages` entry is
                    // deleted rather than left to promise a 404 — this
                    // server knows the mount fact, which is strictly better
                    // knowledge than service presence. [#14503] The package
                    // registrar's ONE route (`POST {base}/packages/publish`)
                    // mounts on every boot since #7563, so `routes.packages`
                    // is advertised on every boot at THIS server's base; the
                    // family's reads and delete are served by the runtime
                    // dispatcher's `/packages` domain, the single
                    // implementation. (While the base was keyed on the
                    // registrar's own `GET {base}/packages` copy — never
                    // mounted on a stock boot, where the `package` service
                    // registers after this plugin starts — a stock boot
                    // advertised no `routes.packages` at all.)
                    const direct = this.getDirectMountRouteBases(
                        isScoped ? (req.params?.environmentId ?? ':environmentId') : undefined,
                    );
                    if (direct.packages) discovery.routes.packages = direct.packages;
                    else delete discovery.routes.packages;
                    if (direct.datasources) discovery.routes.datasources = direct.datasources;
                    else delete discovery.routes.datasources;

                    // [#6714] Email surface — same mounted ⇒ advertised
                    // discipline, over the RouteManager recording:
                    // `registerEmailEndpoints` registers
                    // `POST {base}/email/send` at THIS server's base (it
                    // follows `apiPath`), and the advertisement is a
                    // projection of that recorded row — never recomputed —
                    // so the SDK's `getRoute('email')` follows the real
                    // mount instead of the `/api/v1` convention the client
                    // used to hard-code (a live 404 on any `apiPath`
                    // deployment). Not mounted ⇒ not advertised.
                    const emailBase = this.getMountedEmailRouteBase(
                        isScoped ? (req.params?.environmentId ?? ':environmentId') : undefined,
                    );
                    if (emailBase) discovery.routes.email = emailBase;
                    else delete discovery.routes.email;

                    // [#16674] Bring the OTHER half of the document in line
                    // with the same mounted paths. Everything above rewrites
                    // `discovery.routes.*`; `discovery.services.*.route` is
                    // the same address stated per slot, and it was never
                    // brought along -- so a deployment that moved a prefix
                    // got a document that contradicted itself, and the
                    // `services` half pointed at a path with nothing on it.
                    //
                    // A PROJECTION of the finished `routes` map, key by key
                    // (`DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS` above), so the
                    // two halves cannot state different answers whatever a
                    // future substitution does to `routes`. The three guards
                    // are what keep a DEFAULT deployment byte-identical --
                    // the whole point of the fix is that it moves only the
                    // values that are already wrong:
                    //
                    //   1. only a slot the producer actually emitted, and
                    //   2. only one that already declares a `route` -- a
                    //      route-less slot (`cache`/`queue`/`job`, an
                    //      unmounted `realtime` channel) must not GAIN a
                    //      route key here: "no HTTP surface" is a fact this
                    //      handler does not get to overwrite (#4318, D12),
                    //      and inventing the key would also reorder the
                    //      entry for every reader diffing the document;
                    //   3. only from a route key that survived the pass --
                    //      a deleted or absent `routes.X` leaves the slot
                    //      alone rather than blanking it. Withdrawing an
                    //      advertisement is the ADR-0076 D12 question
                    //      #4318 owns, not this card's.
                    //
                    // On a stock boot every write here assigns the string
                    // that was already there, which is why the default
                    // document does not move by a byte.
                    const advertisedServices = discovery.services as
                        | Record<string, { route?: string } | undefined>
                        | undefined;
                    if (advertisedServices) {
                        const mountedRoutes = discovery.routes as unknown as Record<string, unknown>;
                        for (const [routeKey, slots] of Object.entries(DISCOVERY_ROUTE_KEY_TO_SERVICE_SLOTS)) {
                            const mounted = mountedRoutes[routeKey];
                            if (typeof mounted !== 'string' || mounted.length === 0) continue;
                            for (const slot of slots) {
                                const entry = advertisedServices[slot];
                                if (!entry || typeof entry.route !== 'string') continue;
                                entry.route = mounted;
                            }
                        }
                    }
                }

                // Cross-object atomic batch capability (#3298). `declared ===
                // enforced`: advertise it only when THIS server actually mounts
                // the `/batch` route (`api.enableBatch`, gated in
                // registerBatchEndpoints) AND the runtime engine can honour a
                // transaction (the protocol derived that from `engine.transaction`).
                // AND-ing the two keeps us from advertising an endpoint that would
                // 404 (batch disabled) or 501 (engine without `transaction()`), so
                // a client can safely drop its non-atomic fallback on `true`.
                const caps = ((discovery as any).capabilities ??= {}) as Record<
                    string,
                    { enabled: boolean; description?: string }
                >;
                const runtimeSupportsTx = !!caps.transactionalBatch?.enabled;
                caps.transactionalBatch = {
                    enabled: runtimeSupportsTx && this.config.api.enableBatch !== false,
                    description:
                        'Atomic cross-object batch endpoint (POST {basePath}/batch): all-or-nothing '
                        + 'create/update/delete across objects in one transaction, with intra-batch '
                        + '{ $ref: <opIndex> } parent references (ADR-0034).',
                };

                // [#7541] Global search — the same two-layer AND, for the
                // same reason. The protocol answered whether IT can serve a
                // search (`typeof searchAll === 'function'`, the predicate
                // `registerSearchEndpoints` 501s on); this server answers
                // whether it MOUNTED the route at all (`api.enableSearch`,
                // the flag gated in registerRoutes). A deployment that opts
                // out gets a 404, so advertising the protocol's `true`
                // unqualified would re-open the declared ≠ enforced gap one
                // layer up from the one this issue closed. Neither half is a
                // fallback for a wrong bit: each layer states the fact only
                // it knows, and `enabled` is their conjunction.
                //
                // The flag is the NORMALIZED boolean (defaulted in
                // `normalizeConfig`, declared seat in
                // `RestApiConfigSchema.enableSearch` since #11983) — the
                // same field the mount in `registerRoutes` reads, so the
                // two cannot be edited apart.
                caps.search = {
                    enabled: !!caps.search?.enabled && this.config.api.enableSearch,
                };

                // Attach scoping metadata so clients can detect dual-mode routing.
                (discovery as any).scoping = {
                    enabled: this.config.api.enableProjectScoping,
                    resolution: this.config.api.projectResolution,
                    scoped: isScoped,
                    environmentId: isScoped ? req.params?.environmentId : undefined,
                };

                res.json(discovery);
            } catch (error: any) {
                handleRouteError(res, error);
            }
        };

    // Register at basePath (e.g. /api/v1)
    this.routeManager.register({
        method: 'GET',
        path: basePath,
        handler: discoveryHandler,
        metadata: {
            summary: 'Get API discovery information',
            tags: ['discovery'],
        },
    });

    // Register at basePath/discovery (e.g. /api/v1/discovery)
    this.routeManager.register({
        method: 'GET',
        path: `${basePath}/discovery`,
        handler: discoveryHandler,
        metadata: {
            summary: 'Get API discovery information',
            tags: ['discovery'],
        },
    });
}

/**
 * Register the OpenAPI document — `RestServer#registerOpenApiEndpoints`'
 * body, called by that method with the server as `this`. The method's own
 * docblock, which the published declaration carries, names the route and
 * the request-time enrichment of the document.
 */
export function registerOpenApiEndpoints(this: OpenApiRouteHost, basePath: string): void {
    const isScoped = basePath.includes('/environments/:environmentId');

    // [#22430] The API-description document refuses an anonymous caller
    // with the shared anonymous-deny 401, the same body the `/data` and
    // `/meta` routes answer (ADR-0056 D2 is default-deny, and no ADR-0138
    // D2 door class names it). The refusal is the handler's FIRST act:
    // before the bundled artifact is loaded and before any protocol is
    // resolved, so a refused request costs no work and its answer does not
    // even say whether a document is bundled here. A signed-in caller is
    // served exactly as before, under the same ADR-0069 auth-policy gate
    // every other protected route applies.

    const openApiHandler = async (req: any, res: any) => {
        try {
            const environmentId = isScoped ? req.params?.environmentId : undefined;
            const context = await this.resolveExecCtx(environmentId, req);
            if (this.enforceAuth(req, res, context)) return;

            const spec = await this.loadOpenApiSpec();
            if (!spec) {
                res.status?.(503);
                res.json({
                    error: { code: 'OPENAPI_UNAVAILABLE', message: 'OpenAPI spec is not bundled with this runtime.' },
                });
                return;
            }

            // Clone shallowly so per-request mutations (server URL,
            // expanded paths) don't bleed into the cached base spec.
            let enriched: any = { ...spec, servers: [...(spec.servers ?? [])] };

            // 1) Override servers[0] with the actual request origin so a
            //    client built from this document calls the server that
            //    served it.
            const host = req.headers?.host ?? req.headers?.['host'];
            const proto = (req.headers?.['x-forwarded-proto'] as string)
                || (req.protocol as string)
                || 'http';
            if (host) {
                enriched.servers = [
                    { url: `${proto}://${host}`, description: 'Current server' },
                    ...(spec.servers ?? []),
                ];
            }

            // 2) Produce the built-in route section from this server's own
            //    route table and DISCARD whatever the static artifact
            //    carried (#5588, maintainer ruling C). Every row here is a
            //    route the router will match: same table, read at request
            //    time, so the prefix follows `apiPath`, the verbs are the
            //    registered ones, and a route that is not mounted cannot be
            //    described. `getRoutes()` is the whole surface — since
            //    #5822 that includes the direct-mount registrars' routes,
            //    but only the ones this boot actually mounted and reported.
            //    The filtering to THIS base (and away from the project-
            //    scoped mirror, which gets its own document) is
            //    `buildBuiltinPaths`'s.
            const builtin = buildBuiltinPaths(this.getRoutes(), basePath);
            enriched.paths = builtin.paths;
            // The tag list describes that same section, so it is produced
            // with it rather than inherited from the artifact — otherwise a
            // document whose operations carry rest's tags would advertise
            // spec's (`CRUD`/`Metadata`/`Discovery`, which nothing uses).
            enriched.tags = builtin.tags;

            // Metadata-driven enrichment (steps 3 and 4) reads through one
            // resolved protocol, but each step carries its own `try`: they
            // describe different surfaces, and a failure to enumerate one
            // must not silently blank the other.
            let protocol: RestProtocol | undefined;
            try {
                protocol = await this.resolveProtocol(environmentId, req);
            } catch {
                // Enrichment is best-effort — never fail the spec serve.
            }

            // 3) Expand `{object}` path placeholders into concrete
            //    routes for every registered data object. Falls back
            //    silently if discovery isn't available. Since #5588 the
            //    templates it expands are the real ones (`/api/v1/data/
            //    {object}` and its siblings), not the phantom `/api/
            //    {object}`.
            try {
                const items = await protocol?.getMetaItems?.({ type: 'object' }).catch(() => null) as any;
                const objects: string[] = Array.isArray(items?.items)
                    ? items.items.map((i: any) => i?.name).filter(Boolean)
                    : Array.isArray(items)
                      ? items.map((i: any) => i?.name).filter(Boolean)
                      : [];
                if (objects.length > 0 && enriched.paths) {
                    const expanded: Record<string, unknown> = {};
                    for (const [p, def] of Object.entries(enriched.paths)) {
                        if (p.includes('{object}')) {
                            // Keep the template under x-template for tooling
                            // that wants the generic shape, and emit one
                            // concrete copy per registered object.
                            expanded[p] = { ...(def as object), 'x-template': true };
                            for (const obj of objects) {
                                expanded[p.replace('{object}', obj)] = def;
                            }
                        } else {
                            expanded[p] = def;
                        }
                    }
                    enriched.paths = expanded;
                }
            } catch {
                // Enrichment is best-effort — never fail the spec serve.
            }

            // 4) Fold in the endpoints declared as `api` metadata (#5040
            //    E6). Same enumeration root as the `{object}` expansion
            //    above — this document is the ONE documentation face for
            //    `/openapi.json`, which this package alone serves (#5078,
            //    ADR-0076): declared endpoints join it here rather than
            //    growing a second generator somewhere else.
            //
            //    Since the E7 flip a non-empty `apis:` publishes, so this
            //    enumeration returns real declarations on a deployment that
            //    has them and the document grows a path entry per endpoint.
            //    Where nothing is declared the enumeration is empty and
            //    `enrichOpenApiWithEndpoints` hands `enriched` straight
            //    back, byte for byte.
            try {
                const apiResult = await protocol?.getMetaItems?.({ type: 'api' });
                const apiItems: unknown[] = Array.isArray((apiResult as any)?.items)
                    ? (apiResult as any).items
                    : Array.isArray(apiResult) ? apiResult as unknown[] : [];
                const endpointLogger = {
                    error: (message: string, meta?: unknown) =>
                        meta === undefined ? logError(message) : logError(message, meta),
                };

                // [#5224] Enumerated is not served. This document is what
                // SDKs, codegen and AI clients build clients FROM, so it
                // describes only the declarations the endpoint matcher will
                // actually answer — asked of the matcher itself, the sole
                // holder of that verdict. A stored row the matcher cannot
                // see used to arrive here and be published as a real path,
                // `security: []` and all, while every request to it 404'd.
                let documentable: unknown[] = apiItems;
                const authority = apiItems.length > 0
                    ? await this.resolveEndpointMatchAuthority(
                        isScoped ? req.params?.environmentId : undefined,
                        req,
                    )
                    : undefined;
                if (apiItems.length > 0 && !authority) {
                    this.notifyMissingEndpointAuthority('GET /openapi.json');
                } else if (authority) {
                    // The matcher's OWN parsed endpoint is documented, not
                    // the stored JSON: schema defaults are materialized on
                    // it (most importantly `authRequired`), so the document
                    // describes the value the runtime acts on rather than a
                    // re-parse of the same row on a second code path.
                    documentable = (await selectServedEndpoints(apiItems, authority, endpointLogger))
                        .map((s) => s.endpoint);
                }

                enriched = enrichOpenApiWithEndpoints(enriched, documentable, endpointLogger);
            } catch (err: any) {
                // A store that cannot be read must not take the document
                // down with it — but say so, because a silently endpoint-
                // less document looks exactly like a correct one.
                logError('[REST] openapi.json endpoint enrichment skipped:', err?.message ?? err);
            }

            // 5) `info`: the artifact's, with the publisher's identity laid
            //    over it (#20294, ruling B on #20359). `packages/spec`
            //    produces the block (`build-openapi.ts`, pinned by
            //    `openapi-self-consistency.test.ts`); the host may sign it
            //    with the identity members of `api.documentation` —
            //    `title`, `description`, `termsOfService`, and `contact` /
            //    `license` each replaced whole. Nothing authored serves the
            //    artifact's `info` byte for byte, so the served document and
            //    the published `@objectstack/spec/openapi.json` export still
            //    state the same fact about every field nobody signed
            //    (#11646's invariant, now the unset case). The same closure
            //    serves this base and its environment-scoped twin, so both
            //    doors carry the overlay. The helper returns a NEW object:
            //    `enriched.info` is still the cached artifact's own `info`
            //    here (the clone above is shallow), and writing into it
            //    would leak one request's overlay into every later one.
            //
            //    `info.version` is NOT publisher identity, and nothing here
            //    writes it: it stays the artifact's — the protocol version
            //    (#11646) — and `api.documentation.version` is a retired
            //    tombstone the construction-time parse already refused. The
            //    API version identifier this deployment declares
            //    (`api.version`, which `normalizeConfig` defaults to `'v1'`)
            //    lives where it is observable, in the mount
            //    `${basePath}/${version}` -> `/api/v1`. The runtime version
            //    is answered by `{basePath}/discovery` and `/health`, derived
            //    from `OS_RUNTIME_VERSION` (#10993, commit 376c70f98, #11292). OpenAPI
            //    3.1 defines this field as "the version of the OpenAPI
            //    document (which is distinct from the OpenAPI Specification
            //    version or the API implementation version)" — the document
            //    being served IS the artifact, so its version is the
            //    artifact's.
            enriched.info = this.overlayDocumentationInfo(enriched.info, this.config.api.documentation);

            res.json(enriched);
        } catch (error: any) {
            logError('[REST] openapi.json error:', error);
            sendThrownError(res, error);
        }
    };

    this.routeManager.register({
        method: 'GET',
        path: `${basePath}/openapi.json`,
        handler: openApiHandler,
        metadata: {
            summary: 'OpenAPI 3.1 specification (machine-readable)',
            tags: ['openapi'],
        },
    });
}
