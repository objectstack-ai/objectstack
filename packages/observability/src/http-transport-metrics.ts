// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IHttpServer } from '@objectstack/spec/contracts';
import type { MetricsRegistry } from './contracts.js';
import { RUNTIME_METRICS } from './semconv.js';

/**
 * What {@link armHttpRequestCounter} did:
 *
 *  - `'armed'` — the counter-emitting observer was registered on this call.
 *  - `'already-armed'` — some earlier caller already armed this server; the
 *    seam counts, and this call registered nothing (first-wins).
 *  - `'unsupported'` — the transport does not implement the
 *    `IHttpServer.afterResponse` seam; it reports NO HTTP metrics (#9835:
 *    zero there means "not instrumented", never "no traffic"), and the
 *    caller must decide how to degrade — the runtime dispatcher falls back
 *    to counting its own routes.
 */
export type ArmHttpRequestCounterResult = 'armed' | 'already-armed' | 'unsupported';

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
): ArmHttpRequestCounterResult {
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
