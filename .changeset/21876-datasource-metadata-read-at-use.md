---
'@objectstack/service-datasource': minor
---

fix(service-datasource)!: on `objectstack start`, external validation and the boot gate compare every federated object

**BREAKING (narrowing)** — on `objectstack start` a deployment with real schema drift on a
federated object can now refuse to boot, as its `external.validation.onMismatch` setting
declares.

The federation service (`ExternalDatasourceServicePlugin`) read the `metadata` service once,
in its `init()`, and kept the answer. `objectstack start` composes no metadata plugin: its
`metadata` service is the kernel's in-memory fallback, which the kernel registers after every
plugin's `init()`, just before the start phase. So on `start` the federation service kept "no
metadata service" for the life of the process, and every read behind it answered as if the
deployment declared nothing. It now asks for the `metadata` service each time it reads it, so
`start` sees what `objectstack dev` always saw.

| on `objectstack start` | before | now |
| --- | --- | --- |
| the boot gate (ADR-0015 §5.2) | logged "all federated objects match their remote schema" with `objects: 0`, having compared nothing, so no `onMismatch` policy ever applied | compares every federated object and applies each datasource's `onMismatch` to every measured mismatch |
| `POST /api/v1/datasources/:name/external/validate` | `ok: true` with no rows | one row per federated object bound to the datasource, with its diffs |
| `POST /api/v1/datasources/:name/external/refresh-catalog` | answered the snapshot, never stored it | also stores it as the datasource's `external_catalog` record |
| `GET /api/v1/datasources/:name/external/tables` | ignored the datasource's `external.allowedSchemas` | leaves out a table whose schema is outside them |
| draft and import names | never resolved a package namespace: drafts were unprefixed, and an import's explicit `name` was never held to the ADR-0028 prefix rule | resolve the namespace of the datasource's package when the datasource carries package provenance; an import whose explicit `name` lacks that prefix is refused `400 EXTERNAL_IMPORT_ERROR` |

**What to do if a `start` deployment now refuses to boot.** Under `onMismatch: 'fail'` (the
default) the boot stops with `ExternalSchemaMismatchError`, naming the object, the datasource
and each drifted column. Either fix the drift (align the object's fields, its
`external.columnMap` or `external.ignoreColumns`, or the remote table) or set
`external.validation.onMismatch: 'warn'` on that datasource, which boots and logs the drift
instead. To see the drift before deploying, call
`POST /api/v1/datasources/:name/external/validate` on `objectstack dev`, which already
compared. A remote that cannot be reached still never stops the boot. An import refused for
its name takes a `name` carrying the datasource package's namespace prefix.

**Unchanged.** `objectstack dev`, and every composition that registers a metadata plugin before
the federation service, answers exactly as before: measured on the showcase, every federation
door and the boot gate gave the same answers before and after. What validation judges, what
each `onMismatch` value does, and the boot gate's skip for a datasource that sets
`external.validation.checkOnBoot: false` are unchanged.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, spelling, export, config field or stored shape is removed or renamed, and no stored row is read or rewritten: on a composition with no metadata plugin the federation service now reads the metadata service it always declared it reads, so the boot gate and the federation doors judge the objects and datasources the deployment already declares. The handling above is an operator choice between two settings that already exist, not a FROM to TO mapping that objectstack migrate meta could apply. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers when a plugin resolves a service (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->
