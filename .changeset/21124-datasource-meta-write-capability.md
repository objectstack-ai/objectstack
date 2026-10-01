---
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest,runtime): writing `datasource` metadata through `/api/v1/meta` requires `manage_platform_settings`, the capability the datasource admin door already requires (#21124)

Clause-②: no

- A write of a `datasource` definition through `/api/v1/meta` (and its plural spelling) is now admitted only for a caller who holds `manage_platform_settings`. That is the capability the datasource admin door (`POST /api/v1/datasources`, `PATCH` and `DELETE /api/v1/datasources/:name`) already requires for the same create, update and remove. Every write verb is judged alike: the save (`PUT /meta/datasource/:name`, a draft save included), the reset (`DELETE`), `/publish` and `/rollback`.
- A caller without the capability gets `403` with `error.code` `PERMISSION_DENIED`, and a message that names the capability. Nothing is written. The answer is the same whether or not the named item exists.
- The write doors' own authoring admission is unchanged and still applies, so a datasource write needs `manage_platform_settings` and `manage_metadata` both. Platform administrators hold both through `admin_full_access`. Every other metadata type, and every read route, is unchanged. `external_catalog` writes are unchanged: that type's own write door requires `manage_metadata`.
- Both transports answer the same way: `RestServer`, and the runtime dispatcher's `/meta` domain that a host mounting only the `/api/v1/*` catch-all is served by.
- If you write datasource definitions through `/api/v1/meta` with a caller that holds only an authoring capability (`manage_metadata`, `studio.access` or `setup.access`), grant `manage_platform_settings` to that caller, or write through the datasource admin door with a caller that already holds it.
