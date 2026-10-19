---
'@objectstack/spec': minor
'@objectstack/driver-mongodb': patch
---

feat(spec)!: the datasource driver spelling `mongo` is retired — an authored `driver: 'mongo'` is refused with the prescription naming `mongodb`, `OS_DATABASE_DRIVER=mongo` is no longer a driver selection, and `datasource-driver-mongo-to-mongodb` leaves the load path

Clause-②: yes (narrowing)

**BREAKING (authoring):** `mongo` was a second accepted spelling of the MongoDB driver id `mongodb` through 17: the loader rewrote an authored `datasource.driver: 'mongo'` to `mongodb` with a notice, and both boot hosts accepted `OS_DATABASE_DRIVER=mongo`. At 18 it is retired. `DriverType` refuses it by name at every door that parses a datasource (`defineStack`, `os validate`, `os build`, `os lint`, the metadata and datasource APIs): "Datasource `driver: 'mongo'` was removed in @objectstack/spec 18 (ADR-0087 D2) … Use `driver: 'mongodb'`." The refusal is case- and whitespace-insensitive, and it is published in the JSON Schema too (a `pattern` on `driver`), so a document validated against `json-schema/**` is refused as well. Both boot hosts now refuse `OS_DATABASE_DRIVER=mongo` (and a standalone stack's `databaseDriver: 'mongo'`) with their "Supported drivers" list, which names `mongodb`. The ADR-0087 D2 conversion `datasource-driver-mongo-to-mongodb` is retired from the load path (`retiredAfter: '17.7.0'`), so the authoring funnel no longer rewrites the spelling.

Migration:

- `datasource.driver: 'mongo'` → `driver: 'mongodb'`. Change the value; the driver it builds and the `config` contract it is judged against are unchanged.
- `OS_DATABASE_DRIVER=mongo` → `OS_DATABASE_DRIVER=mongodb`, or unset it and let a `mongodb://` or `mongodb+srv://` database URL select the driver. The same for `databaseDriver: 'mongo'` passed to the standalone stack.
- A script or integration that creates or updates a datasource through the metadata or datasource REST API with `driver: 'mongo'` → send `driver: 'mongodb'`.

Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand. The D3 entry `datasource-driver-mongo-alias-retired` lists what the chain cannot reach: environment variables, launch scripts and API callers.

Stored metadata needs no edit. Every stored-row rehydration seam replays the retired conversion, so a `sys_metadata` datasource row written as `mongo` (the Setup → Datasources form wrote that until the canonical id was renamed to `mongodb`) keeps loading as `mongodb`. The spelling also stays on the spec's driver CONTRACT face (`resolveDriverId('mongo')` still answers `mongodb`): a reader that judges a stored body as written, such as the read-path credential redactor, keeps judging a legacy row as mongodb. Measured with the spelling deleted outright, that redactor served all ten mongodb passthrough secrets of such a row in cleartext.

`@objectstack/spec` also exports `RETIRED_DRIVER_ID_GUIDANCE` (retired spelling → its prescription), the table the refusal is derived from. `@objectstack/driver-mongodb`'s README no longer lists `mongo` as a recognised `OS_DATABASE_DRIVER` value.

<!-- adr-0087: registered datasource-driver-mongo-alias-retired -->
