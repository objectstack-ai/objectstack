---
"@objectstack/driver-turso": minor
---

fix(driver-turso)!: `timeout` beside a `wss://` / `ws://` url is refused at construction instead of being accepted and never delivered (ADR-0049 enforce-or-remove)

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed at the driver constructor: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `TursoDriverConfig.timeout` and `url` keep their names and types, and `TursoConfigSchema` is untouched. What moves is which CONFIGURATIONS `new TursoDriver()` accepts, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The refusal itself names the key, the scheme and both ways out, and which of the two an author wants (drop the window, or move the url to HTTPS) is authoring intent no ledger line can decide. -->

`TursoDriverConfig.timeout` bounds remote operations over HTTP (`libsql://`, `https://`, `http://` — the driver hands `@libsql/client` a `fetch` that aborts at the window) and bounds `sync()` on the replica arm. A remote url spelled `wss://` / `ws://` rides the client's WebSocket transport, which — measured against `@libsql/client@0.17.4` / `@libsql/hrana-client@0.10.0` — takes no `fetch` and no timeout option of its own, so on that one scheme the window reached nothing: the configuration constructed, connected, and ran unbounded, with the gap stated only in a docblock.

**BREAKING** accept-set narrowing on a published driver option, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **The constructor now refuses a configuration it accepted before**: a non-zero `timeout` beside a `wss://` or `ws://` `url` in remote mode throws at `new TursoDriver()` — ahead of the Knex base and of any client, so no half-built driver exists — with the ADR-0112 envelope `code: 'VALIDATION_ERROR'`, `status: 400`, and a message that names the key, the scheme it met, and both ways out:

```
`TursoDriverConfig.timeout` (30000 ms) is set beside a `wss://` url, and on that
scheme it bounds nothing: a `wss://` url rides @libsql/client's WebSocket
transport, which takes no fetch and no timeout option … Either omit `timeout`
and run this remote unbounded, or keep it and spell the url `libsql://` or
`https://` — the client resolves `libsql://` to HTTPS — where every request IS
bounded and a stalled endpoint fails as TIMEOUT / 504.
```

A datasource authors the window as `config.timeoutMs`; the datasource seam maps it onto the driver's `timeout`, so a `timeoutMs` beside a WebSocket url now fails the datasource's connect by name instead of quietly running unbounded. Both loaders (`@objectstack/runtime`'s host factory and the open-core datasource factory) reach this refusal through the same constructor.

**What stays accepted — the refusal is no wider than the gap**, pinned by controls:

- a `wss://` / `ws://` url with no `timeout`, or with `timeout: 0` (the documented "no bound");
- `libsql://`, `https://` and `http://` urls WITH a window — the HTTP arm is bounded;
- the replica arm with any url scheme — `sync()` is bounded there, so the key is not inert.

**What is deliberately NOT done**: routing a `wss://` url over HTTP because `timeout` is set. That would change the wire transport behind the author's back and is a contract decision, not a driver's; the refusal changes no wire behaviour.

## Migration

| Wrote | Write instead |
| --- | --- |
| `url: 'wss://…'` (or `ws://…`) beside `timeout: N` (driver) / `timeoutMs: N` (datasource) | keep the window and spell the url `libsql://…` / `https://…` — bounded, and `libsql://` resolves to HTTPS — or drop the window and run the WebSocket remote unbounded, as it always did |

Blast radius, measured on this tree: no in-repo deployment, example or doc pairs a WebSocket url with a window, and the host boot path (`OS_DATABASE_URL`) forwards only `url` and `authToken`, so an env-configured deployment cannot carry `timeout` at all.
