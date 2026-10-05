---
'@objectstack/spec': minor
'@objectstack/service-datasource': patch
---

fix(spec)!: a datasource whose driver the platform ships no config contract for refuses inline credential material at publish, and every read door withholds it by name — `apiKey`, `client_secret`, `secretAccessKey`, `privateKey`, `accessToken` and a `Password=` connection-string segment included (#21840)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal at publish of inline credential material in the config of a datasource whose driver ships no config contract. No authorable key, spelling, export or stored shape is retired or renamed: DatasourceSchema keeps parsing the same config shape, no stored row is read or rewritten by a conversion, and moving a credential into the bound secret is an operator act (the connection form's secret field), not a mechanical FROM to TO rewrite a ledger entry could perform; which key a plugin driver's factory reads its credential from is not knowable here. The new spec exports only widen the surface. -->

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
own `config.<path>` — array elements included (`config.servers.0.password`):

- **A value under a credential-shaped key:** a non-empty string, a number, or an
  array holding a non-empty string or number. The key is judged on its whole name,
  split into words at separators and camel-case boundaries, case-insensitively. It is
  credential-shaped when one of its words is `password`, `passwd`, `passphrase`,
  `secret` or `credential`; when its last word is `token`, `pass`, `pw`, `pwd`, `jwt`,
  `pat`, `cookie`, `sas`, `auth`, `authorization`, `bearer` or `apikey`; when its
  last word is `key` alone or beside `api`, `private`, `secret`, `signing`, `master`,
  `encryption`, `decryption`, `account`, `shared`, `client`, `session`, `auth`,
  `hmac`, `license`, `subscription`, `ssh`, `aes` or `storage`; when its last word is
  `signature` beside `shared`, `access`, `sas` or `hmac`; when it names
  service-account key material (`serviceAccountKey`, `serviceAccountJson`); or when it
  is one of the existing canonical spellings. A trailing `value`, `values`, `pem`,
  `json`, `b64` or `base64` and a plural `s` are ignored first (`apiKeys`, `tokens`,
  `privateKeyPem`, `apiKeyValue`, `keyJson`). A one-word key with no surviving
  boundary (`APIKEY`, `accesstoken`) is judged on its folded spelling against the
  same stems. Never credential-shaped: a key whose last word is a locator,
  identifier or descriptor (`ref`, `refs`, `reference`, `arn`, `id`, `ids`, `name`,
  `names`, `path`, `paths`, `file`, `files`, `filename`, `url`, `urls`, `uri`,
  `endpoint`, `env`, `type`, `header`, `headers`, `field`, `prefix`, `mode`,
  `region`, `provider`, `source`, `chain`, `policy`, `method`, `enabled`,
  `authentication`, `format`, `version`, `expiry`, `expires`, `length`, `count`, or
  a word ending in `less`), and a multi-word key whose first word is `use`,
  `enable`, `enabled`, `disable`, `require`, `required`, `allow`, `has`, `is`, `no`,
  `skip`, `max`, `min`, `num`, `count` or `total`. So `credentialsRef`,
  `accessKeyId`, `tokenUrl`, `passwordFile`, `secretsManagerRegion`,
  `credentialProvider`, `useDefaultCredentials`, `passwordless`, `maxTokens`,
  `primaryKey`, `partitionKey`, `passive`, `bypass…` and a bare `accessKey` (the
  identity half of an access-key pair) stay accepted.
- **The secret leaves of a credential-shaped object** (`credentials: {…}`,
  `auth: {…}`): every leaf except a descriptor or an identity (`type`, `clientId`,
  `user`, `username`, `email`, `scope`, `region`, …).
- **The `value` of a `{ name, value }` pair** (also `key`, `header` or `headerName`)
  whose name is credential-shaped — a headers list carrying `Authorization`,
  `X-API-Key` or `Cookie`.
- **A string carrying a credential, anywhere:** a URL userinfo password; a URL query
  parameter whose name is credential-shaped; a credential property in a URL's
  `;key=value` tail (`sqlserver://h;user=u;password=p`); a credential segment of a
  semicolon-delimited connection string (`Server=h;Password=p`, `Pwd=`,
  `AccountKey=`; quoted values honoured); a credential keyword of a libpq
  keyword/value string (`host=h password=p`); and a scheme-less userinfo password
  (`user:password@host/db`).
- **A subtree nested deeper than 16 levels**, which cannot be judged and is not
  accepted unjudged.

**Still accepted:** an empty string (the explicit way to clear a stored value), a
boolean, a value made only of environment placeholders in the `${NAME}` grammar (an
upper-case environment name, `${API_KEY}`; any other `${…}` content is judged as
written), plain array data with no credential-shaped key, and every other key — the
config shape itself stays unjudged.

**What an author sees now, and the remedy it names.** Each refusal is a `custom` issue
at the value's own `config.<path>`, naming the position and the remedy: remove the
inline credential from `config` and bind it as the datasource's secret — the
connection form's secret field, or `external.credentialsRef`. The connect path hands
the decrypted value to the driver factory as the connection secret, so a plugin
driver receives it only if its factory reads that injected secret. No key is retired
or renamed; nothing an author wrote is rewritten.

**Every read door withholds it, rows stored before this release included.** The one
read-path redactor (`redactDatasourceConfig`) now withholds, for a contractless
driver, every position the write door refuses — both doors read ONE walk
(`findContractlessCredentials`): a credential value is dropped (inside an array
element too), a credential embedded in a string is removed from it. That covers `/api/v1/meta/datasource` (item, list,
`/published`, `/layers`, history), `/api/v1/datasources` (item and list), the generic
data door over `sys_metadata` / `sys_metadata_history`, and the audit ledger's and
activity feed's copies of those rows (new copies at write time; for copies written
before this release, run `os migrate audit-metadata-bodies --apply`, which projects
them through the same redactor). An untouched
Save of a legacy row's edit form carries the withheld values forward, as before —
array elements included, by position.

**`@objectstack/service-datasource`:** the credential-migration planner now reports a
contractless row's top-level keys that hold any such finding as residue and refuses with its remedy, instead of answering
`nothing-to-migrate` while the value sits in cleartext.

**New `@objectstack/spec/data` exports:** `isCredentialShapedConfigKey`,
`embeddedCredentialOf`, `redactEmbeddedCredentials`, `connectionStringCredentialKeys`,
`findContractlessCredentials` (with its `ContractlessCredentialFinding` type and
`CONTRACTLESS_CREDENTIAL_WALK_DEPTH`), and `isContractlessDriver`.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** No datasource in this
repository uses a contractless driver; plugin drivers in other repositories that
authored inline credentials will see the refusal on their next publish.
