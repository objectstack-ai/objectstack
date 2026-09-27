---
'@objectstack/driver-turso': minor
---

fix(driver-turso)!: a url scheme matches in any letter case, and a url the driver cannot open is refused instead of running on a private in-memory database

Clause-②: no (narrowing)

`TursoDriver.detectMode` matched `file:` and the five remote schemes case-sensitively, and answered `'local'` for any other url with no `mode`. The local engine can open only a `file:` path or `:memory:`, so for everything else it was handed `:memory:`: writes succeeded and read back, then vanished on restart. `@libsql/client` reads a scheme in any letter case (`@libsql/core@0.17.4` routes on `uri.scheme.toLowerCase()`), so an uppercase `LIBSQL://` url that the client routes to the remote database ran on that local `:memory:` engine instead. `@objectstack/cli` and `@objectstack/runtime` select this driver for an `OS_DATABASE_URL` matching `libsql://` in any letter case and hand it the url as written, so an uppercase `OS_DATABASE_URL` reached that engine too. Measured before the change, with `initObjects`, `create`, `find`, then a fresh driver on the same config:

```
LIBSQL://… (no mode)                -> local, 1 row back, 0 rows after restart
FILE:<path> (no mode)               -> local, 1 row back, 0 rows after restart, file never created
./<dir>/app.db (no mode)            -> local, 1 row back, 0 rows after restart, file never created
<tmp>/app.db (no mode)              -> local, 1 row back, 0 rows after restart, file never created
./<dir>/app.db + mode: 'local'      -> local, 1 row back, 0 rows after restart, file never created
file:<path> (unchanged)             -> local, 1 row back, 1 row after restart
```

**The scheme now matches in any letter case**, as it does in `@libsql/client`, in `detectMode` and in every constructor check. `LIBSQL://`, `HTTPS://`, `Http://`, `WSS://` or `Ws://` with no `mode` is remote. `FILE:<path>` is a local file, and an embedded replica beside `syncUrl`. The url itself is passed to the client as written.

**BREAKING** accept-set narrowing on a published driver option, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **The constructor now refuses configurations it accepted before**, at `new TursoDriver()`, ahead of the Knex base and of any client, with the ADR-0112 envelope `code: 'VALIDATION_ERROR'`, `status: 400`. Refused:

- in a local or replica mode, a `url` that is none of `:memory:`, a `file:` url or a remote url (`libsql://`, `https://`, `http://`, `wss://`, `ws://`, in any letter case). That is a bare path (`./data/app.db`, `data/app.db`, `/var/lib/app.db`, `C:\data\app.db`), an unsupported scheme (`sqlite:`, `memory://`), `:MEMORY:`, a remote scheme with no `//`, a url behind leading whitespace, and an empty url. Newly refused with no `mode` (with or without `syncUrl`) and under a forced `mode: 'local'`. Under a forced `mode: 'replica'` it was already refused, and the refusal now names the `file:` spelling for the replica. `@libsql/client@0.17.4` refuses each of these urls itself, as `URL_INVALID` or `URL_SCHEME_NOT_SUPPORTED`;
- an uppercase remote url beside `syncUrl` (no `mode`), or under a forced `mode: 'local'`. Both constructed on the private `:memory:` engine before, and both now meet the refusal their lowercase spelling already met. Under a forced `mode: 'replica'` it was already refused, now with that same remote-url refusal;
- an uppercase `WSS://` or `WS://` url with a non-zero `timeout`, no `mode` and no `syncUrl`. It is now detected as remote, so the existing refusal of a `timeout` on the WebSocket transport reaches it;
- `FILE::memory:` beside `syncUrl` (no `mode`), refused as an in-memory replica exactly like `file::memory:`. Under a forced `mode: 'replica'` it was already refused.

The unrecognised-url refusal names the `file:` spelling (`url: 'file:./data/app.db'`, or `url: 'file:./data/replica.db'` beside `syncUrl`) and never echoes the url, which may carry a token. `TursoDriver.detectMode()` now answers `'replica'` for such a url beside `syncUrl` (it answered `'local'`), which is what the declaration asks for. The refusal sits in the constructor, not in a re-classification.

**Newly accepted:** an uppercase or mixed-case `FILE:` url naming a file, under a forced `mode: 'replica'`, with or without `syncUrl`. The #19893 change refused it, because under a forced `mode: 'replica'` it refused every url that did not start with a lowercase `file:`. With this change it is a `file:` url: the replica runs on that file, and its rows survive a restart (pinned). It is the one configuration the #19893 change refused that this change accepts.

**What stays accepted**, pinned by preservation tests: a lowercase `file:` url, alone or with `syncUrl`; `:memory:` as a local database; a lowercase remote url on its own or with `mode: 'remote'`. A forced `mode: 'remote'` runs no local engine, so this change does not judge its url: a bare path there still constructs, and `@libsql/client` refuses it at `connect()` as `URL_INVALID`.

**What an affected author does.** A local database file needs the `file:` prefix: `url: 'file:./data/app.db'`. For a throwaway in-memory database, `url: ':memory:'`. An uppercase remote url with no `mode` and no `syncUrl` now reaches the remote database and needs no change. Beside `syncUrl` or under a forced local or replica mode it is refused with the same ways out as the lowercase spelling.

The #19893 entry in this same version (the constructor refusal of a remote url in a local or replica mode) describes this fall-through as not refused by that change, and names this entry as the one that removes it.

Blast radius, measured on this tree: no example, template, hand-written doc, published skill or factory default, and no test fixture outside this package's own tests, spells a turso url with an uppercase scheme or as a bare path. Neither host url sniffer selects this driver for a bare path (both select it only for `libsql://` or an `http(s)://` url naming a `.turso.` host); only an explicit `OS_DATABASE_DRIVER=turso` or a datasource declaring `driver: 'turso'` hands it one. Whether any out-of-repo deployment declares such a url is NOT measured and is not claimed to be zero.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed at the driver constructor, together with a case-insensitive reading of the url scheme: no key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `TursoDriverConfig.url`, `syncUrl` and `mode` keep their names and types, and both `TursoConfigSchema` copies are untouched. What moves is which CONFIGURATIONS `new TursoDriver()` accepts and how it classifies an uppercase scheme, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The refusal names the `file:` spelling, and whether an author meant a local file, a replica or a remote database is authoring intent no ledger line can decide. -->
