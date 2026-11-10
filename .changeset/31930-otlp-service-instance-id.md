---
'@objectstack/cli': patch
---

feat(cli): `os serve`'s OTLP resource carries `service.instance.id` when several replicas are declared over the Redis cluster driver

Clause-②: yes (widening)
Metadata-protocol: none

With `OS_OBS_EXPORTER=otlp` and several replicas declared over the Redis cluster driver (`OS_CLUSTER_REPLICAS` greater than 1 or `OS_EXPECT_MULTI_NODE=true`, with `OS_CLUSTER_DRIVER=redis`), each replica's exported resource now also carries `service.instance.id`, so a metrics backend keeps one series per replica instead of folding every replica into one.

- The value is `HOSTNAME-PID`: the host name is the pod name on Kubernetes and the container id under Compose, and the pid tells apart two replicas that share a host name within one PID namespace (two processes on one machine). Replicas that share a host name across PID namespaces (a fixed Compose `hostname:`, host-network containers) are each pid 1 and export the same id, so give each replica its own host name. A host that reports no name gets a random id for the process.
- No variable sets it. `OTEL_RESOURCE_ATTRIBUTES` and the OpenTelemetry resource detectors are not read, so there is no operator-written value for it to override.
- Every other boot, a single node included, exports `service.name` and `deployment.environment` only, as before.
