---
'@objectstack/lint': patch
'@objectstack/service-automation': patch
---

fix(lint, service-automation): `os validate` warns when a mapping's `connectorSource.connector` is not a declared rest or openapi connector, and a failed connector pull logs one `warn` line

Clause-②: no
Metadata-protocol: none

A mapping whose `connectorSource.connector` named a datasource, a connector of another provider, or nothing at all validated with no finding, and every scheduled pull then failed into the job run's `error` with nothing in the process log. `os validate`, `os lint` and `os build` now report `mapping-connector-source-unknown` (a warning; it says when the name is a datasource), and `@objectstack/lint` exports `validateMappingConnectorSources`, `MAPPING_CONNECTOR_SOURCE_UNKNOWN`, `CONNECTOR_SOURCE_PROVIDERS` and the `MappingConnectorSourceFinding` type. The connector pull (`pullConnectorSource`) logs `[Automation] connector pull of mapping "NAME" failed (REASON): …` at `warn` on every failed pull and rethrows the failure unchanged; the job run's `error` is written as before.
