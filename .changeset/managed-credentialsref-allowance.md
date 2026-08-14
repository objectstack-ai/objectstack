---
"@objectstack/spec": minor
---

`DatasourceSchema` now accepts `external.credentialsRef` — and only it — on a
`schemaMode: 'managed'` datasource. The Studio wizard's `createDatasource` stores the
secret in the secrets store and writes `external: { credentialsRef }` onto the row
(whose `schemaMode` defaults to `'managed'`), so the previous blanket refusal of
`external` on managed badged every wizard-created datasource with a password
`_diagnostics.valid: false` and answered 422 on `PUT /meta` for the service's own
output. Every federation key (`allowedSchemas`, `allowWrites`, `validation`,
`queryTimeoutMs`) is still refused on a managed row with the existing guidance; the
check judges effective federation content (values against the parsed-empty defaults,
not key presence), so re-parses of served output — which materialize every default
key — stay valid. Maintainer ruling on #8153.
