// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'http-request-errors-total-retired',
  surface:
    'observability.SEMCONV.httpRequestErrorsTotal (the published metric name '
    + 'http_request_errors_total{method,route}, and its emission from the runtime '
    + "dispatcher's per-route wrapper)",
  replacement:
    'the 5xx rate is `http_requests_total{status=~"5.."}` — the TRANSPORT emits that family '
    + 'through the `IHttpServer.afterResponse` seam, so it covers every inbound surface; '
    + 'unhandled-exception rate specifically, which is the one thing the retired counter '
    + 'uniquely reported, is the `errorReporter` (Sentry / Datadog / your adapter), which '
    + 'still fires on every 5xx throw',
  reason:
    'ADR-0049 enforce-or-remove, on a DECLARED-not-enforced metric name. `SEMCONV` '
    + 'published `http_request_errors_total` as part of a stable namespace declared "so '
    + 'hosts can wire alerts/dashboards against it", but the only emitter was '
    + '`@objectstack/runtime`\'s `instrumentRouteHandler`, applied only by the dispatcher\'s '
    + 'own route Proxy — so the series never saw auth\'s `getRawApp()` mount, the REST data '
    + 'API via `RouteManager`, or any other inbound surface. Its two siblings in the same '
    + 'family were moved to the transport seam (#9650/#9835 for the counter, #9834/#10004 '
    + 'for the histogram) and this one could not follow: `HttpResponseObservation` carries '
    + '`{method, routePattern, status, elapsedMs}` and NO throw signal of any kind, so every '
    + 'transport-side shape would have counted a DIFFERENT population rather than the same '
    + 'one more widely. The divergence was measured in both directions — the dispatcher '
    + 'answers its own errors through `errorResponseBase`, which sets a status and does not '
    + 're-throw, so the old counter MISSED those, while its `catch` incremented '
    + 'unconditionally, so a thrown 4xx WAS counted as an error. And `http_requests_total` '
    + 'already carries a `status` label, so a status-class error counter would be fully '
    + 'derivable from data the transport already publishes. Maintainer ruling 2026-08-20 '
    + '(option C of four presented, over B "move it to the transport as a status class" and '
    + 'D "keep it dispatcher-scoped and rename it"): RETIRE. A metric NAME is a RESPONSE '
    + 'surface, not authorable metadata — no stack, example or template carries it, so there '
    + 'is no source for a D2 conversion to rewrite and no schema to tombstone; a host names '
    + 'the series in its own dashboard or alert file, outside this repo. That is exactly why '
    + 'this entry exists: for an operator whose Grafana keys on the string, the ledger is the '
    + 'only notification channel there is. Same disposition, and the same reason, as '
    + '`runtime-httpserver-wrapper-retired` (#5122) and `enhanced-api-error-field-errors-renamed` '
    + '(#3977). ADR-0049 / ADR-0087, #9834.',
  acceptanceCriteria:
    'No dashboard, alert rule or exporter config names `http_request_errors_total`: the '
    + 'series stops receiving samples the moment 17.2.0 is deployed, so a panel keyed on it '
    + 'draws a flat zero that reads as a healthy server rather than as a removed metric — '
    + 'the one failure mode this retirement can produce, and the reason the changeset '
    + 'announces it loudly. A 5xx-rate panel or alert is rewritten to '
    + '`http_requests_total{status=~"5.."}` and then PROVEN wider, not merely non-empty: '
    + 'make an auth route or a REST data-API route answer 5xx and confirm the new query '
    + 'moves, where the retired counter would not have moved at all. If the signal you were '
    + 'actually alerting on was "a handler threw rather than returning an error envelope", '
    + 'that is the `errorReporter`, not a counter — wire an APM adapter and assert one '
    + 'synthetic 5xx throw arrives. In code, `SEMCONV.httpRequestErrorsTotal` and '
    + '`RUNTIME_METRICS.httpRequestErrorsTotal` no longer resolve (tsc reports TS2339 at any '
    + 'surviving read) and no `metrics.counter` call names the string.',
};
