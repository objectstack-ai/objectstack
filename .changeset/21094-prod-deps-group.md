---
'@objectstack/cli': patch
'create-objectstack': patch
'@objectstack/connector-mcp': patch
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/spec': patch
'@objectstack/driver-mongodb': patch
'@objectstack/driver-sqlite-wasm': patch
'@objectstack/driver-turso': patch
'@objectstack/mcp': patch
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/plugin-pinyin-search': patch
'@objectstack/service-settings': patch
---

Raise the published dependency floors to the 2026-10 production dependency group. No API changes. A consumer install resolves these ranges:

Clause-②: no

- `zod` `^4.6.1` → `^4.6.5`: `@objectstack/spec`, `@objectstack/core`, `@objectstack/objectql`, `@objectstack/rest`, `@objectstack/runtime`, `@objectstack/cli`, `@objectstack/mcp`, `@objectstack/metadata`, `@objectstack/metadata-core`, `@objectstack/metadata-protocol`, `@objectstack/driver-turso`.
- `@libsql/client` `^0.17.3` → `^0.18.0`: `@objectstack/driver-turso`. Every behaviour the driver documents was re-measured on 0.18.0 and holds unchanged. That covers the URL scheme routing, the `URL_INVALID` and `URL_SCHEME_NOT_SUPPORTED` refusals, the WebSocket transport having no `fetch` or timeout seam, `syncUrl` being read only by the embedded-replica client, and the `?authToken=` precedence on `url` and `syncUrl`. The driver's refusal messages now name 0.18.0 as the measured version. 0.18.0 changes only the local `file:` client, which now pools connections. The driver creates that client only for an embedded replica, and calls only `sync()` on it.
- `@modelcontextprotocol/sdk` `^1.30.0` → `^1.30.1`: `@objectstack/connector-mcp`, `@objectstack/mcp`.
- `chalk` `^6.0.0` → `^6.0.1`: `@objectstack/cli`, `create-objectstack`. `yaml` `^2.9.0` → `^2.9.1` and `tsx` `^4.23.12` → `^4.23.15`: `@objectstack/cli`.
- `mongodb` `^7.5.0` → `^7.6.0`: `@objectstack/driver-mongodb`.
- `sql.js` `^1.14.1` → `^1.14.2`: `@objectstack/driver-sqlite-wasm`.
- `@noble/hashes` `^2.3.0` → `^2.4.0` and `jose` `^6.2.8` → `^6.2.12`: `@objectstack/plugin-auth`. The better-auth family stays at exactly `1.7.3`.
- `hono` `^4.13.5` → `^4.13.9`: `@objectstack/plugin-hono-server`.
- `pinyin-pro` `^3.29.1` → `^3.29.4`: `@objectstack/plugin-pinyin-search`.
- `@noble/ciphers` `^2.3.0` → `^2.4.0`: `@objectstack/service-settings`.
