---
"@objectstack/service-datasource": patch
---

fix(security): a bound `external.credentialsRef` reaches the postgres SERVER on the DSN branch, not just the knex config (#8873)

A postgres datasource whose `config.url` is a DSN and whose credential is bound
through `external.credentialsRef` (or the connection form's secret field) opened
its connection **with no password at all**. Not a disclosure — a broken binding,
of the fail-quietly kind: `DatasourceConnectionService` resolved the secret
fail-closed, the operator saw a bound credential and a datasource reporting
connected, and the handshake carried nothing.

**This arm was the one that looked correct.** It had an explicit secret branch
and a comment declaring the intent — *"For a DSN, a separately-supplied secret
overrides the embedded password"* — and it emitted
`{ connectionString: url, password: spec.secret }`, which passes any assertion
written against the factory's own output. `pg` discarded the credential one
layer lower:

```js
// pg 8.22.0, lib/connection-parameters.js
if (config.connectionString) {
  config = Object.assign({}, config, parse(config.connectionString))
}
```

Two independent mechanisms destroyed it, either sufficient on its own. `parse()`
emits a `password` key for **every** url — `''` when the url carries no userinfo
password — and `Object.assign` copies that over the injected value, after which
`val('password', …)` falls through to `PGPASSWORD` and the defaults; and knex's
`setHiddenProperty` has already made `password` a non-enumerable own property of
`connectionSettings`, which `Object.assign` does not copy at all. Measured on pg
8.22.0 + knex 3.3.0: `postgresql://app@db.internal:5432/app` with a secret bound
resolved to password `null`, and a stored pre-#8082 url embedding
`app:embedded-legacy@` resolved to `'embedded-legacy'` — the DSN beating the
credential an operator deliberately bound. Since #8082 refuses a
`user:password@` userinfo at the publish door, the credential-free DSN is the
only authorable URL shape for this driver, so this was the shape the connection
form produces.

**The remedy is a third shape, not either sibling's.** The clients merge a DSN
against explicit keys in opposite directions: `mysql2` lets the explicit key win
(`{ uri, password }`, #8875) and mongodb rides in `options.auth` beside an
untouched url (#9042), while `pg` lets the DSN win. So on the postgres DSN
branch — and only when a secret is bound — `connectionString` is gone: the arm
hands `pg` **pg's own parse of the url** (`pg-connection-string`, the client's
parser, so there is no second dialect of `postgresql://…` in this repo to drift
out of agreement) with the credential applied afterwards, where nothing
re-parses over it. Everything else resolves exactly as before, verified
key-by-key across the sslmode, unix-socket, `?options=`, credential-free,
embedded-password and no-userinfo forms.

The competing remedy — keep `connectionString` and splice the secret into the
userinfo — was measured and rejected on two counts: `pg-connection-string`
honours a `?password=` query parameter **over** userinfo, so a stored pre-#8337
row would still lose the bound secret; and it would materialise the cleartext
credential into a string nothing hides (`JSON.stringify` of knex's
`connectionSettings` prints the whole DSN, while a discrete `password` stays
hidden), re-creating at connect time the hardest-to-redact credential spelling
that #8082 refuses to let anyone author.

**What changes for an existing deployment.** A DSN datasource that binds no
secret is byte-for-byte unaffected — it still hands `pg` the url unparsed. One
behaviour worth knowing: a stored pre-#8082 row that embeds a password in its
url *and* binds a credential now authenticates with the **bound** credential,
which is the precedence this arm's own comment always claimed and both sibling
arms already apply. A DSN naming no user still receives the credential (unlike
the mongodb arm's deliberate no-op there): `pg` sends a password only when the
server asks for one, so injecting cannot break a datasource that connects today.
Finally, a url `pg`'s own parser rejects (a multi-host DSN, which node-postgres
does not implement) is now refused when the driver is built rather than on first
query — the same error, named and located, with the url deliberately not echoed
because it may itself embed a credential.
