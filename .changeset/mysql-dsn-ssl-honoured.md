---
'@objectstack/service-datasource': patch
---

A mysql datasource that declares TLS now gets it, on both branches of the arm and in the spelling `mysql2` can read (#8874).

Two defects with one cause — `buildMysqlConnection` resolved the TLS option and then handed it to a client that could not use it, or to nobody at all.

**A declared `ssl` was dropped on the DSN branch.** With a `config.url` present the arm returned before the resolved option could be attached, so a datasource that declared TLS **and** wrote a connection url negotiated none — declared, resolved, dropped, with no diagnostic — while the discrete-fields branch of the same arm carried it. Whether a connection was encrypted therefore depended on which branch of one arm the datasource happened to take. The postgres arm has honoured this case since #4410 with its reasoning written in-code, and the same argument holds here: `mysql2` reads a uri and the `ssl` option as separate channels, and keeps the explicit key.

**`ssl: true` was never a `mysql2` value.** Measured on mysql2 3.23.1, `new ConnectionConfig({ …, ssl: true })` throws `SSL profile must be an object, instead it's a boolean` — and `true` is exactly what a declared `ssl: { enabled: true }` with no certificate material resolves to, as does the `config.ssl` shorthand, whose schema is a boolean and so has no other authorable value. The branch that appeared to honour the declaration was therefore throwing on every connection acquisition for the commonest way of writing it. The resolved `true` is now translated to the empty-options object it is already documented to be short for (`{}`, which mysql2 normalises to `{ rejectUnauthorized: true }` — its own default for an object, not a verification policy chosen here). Certificate objects, `false`, and a stored profile name pass through untouched.

**What does not change.** The DSN branch returns an object instead of the bare connection string **only when a declared `ssl` actually resolved** (or a secret is bound, unchanged from #8696). A datasource that declared neither still gets the byte-identical string knex has always parsed for it. Where the switch does happen, knex's own parse of the string and mysql2's parse of the same value as `uri` were compared key-by-key (`host`/`port`/`user`/`password`/`database`/`charset`/`timezone`/`connectTimeout`/`flags`/`socketPath`/`multipleStatements`) across the bare-username, embedded-password, no-userinfo, portless, percent-encoded-username and query-parameter forms — identical in every case, and pinned as a test rather than measured once.

Nothing that declared no TLS moves, so the behaviour change is confined to the datasources that were already broken: the ones connecting in cleartext against their own metadata, and the ones that could not connect at all.
