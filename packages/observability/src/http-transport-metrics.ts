// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IHttpServer } from '@objectstack/spec/contracts';
import type { MetricsRegistry } from './contracts.js';
import { RUNTIME_METRICS } from './semconv.js';

/**
 * What an `arm*` call in this module did:
 *
 *  - `'armed'` — the emitting observer was registered on this call.
 *  - `'already-armed'` — some earlier caller already armed this server for
 *    THIS metric family; the seam emits it, and this call registered nothing
 *    (first-wins).
 *  - `'unsupported'` — the transport does not implement the
 *    `IHttpServer.afterResponse` seam; it reports NO HTTP metrics (#9835:
 *    zero there means "not instrumented", never "no traffic"), and the
 *    caller must decide how to degrade — the runtime dispatcher falls back
 *    to instrumenting its own routes.
 */
export type ArmHttpMetricResult = 'armed' | 'already-armed' | 'unsupported';

/**
 * The name {@link armHttpRequestCounter} shipped with. Kept as an alias
 * rather than renamed: the export is already in the pending release, and the
 * two families arm through separate entry points anyway.
 */
export type ArmHttpRequestCounterResult = ArmHttpMetricResult;

/**
 * The per-server latch behind the contract's ownership rule. A registered
 * global-registry symbol (`Symbol.for`), not a module-level WeakSet, so the
 * latch cannot fork if two copies of this module ever coexist in one
 * process — the whole point is that there is exactly ONE latch per server
 * object, whoever asks.
 */
const HTTP_REQUEST_COUNTER_ARMED = Symbol.for(
    'objectstack.observability.httpRequestCounterArmed',
);

/**
 * Arm `http_requests_total{method,route,status}` on a transport through the
 * `IHttpServer.afterResponse` observation seam (#9835) — AT MOST ONCE per
 * server, whoever calls first.
 *
 * ## Why arming is centralized here
 *
 * The contract's ownership rule says a request must never be double-counted,
 * and two composition layers legitimately hold both a server and a metrics
 * registry: the transport's own hosting plugin (`HonoServerPlugin`, which
 * the 2026-08-18 ruling on #9650 made the counter's home) and the runtime
 * dispatcher (whose `observability.metrics` config is the wiring the docs
 * demonstrate). When a host hands ONE registry to both — the ordinary case —
 * two independently-registered observers would land every request on the
 * same series twice: exactly the #9833 distortion, rebuilt one seam over.
 * Routing every arming through this function makes "exactly one
 * counter-emitting observer per server" structural: the first caller arms
 * (in the shipped composition that is the transport plugin, in Phase 1),
 * every later caller is told the seam already counts.
 *
 * The label shape is pinned by the contract: `route` is the transport's
 * `routePattern` — the registered PATTERN, never the concrete path — and
 * `status` is stringified for the label set. Emission goes through the
 * transport's observer-isolation guarantee, so a throwing registry cannot
 * break a response.
 *
 * @param server - The transport. Pass the RAW registered `http.server`
 *   instance, not a wrapper: the latch is per object identity, and a wrapper
 *   would both fork the latch and (per #5122) risk erasing the optional
 *   member this function feature-detects.
 * @param metrics - The registry the counter lands in. First caller wins; a
 *   second registry offered later is NOT added (the contract's one-owner
 *   rule), and the result says so.
 */
export function armHttpRequestCounter(
    server: IHttpServer,
    metrics: MetricsRegistry,
): ArmHttpMetricResult {
    if (typeof server.afterResponse !== 'function') return 'unsupported';
    const latched = server as IHttpServer & { [HTTP_REQUEST_COUNTER_ARMED]?: boolean };
    if (latched[HTTP_REQUEST_COUNTER_ARMED]) return 'already-armed';
    latched[HTTP_REQUEST_COUNTER_ARMED] = true;
    server.afterResponse((observation) => {
        metrics.counter(RUNTIME_METRICS.httpRequestsTotal, {
            method: observation.method,
            route: observation.routePattern,
            status: String(observation.status),
        });
    });
    return 'armed';
}

/**
 * The duration family's own latch. A SEPARATE registered symbol from the
 * counter's, deliberately: the two families are armed through separate entry
 * points and gated separately on the dispatcher's per-route wrapper, so a
 * host that arms one must not silently latch the other away.
 */
const HTTP_REQUEST_DURATION_ARMED = Symbol.for(
    'objectstack.observability.httpRequestDurationArmed',
);

/**
 * Arm `http_request_duration_ms{method,route}` on a transport through the
 * `IHttpServer.afterResponse` observation seam — AT MOST ONCE per server,
 * whoever calls first. The duration half of #9834, built on the mechanism
 * #9835 proved out for `http_requests_total`.
 *
 * ## Why the histogram has to move too
 *
 * #9835 moved only the counter, which left the docs' two derived signals
 * inconsistent with each other: 5xx rate saw every inbound surface while p95
 * latency still saw the dispatcher's own routes. An operator reading one
 * dashboard got request volume for `/api/v1/*` beside a latency panel with no
 * series for it — and the worse reading is the p95 that IS drawn, computed
 * from dispatcher routes only and presented as the server's.
 *
 * ## ⚠️ The observation WINDOW changes with the emitter
 *
 * The dispatcher's per-route wrapper timed `await handler(req, res)` — handler
 * latency. This seam times the transport's own `use('*')` around
 * `await next()`, which is what {@link HttpResponseObservation.elapsedMs}
 * means: "from the transport first seeing the request to the response
 * existing". That includes the middleware chain and body parse, so the series
 * can only move UP, never down. It is the number an operator's latency panel
 * should have been showing — the request's latency rather than one layer's
 * share of it — but it is a visible change in an existing series, so it is
 * stated here, in the changeset, and in `docs/OBSERVABILITY.md` rather than
 * left for a dashboard to discover.
 *
 * The label set is unchanged and stays the SEMCONV-declared `{method,route}`:
 * `route` is the transport's `routePattern` (the registered PATTERN, never the
 * concrete path), and no `status` label is added — a histogram split by status
 * is a different series shape than the one the docs tell operators to graph.
 *
 * @param server - The transport. Pass the RAW registered `http.server`
 *   instance, not a wrapper — the latch is per object identity, and (per
 *   #5122) a wrapper risks erasing the optional member this feature-detects.
 * @param metrics - The registry the histogram lands in. First caller wins.
 */
export function armHttpRequestDurationHistogram(
    server: IHttpServer,
    metrics: MetricsRegistry,
): ArmHttpMetricResult {
    if (typeof server.afterResponse !== 'function') return 'unsupported';
    const latched = server as IHttpServer & { [HTTP_REQUEST_DURATION_ARMED]?: boolean };
    if (latched[HTTP_REQUEST_DURATION_ARMED]) return 'already-armed';
    latched[HTTP_REQUEST_DURATION_ARMED] = true;
    server.afterResponse((observation) => {
        metrics.histogram(
            RUNTIME_METRICS.httpRequestDurationMs,
            observation.elapsedMs,
            { method: observation.method, route: observation.routePattern },
        );
    });
    return 'armed';
}
