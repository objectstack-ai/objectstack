---
"@objectstack/service-datasource": patch
---

`importObject` now refuses an explicit `opts.name` that violates the ADR-0028
namespace-prefix rule (#11061). The override used to be taken verbatim
(`opts.name ?? draft.name`) and persisted through `metadata.register('object',
…)` — the one runtime write path no namespace gate looks at — so
`POST /api/v1/datasources/:name/external/tables/:remote/import` with
`{"name": "customers"}` minted an unprefixed federated object that
`defineStack()` and the publish pre-flight would both have refused.

The refusal answers `400 EXTERNAL_IMPORT_ERROR` (the family's registered
ADR-0112 code, in the #8016 thrown-refusal shape) carrying
`validateObjectNamespacePrefix`'s own actionable message — the same text the
publish gate serves for the identical violation, e.g. `Object 'customers' is
missing the package namespace prefix. Rename it to 'wh_customers' (namespace =
'wh').` A compliant override (`wh_customers`), a `sys_*` platform-reserved
name, and any override on a datasource whose package resolves no namespace are
accepted exactly as before; the derived-name path (no `name` in the body) is
unchanged.
