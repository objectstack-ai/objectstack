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
  array holding a non-empty string or number (an array of objects there has each
  object judged as a credential-shaped object, below). The key
  (`isCredentialShapedConfigKey`) is judged on its whole name, split into words at
  separators and camel-case boundaries, case-insensitively — words, never substrings.
  It is never credential-shaped when its last word is a locator, identifier or
  descriptor (`ref`, `refs`, `reference`, `arn`, `id`, `ids`, `name`, `names`, `path`,
  `paths`, `file`, `files`, `filename`, `url`, `urls`, `uri`, `endpoint`, `env`,
  `type`, `header`, `headers`, `field`, `prefix`, `mode`, `region`, `provider`,
  `source`, `chain`, `policy`, `method`, `enabled`, `authentication`, `format`,
  `version`, `expiry`, `expires`, `length`, `count`, or a word ending in `less`), or
  when it has more than one word and its first is `use`, `enable`, `enabled`,
  `disable`, `require`, `required`, `allow`, `has`, `is`, `no`, `skip`, `max`, `min`,
  `num`, `count` or `total`. Otherwise it is credential-shaped when it is one of the
  existing canonical spellings or, after dropping trailing `value`, `values`, `pem`,
  `json`, `b64` or `base64` words and a plural `s` (never the `s` of a word already
  ending in `s`: `sass` is not `sas`), when one of its words is `password`, `passwd`,
  `passphrase`, `secret` or `credential`; when its last word is `token`, `pass`,
  `pw`, `pwd`, `jwt`, `pat`, `cookie`, `sas`, `auth`, `authorization`, `bearer` or
  `apikey`, or folds a compound ending (`db_accesstoken`); when its last word is `key`
  alone or beside `api`, `private`, `secret`, `signing`, `master`, `encryption`,
  `decryption`, `account`, `shared`, `client`, `session`, `auth`, `hmac`, `license`,
  `subscription`, `ssh`, `aes` or `storage`; when its last word is `signature` beside
  `shared`, `access`, `sas` or `hmac`; or when it names service-account key material
  (`serviceAccountKey`, and `serviceAccount` before a dropped qualifier:
  `serviceAccountJson`, `serviceAccountPem`). So `apiKeys`, `tokens`, `privateKeyPem`,
  `apiKeyValue`, `tokenValue`, `keyJson`, `pass`, `pw`, `key`, `auth`,
  `Authorization`, `bearer`, `jwt`, `pat`, `cookie` and `sas` are credential-shaped,
  while `credentialsRef`, `accessKeyId`, `tokenUrl`, `passwordFile`,
  `secretsManagerRegion`, `credentialProvider`, `useDefaultCredentials`,
  `passwordless`, `maxTokens`, `primaryKey`, `partitionKey`, `passive`, `bypass…` and
  a bare `accessKey` (the identity half of an access-key pair) stay accepted. A
  one-word key with no boundary left (`APIKEY`, `accesstoken`, `dbpassword`) is judged
  on its folded spelling by the same rules: it is credential-shaped when it is one of
  the stems above (`key` and `signature` included), when it holds `password`, `passwd`, `passphrase`, `secret` or
  `credential` followed by nothing, `key`, `accesskey`, `hash` or `string`
  (`secretaccesskey` — not `secretary`), or when it ends in a folded key-material
  compound (`accesstoken`, `apikey`, `privatekey`, `secretkey`, `serviceaccountkey`,
  `serviceaccountjson`, …); a one-word key starting with `max`, `min`, `num`, `total`
  or `count` is not.
- **The secret leaves of a credential-shaped object** (`credentials: {…}`,
  `auth: {…}`): every leaf except one whose last word is a descriptor (the list above)
  or an identity (`user`, `username`, `login`, `email`, `issuer`, `audience`, `scope`,
  `scopes`, `algorithm`, `alg`, `domain`, `host`, `hostname`, `port`, `realm`,
  `project`, `tenant`, `subject`, `kind`, `label`, `description`) — so
  `credentials: { type, clientId }` is accepted whole.
- **The `value` of a `{ name, value }` pair** (also `key`, `header` or `headerName`)
  whose name is credential-shaped — a headers list carrying `Authorization`,
  `X-API-Key` or `Cookie` — and **the second element of a `[name, value]` tuple** in
  a list, judged the same way (`headers: [['Authorization', '…']]`).
- **A string carrying a credential, anywhere:** a URL userinfo password
  (`scheme://`, a stacked `jdbc:mysql://` or a scheme-relative `//`); a URL query
  pair whose name is credential-shaped, or whose `;key=value` run carries a
  credential; a credential property in a URL's `;key=value` tail
  (`sqlserver://h;user=u;password=p`); the Oracle thin-driver userinfo
  (`jdbc:oracle:thin:user/password@…`); a credential segment of a semicolon-delimited
  connection string (`Server=h;Password=p`, `Pwd=`, `AccountKey=`; quoted values
  honoured); a credential keyword of a libpq keyword/value string (`host=h
  password=p`, an unquoted `;` in the value included); and a scheme-less userinfo
  password (`user:password@host/db`).
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
