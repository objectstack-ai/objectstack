---
'@objectstack/spec': minor
'@objectstack/service-datasource': patch
'@objectstack/metadata-protocol': patch
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

- **A value under a credential-shaped key:** a non-empty string, a number, non-empty
  bytes (a `Buffer`, a typed array or an `ArrayBuffer`, judged as ONE value), or an
  array holding a non-empty string, number or bytes (an array of objects there has
  each object judged as a credential-shaped object, below). The key
  (`isCredentialShapedConfigKey`) is NFKC-normalised first; a key that is then longer
  than 256 characters, or still holds a non-ASCII character, is credential-shaped
  without being read. Otherwise it is judged on its whole name, split into words at
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
  `json`, `b64`, `base64`, `data`, `content`, `hex`, `string`, `str`, `raw` or `hash`
  words and a plural `s` (never the `s` of a word already ending in `s`: `sass` is not
  `sas`), when one of its words is `password`, `passwd`, `passphrase`, `secret` or
  `credential`; when its last word is `token`, `pass`, `pw`, `pwd`, `jwt`, `pat`,
  `cookie`, `sas`, `auth`, `authorization`, `bearer`, `apikey` or `privkey`, or folds
  a compound ending (`db_accesstoken`); when its last word is `key` alone or beside
  `api`, `private`, `secret`, `signing`, `master`, `encryption`, `decryption`,
  `account`, `shared`, `client`, `session`, `auth`, `hmac`, `license`, `subscription`,
  `ssh`, `aes`, `storage`, `ssl` or `tls`; when its last word is `signature` beside
  `shared`, `access`, `sas`, `hmac` or `amz`; or when it names service-account key
  material (`serviceAccountKey`, and `serviceAccount` before a dropped qualifier:
  `serviceAccountJson`, `serviceAccountPem`). So `apiKeys`, `tokens`, `privateKeyPem`,
  `apiKeyValue`, `tokenValue`, `keyJson`, `privateKeyData`, `tokenString`, `authData`,
  `encryptionKeyHex`, `pwdHash`, `sslKey`, `tlsKey`, `ssl_key`, `privkey`, `pass`,
  `pw`, `key`, `auth`, `Authorization`, `bearer`, `jwt`, `pat`, `cookie` and `sas` are
  credential-shaped, while `credentialsRef`, `accessKeyId`, `tokenUrl`,
  `passwordFile`, `secretsManagerRegion`, `credentialProvider`,
  `useDefaultCredentials`, `passwordless`, `maxTokens`, `primaryKey`, `partitionKey`,
  `sslMode`, `passive`, `bypass…` and a bare `accessKey` (the identity half of an
  access-key pair) stay accepted. A one-word key with no boundary left (`APIKEY`,
  `accesstoken`, `dbpassword`, `basicauth`) is judged on its folded spelling by the
  same rules: it is credential-shaped when it is one of the stems above (`key` and
  `signature` included), when it holds `password`, `passwd`, `passphrase`, `secret`
  or `credential` followed by nothing, `key`, `accesskey`, `hash` or `string`
  (`secretaccesskey` — not `secretary`), or when it ends in a folded key-material
  compound (`accesstoken`, `apikey`, `privatekey`, `secretkey`, `serviceaccountkey`,
  `serviceaccountjson`, `privkey`, `sslkey`, `tlskey`, `basicauth`, `bearerauth`,
  `digestauth`, …); a one-word key starting with `max`, `min`, `num`, `total` or
  `count` is not. **A bare `key` (or `keys`) in an object** is credential material
  only inside a credential-shaped or header-ish holder (a key one of whose words is
  `header` or `headers`), or when its value looks like a secret
  (`looksLikeSecretValue`): a string — or a list element — of at least 16 characters
  with no whitespace that mixes upper-case letters, lower-case letters and digits, or
  of at least 32 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `+`, `/`, `=`, `_`, `-`,
  `.`, `~` holding a digit; bytes count too. So `{ key: 'email' }` is accepted.
  Everywhere else — a query, fragment or form parameter, a connection-string segment,
  a pair label, a tuple's name — `key` keeps its full judgment.
- **The secret leaves of a credential-shaped object** (`credentials: {…}`,
  `auth: {…}`): every leaf except one whose last word is a descriptor (the list above)
  or an identity (`user`, `username`, `login`, `email`, `issuer`, `audience`, `scope`,
  `scopes`, `algorithm`, `alg`, `domain`, `host`, `hostname`, `port`, `realm`,
  `project`, `tenant`, `subject`, `kind`, `label`, `description`) — so
  `credentials: { type, clientId }` is accepted whole. That exemption is for a LEAF
  (a string, a number, bytes, or a list of them) only: an object below a descriptor
  or identity key stays inside the credential-shaped context
  (`auth: { source: { value } }` refuses `value`).
