---
'@objectstack/runtime': patch
'@objectstack/objectql': patch
---

fix(runtime): a job with no `organization` pulls as the organization its writes are stamped with, so its upsert match uses the organization index

Clause-②: yes (widening) — @objectstack/objectql gains `ObjectQL#systemWriteOrganization()`, the engine's own answer to which organization an organization-less system write resolves to
Metadata-protocol: none

A `job` whose `pull` syncs a mapping and that declares no `organization` ran its pull with no organization in its context (`{ isSystem: true }`). Every write of that pull was still stamped with the install's organization: on the `single` posture with exactly one organization, the engine derives it for an organization-less system write (ADR-0131 D9). But the import's match lookup had no organization to scope by, so on `single`, where a read gets no tenant scope, it read the target table once per row instead of probing the `(organization_id, <key>)` unique index. A large sync on the most common setup stayed table-scan slow.

Each run of such a pull now asks the engine, once, before it reads or writes, the same decision the engine's system insert makes, and runs as that organization when the engine derives one. The lookup then carries it on the tenant column, and the rows land exactly where they did before. When the engine does not derive one (a `group` or `isolated` posture, zero or several organizations, a composition with no organization object), the pull runs as before, and its writes are refused or stamped exactly as before. A job that declares an `organization` is unchanged, and so are the `body` and `handler` run forms. If the organization probe fails, the run says so once at `warn`, naming the job, and goes on as before.
