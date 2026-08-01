---
'@objectstack/spec': major
---

`datasource.readReplicas` is removed (#4468, ADR-0049 enforce-or-remove)

It described replica connections nothing ever opened. `ConnectableDatasource`
and `DatasourceConnectionSpec` carry no replicas field, the driver factory never
reads the key, and no query path distinguishes a read from a write — the
platform has no read/write splitting at all, so every statement always went to
the primary no matter what was declared here.

**Migration.**

| Wrote | Write instead |
| --- | --- |
| `readReplicas: [{ host: 'replica-a', … }]` | delete the key |
| `replicas: [ … ]` (the alias) | delete the key |

There is no target to move to, because there is no read-replica routing to move
to. If you need replica reads today, front them behind a single endpoint —
pgpool, ProxySQL, an RDS reader endpoint — and point `config` at that endpoint.
That is the one read-scaling path that works, and it worked before this key was
removed too.

Run `os migrate meta --from 16` to strip it from your sources; the
`datasource-read-replicas-removed` conversion emits one notice per datasource.
Authoring it now fails the parse with the same prescription.

**Why this one is worth reading about.** #4410 closed the `datasource.config`
gap and, in passing, extended the new per-driver validation over each
`readReplicas` entry — reasonably, since replicas carry the same shape. The
result was a slot that had every marker of a working feature: declared with a
doc comment, `.strict()`-guarded against typos at the top level, and
field-by-field validated against the driver's contract underneath. A replica
block with a misspelt `hostname` was rejected by index, naming the canonical
key.

None of that is evidence of a consumer, and all of it reads like one. That is
the specific trap ADR-0049 exists for: rigor is cheap to add to a dead slot and
expensive to distinguish from life. Two independent surfaces had drawn the
wrong conclusion — this validation, and objectui's datasource preview, which
rendered a "2 read replicas" pill confirming the config to the author while
nothing routed a single read. The preview goes with the key (objectui side,
same change); `packages/spec/liveness/README.md` has the standing rule it
violated ("an authoring/preview renderer is NOT a runtime consumer").

Read-replica routing remains unbuilt. It is tracked as a feature request rather
than left as a schema key that looks like one.
