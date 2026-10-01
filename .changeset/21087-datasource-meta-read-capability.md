---
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest,runtime): reading `datasource` and `external_catalog` metadata through `/api/v1/meta` requires `manage_platform_settings`, the capability each type's own door already requires (#21087)

Clause-②: no

- A `GET` or `HEAD` of `/api/v1/meta/datasource` or `/api/v1/meta/external_catalog` (and their plural spellings) is now admitted only for a caller who holds `manage_platform_settings`. That is the capability the datasource admin door (`GET /api/v1/datasources`, `GET /api/v1/datasources/:name`) and the federation read door (`GET /api/v1/datasources/:name/external/tables`) already require for the same data. Every read route under the type is judged alike: the list, the item read and each of its query switches, `/published`, `/layers`, `/history`, `/audit`, `/diff` and `/references`. `/history`, `/audit` and `/diff` still also require an authoring capability, as before.
- A caller without the capability gets `403` with `error.code` `PERMISSION_DENIED`, and a message that names the capability. The answer is the same whether or not the named item exists, and nothing is read from the metadata store first.
- Holders of `manage_platform_settings` are served exactly as before. Platform administrators hold it through `admin_full_access`. Every other metadata type, and every write route, is unchanged.
- Both transports answer the same way: `RestServer`, and the runtime dispatcher's `/meta` domain that a host mounting only the `/api/v1/*` catch-all is served by.
- If you read either type with a caller that holds only an authoring capability (`manage_metadata`, `studio.access` or `setup.access`), grant `manage_platform_settings` to that caller, or read through a caller that already has it.
