---
"@objectstack/driver-turso": minor
---

fix(driver-turso)!: `timeout` beside a pre-configured `client` in remote mode is refused at construction instead of being accepted and never delivered (ADR-0049 enforce-or-remove)

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed at the driver constructor: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `TursoDriverConfig.timeout` and `TursoDriverConfig.client` keep their names and types, and the published `turso` config schema is untouched (it never declared `client`, which is a live object rather than authorable metadata). What moves is which CONFIGURATIONS `new TursoDriver()` accepts, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The refusal itself names both keys, the mode and both ways out, and which of the two an author wants is authoring intent no ledger line can decide. -->

`TursoDriverConfig.timeout` bounds remote operations over HTTP by installing a `fetch` that aborts at the window — and it installs it in exactly one place, while the driver is CREATING its `@libsql/client`. A pre-configured `TursoDriverConfig.client` arrives with its transport already built, and both remote sites that consume it (`connect()` and the lazy connect factory the transport self-heals through) skip the builder entirely. So on that one composition the window reached nothing: the driver constructed, connected, and ran every request unbounded, while `timeout`'s contract promised "every request the client's HTTP transport makes" and `client`'s said nothing about the key ceasing to apply.

**BREAKING** accept-set narrowing on a published driver option, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **The constructor now refuses a configuration it accepted before**: a non-zero `timeout` beside a supplied `client` in remote mode throws at `new TursoDriver()` — ahead of the Knex base and of any client, so no half-built driver exists — with the ADR-0112 envelope `code: 'VALIDATION_ERROR'`, `status: 400`, and a message that names both keys, the window, the mode and both ways out:

```
`TursoDriverConfig.timeout` (30000 ms) is set beside `TursoDriverConfig.client` in
remote mode, and on that pair it bounds nothing: the window is the `fetch` this
driver hands @libsql/client while CREATING the remote client, and a pre-configured
client is already built — its transport is not the driver's to replace … Either drop
`client` and let the driver create the remote client, where every request IS bounded
and a stalled endpoint fails as TIMEOUT / 504, or keep `client` and omit `timeout`,
building the bound into that client yourself when you call `createClient({ fetch })`.
Replica mode is unaffected: there `sync()` is bounded whatever client is in use.
```

**Who can reach this, measured on this tree.** The datasource seam cannot: `buildTursoDriverConfig` emits nine keys (`url`, `authToken`, `encryptionKey`, `concurrency`, `syncUrl`, `sync`, `timeout`, `mode`, `schemaMode`) and `client` is not among them — it is a live object, not authorable metadata, and the published `turso` schema documents its absence deliberately. So no datasource, environment variable or `sys_metadata` row can produce this pair; only code calling `new TursoDriver(...)` / `createTursoDriver(...)` directly. Across the 138 construction sites in this repository, the only one pairing the two keys outside the new pin file is a replica-arm test fixture, which stays accepted. Whether any out-of-repo host composes them is NOT measured and is not claimed to be zero.

**What stays accepted — the refusal is no wider than the gap**, pinned by controls:

- a supplied `client` with no `timeout`, and an explicit `client: undefined`, which the `??` at both sites treats as absent;
- `timeout` with no `client` — the client the driver builds IS bounded;
- `timeout: 0` beside a client, the documented "no bound", which asks for nothing;
- the whole REPLICA arm, where `sync()` is bounded by the driver around the awaited promise whatever client is in use, so the key is not inert there and the pair is still accepted.

**What is deliberately NOT done**: wrapping or re-creating the caller's client so the window rides after all. A client handed in for custom caching, connection pooling or testing is the caller's object, and replacing its transport because `timeout` is set would discard the configuration it was built to carry, behind the author's back — the same reason a `wss://` url is not silently re-routed over HTTP.

**What an affected author does.** The refusal text says which two: drop `client` and let the driver create the remote client, which bounds every request; or keep `client` and drop `timeout`, building the bound into that client where it is created, since `@libsql/client` reads its `fetch` at creation. Which of the two is wanted is authoring intent, and the choice is made in place at the driver config.
