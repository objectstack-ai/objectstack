---
'@objectstack/spec': minor
'@objectstack/service-datasource': patch
---

fix(spec)!: a datasource whose driver the platform ships no config contract for refuses inline credential material at publish, and every read door withholds it by name — `apiKey`, `client_secret`, `secretAccessKey`, `privateKey`, `accessToken` and a `Password=` connection-string segment included (#21840)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal at publish of inline credential material in the config of a datasource whose driver ships no config contract. No authorable key, spelling, export or stored shape is retired or renamed: DatasourceSchema keeps parsing the same config shape, no stored row is read or rewritten by a conversion, and moving a credential into the bound secret is an operator act (the connection form's secret field), not a mechanical FROM to TO rewrite a ledger entry could perform; which key a plugin driver's factory reads its credential from is not knowable here. The four new spec exports only widen the surface. -->

**BREAKING**: a datasource config that published before can now be refused. For a
driver the platform ships no config contract for (a plugin-contributed driver such as
`com.vendor.warehouse`), `config` used to be validated against nothing, so credential
material other than a key literally named `password` / `authToken` (and their former
aliases) was accepted, stored in cleartext in `sys_metadata` and its history, and
served back on administrator reads. ADR-0015 §10 holds for every driver —
credentials never appear in metadata artefacts — so such a config now refuses it, by
name, with the remedy. It ships as `minor` under the launch-window convention for
accept-set narrowings. A driver WITH a contract (`postgres`, `mysql`, `mongodb`,
`turso`, `sqlite`, `sqlite-wasm`, `memory` and their aliases) is judged exactly as
before, at both doors.

**What is refused at publish** (every door that parses `DatasourceSchema`:
`defineStack({ datasources })`, `PUT /api/v1/meta/datasource/:name`, and Setup →
Datasources create and update; the connection test answers `ok: false`), each at its
own `config.<path>`:

- a non-empty string whose key — or an enclosing object's key — is credential-shaped:
  case- and separator-insensitively, a key containing `password`, `passwd`,
  `passphrase`, `secret` or `credential`, ending in `token` or `pwd`, or ending in one
  of the key-material names (`apiKey`, `privateKey`, `signingKey`, `masterKey`,
  `encryptionKey`, `accountKey`, `sharedKey`, `sharedAccessKey`, `clientKey`,
  `sessionKey`, `authKey`, `hmacKey`, `licenseKey`, `subscriptionKey`,
  `…AccessSignature`), plus the existing canonical spellings. A key ending in a
  locator, identifier or descriptor (`…Ref`, `…Arn`, `…Id`, `…Name`, `…Path`,
  `…File`, `…Url`, `…Uri`, `…Endpoint`, `…Env`, `…Type`, `…Header`, `…Field`,
  `…Prefix`, `…Mode`) is never credential-shaped: `credentialsRef`, `accessKeyId`,
  `tokenUrl`, `passwordFile` stay accepted. `primaryKey`, `partitionKey` and a bare
  `accessKey` (the identity half of an access-key pair) are not credential-shaped;
- a string carrying a URL userinfo password or a credential query parameter;
- a semicolon-delimited connection string carrying a credential segment
  (`Server=h;Password=p`, `Pwd=`, `AccountKey=`, `SharedAccessKey=`; quoted values
  are honoured).

**Still accepted:** an empty string (the explicit way to clear a stored value), a
`${…}` environment placeholder in place of the value (no credential material is
stored), a non-string value under a credential-shaped name, array data, and every
other key — the config shape itself stays unjudged.

**What an author sees now, and the remedy it names.** Each refusal is a `custom` issue
at the value's own `config.<path>`, naming the position and the remedy: remove the
inline credential from `config` and bind it as the datasource's secret — the
connection form's secret field, or `external.credentialsRef`. The connect path hands
the decrypted value to the driver factory as the connection secret, so a plugin
driver receives it only if its factory reads that injected secret. No key is retired
or renamed; nothing an author wrote is rewritten.

**Every read door withholds it, rows stored before this release included.** The one
read-path redactor (`redactDatasourceConfig`) now also drops, for a contractless
driver, every credential-shaped key at every object depth and every credential
segment of a connection string — through the same predicate the write door uses
(`isCredentialShapedConfigKey`). That covers `/api/v1/meta/datasource` (item, list,
`/published`, `/layers`, history), `/api/v1/datasources` (item and list), the generic
data door over `sys_metadata` / `sys_metadata_history`, and the audit ledger's and
activity feed's copies of those rows (new copies at write time; for copies written
before this release, run `os migrate audit-metadata-bodies --apply`, which projects
them through the same redactor). An untouched
Save of a legacy row's edit form carries the withheld values forward, as before.

**`@objectstack/service-datasource`:** the credential-migration planner now reports a
contractless row's credential-shaped keys (and connection strings carrying a
credential segment) as residue and refuses with its remedy, instead of answering
`nothing-to-migrate` while the value sits in cleartext.

**New `@objectstack/spec/data` exports:** `isCredentialShapedConfigKey`,
`connectionStringCredentialKeys`, `redactConnectionStringCredentials`,
`isContractlessDriver`.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** No datasource in this
repository uses a contractless driver; plugin drivers in other repositories that
authored inline credentials will see the refusal on their next publish.
