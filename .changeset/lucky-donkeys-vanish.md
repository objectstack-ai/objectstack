---
"@objectstack/observability": minor
"@objectstack/cli": minor
---

Surface a licensed `max_nodes` oversell to operators as telemetry

`os serve` already warned loudly at boot when `OS_CLUSTER_REPLICAS` declared more
nodes than the licence gate admits, but that warning existed only in one
process's startup output: an operator who scaled past their cap three weeks ago
had no way to ask the question today, and no way to alert on it. The same
advisory verdict is now also published through the deployment's configured
metrics backend, so it reaches the place operators already look.

Three names join `SEMCONV` in `@objectstack/observability`, emitted once per boot
by `os serve` when a remote cluster driver is configured, each labelled with the
gate's own verdict vocabulary (`admitted` / `capped` / `refused`):

- `cluster_declared_nodes` (gauge) — the replica count the operator **declared**;
- `cluster_admitted_nodes` (gauge) — how many of them the licence **admits**;
- `cluster_node_cap_verdicts_total` (counter) — one increment per process boot
  that consulted the gate, so an alert stays writable after a one-shot gauge has
  aged out of a push-based backend.

**Visibility only — the cap remains advisory and nothing is refused.** The gate is
consulted once per process at boot, every replica computes the same verdict, and
none can know whether it is one of the admitted ones, so all of them still join.
The names say so on purpose: this process has no cluster membership view at all,
so a series called `cluster_nodes` or `cluster_active_nodes` would be a false
statement dressed as telemetry. Nothing here counts peers, and no accept/reject
behaviour changed.

Absence is meaningful rather than an instrumentation gap: a single-node
deployment never consults the gate and emits nothing, and an emission also needs
a metrics backend configured via `OS_OBS_EXPORTER`.