- **A header's value.** The `value` of a pair object — an object with a `value` and
  any of `name`, `key`, `header` or `headerName` as a string label — when ANY of its
  labels is credential-shaped (`{ key: 'Authorization', value }`); a label itself is
  judged only for an embedded credential. Every element after the name of a
  `[name, value, …]` tuple whose name is credential-shaped — a tuple inside a list
  (two or more elements), or directly under a header-ish key (two elements, or an odd
  number). In a flat list directly under a header-ish key with an even number of
  elements (`rawHeaders: ['Authorization', '…', 'Accept', 'json']`), the element
  after each credential-shaped name at an even position.
- **A string carrying a credential, anywhere** (pair labels included): a
  JSON-encoded object or array (the string's first non-space character is `{` or `[`
  and it parses), walked by these same rules; a URL userinfo password (`scheme://`, a
  stacked `jdbc:mysql://` or a scheme-relative `//`); a URL userinfo username with no
  password, or an empty one, that looks like a secret (the rule above:
  `https://ghp_…@host`); a URL query or fragment pair whose name is credential-shaped
  or is `sig`, or whose `;key=value` run carries a credential (`?api_key=`,
  `&X-Amz-Signature=`, `#access_token=`, `#password=`); a credential property in a
  URL's `;key=value` tail (`sqlserver://h;user=u;password=p`); the Oracle thin-driver
  userinfo (`jdbc:oracle:thin:user/password@…`); a scheme-less userinfo password
  (`user:password@host/db`); a `Name: value` header line, on any line of the string,
  whose name is a header token that is credential-shaped and whose value is non-empty
  (`Authorization: Bearer …`); a libpq keyword/value pair whose keyword is
  credential-shaped, found leniently — a keyword at the start of the string or after
  whitespace, optional whitespace, `=`, and a value single-quoted with `\'` / `\\`
  escapes or a run of non-space characters; any other token is skipped, and an
  unclosed quote runs to the end of the string (`host=h password=p`, an unquoted `;`
  in the value included); a credential segment of a semicolon-delimited connection
  string (`Server=h;Password=p`, `Pwd=`, `AccountKey=`; quoted values honoured); and
  a credential pair of a form-encoded string — no whitespace, an `&` and an `=`, an
  optional leading `?` (`a=b&pass=c`). Every key, segment key, parameter name and
  header name inside a string is judged by the same key rule, the 256-character cap
  included. Bytes outside a credential position are judged by their UTF-8 text, as
  one value.
- **A subtree nested deeper than 16 levels** (a JSON-encoded string's contents
  counted from where the string sits), and **a `Map` or a `Set` anywhere**, which
  cannot be judged and are not accepted unjudged.

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
(`findContractlessCredentials`): a credential value, a subtree too deep to judge and a
`Map` or `Set` are dropped (inside an array element too: spliced from the end of its
array, nulled when siblings follow it), and a credential embedded in a string is
removed from it — a JSON-encoded string keeps its other members, a header line keeps
its name, and a string the rewrite cannot clear is served empty. That covers `/api/v1/meta/datasource` (item, list,
`/published`, `/layers`, history), `/api/v1/datasources` (item and list), the generic
data door over `sys_metadata` / `sys_metadata_history`, and the audit ledger's and
activity feed's copies of those rows (new copies at write time; for copies written
before this release, run `os migrate audit-metadata-bodies --apply`, which projects
them through the same redactor). An untouched
Save of a legacy row's edit form carries the withheld values forward, as before. A
value withheld inside an array is carried onto the element it came from, by identity,
never by index alone: the same index in an array left exactly as served; otherwise the
one element equal to the served one — every non-credential sibling of the withheld
value included — unique in the served array and in the saved one, wherever it now sits
(a reorder, or a sibling deleted before it). A withheld value whose element changed (a
renamed header, an edited sibling field), is gone, or cannot be told apart from
another is dropped; one that is itself an array element (a tuple's or raw-headers
list's value) is carried only into an array left exactly as served.

**`@objectstack/metadata-protocol`:** the `/api/v1/meta` PUT carry-forward
(`carryForwardRedactedValues`) applies that same identity rule to an array element with
no `id` and no identified element below it, and to an array inside an array — which it
used to skip, so an unchanged GET then PUT of a legacy contractless row silently
deleted every credential withheld inside an array. A flow node with no `id` is followed
the same way.

**`@objectstack/service-datasource`:** `restoreRedactedConfig` follows the identity
rule above. The credential-migration planner now reports a
contractless row's top-level keys that hold any such finding as residue and refuses with its remedy, instead of answering
`nothing-to-migrate` while the value sits in cleartext.

**New `@objectstack/spec/data` exports:** `isCredentialShapedConfigKey`,
`embeddedCredentialOf`, `redactEmbeddedCredentials`, `connectionStringCredentialKeys`,
`findContractlessCredentials` (with its `ContractlessCredentialFinding` type, whose
`kind` is `named`, `embedded`, `depth` or `opaque`, and
`CONTRACTLESS_CREDENTIAL_WALK_DEPTH`), `withholdContractlessCredentials`,
`looksLikeSecretValue`, and `isContractlessDriver`.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** No datasource in this
repository uses a contractless driver; plugin drivers in other repositories that
authored inline credentials will see the refusal on their next publish.
