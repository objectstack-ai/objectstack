---
'@objectstack/service-datasource': patch
---

fix(service-datasource): `POST` / `PATCH /api/v1/datasources` and `POST /api/v1/datasources/test` judge the datasource record they will persist against `DatasourceSchema`, the contract `os build` and `PUT /api/v1/meta/datasource/:name` already enforce (#21058)

Clause-②: no

- Before, these doors checked the driver `config` alone. A record that `DatasourceSchema` refuses was accepted `201`, and `GET /api/v1/meta/datasource/:name` then reported it `valid: false`. The record is now judged as it will be stored, with the `external.credentialsRef` that a supplied `secret` (or the existing binding) carries, before any secret or record is written. A refusal answers `400 DATASOURCE_ADMIN_ERROR` with `DatasourceSchema`'s own message, and nothing is persisted.
- Newly refused, for example: a mongo `config.url` whose userinfo names no user, or a composed mongo `config` with no `username`, beside a `secret`. The bound secret was never used and the datasource connected anonymously. Fix: put the user in the url (`mongodb://user@host/db`) or in `config.username`, or send no `secret`. Also refused: `schemaMode: 'external'` or `'validate-only'` with no `external` block. Fix: send `external: {}` or the federation settings. Also refused: a create with no `config`, or a `pool` key the schema does not declare.
- `POST /api/v1/datasources/test` answers `ok: false` with the same message instead of probing, so a green test no longer comes before a refused save.
- A `PATCH` that changes only `label` and/or `active` is not judged. A row stored before this change can still be renamed or taken out of service.
