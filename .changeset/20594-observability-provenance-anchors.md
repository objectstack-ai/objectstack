---
'@objectstack/observability': patch
---

A provenance comment in `@objectstack/observability` was re-anchored

The `SEMCONV` comment beside the retired `http_request_errors_total` entry
cited a tracker number that no longer resolves on GitHub. It now cites the
commit in this repository's history that moved `http_request_duration_ms` to
the transport seam. Comment only: no metric name, label, export, type or
runtime behaviour changes.
