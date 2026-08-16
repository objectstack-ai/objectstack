---
"@objectstack/service-datasource": patch
---

fix(security): a mongo datasource that binds `external.credentialsRef` and authors a connection URL now connects with the bound credential instead of none (#8696)

<!-- adr-0087: not-required (no-migration-prescription) One connect-time
behaviour fix inside the driver factory. No authorable key is added, renamed,
retired or tombstoned — `MongoConfigSchema` already declared this behaviour and
the runtime simply did not perform it — so there is no stored shape to convert. -->

`buildMongoUrl`'s DSN branch returned the authored `config.url` verbatim and
applied `spec.secret` nowhere. A mongo datasource that bound its secret through
`external.credentialsRef` (or the connection form's secret field) therefore
connected with **whatever the URL itself carried** — which, since #8082 refuses
a `user:password@` userinfo at the publish door, is **no credential at all**.
Measured on `origin/main` @ `792524c22`, mongodb 7.5.0:

```text
config.url 'mongodb://app@db.internal:27017/app' + a bound secret
  -> MongoClient credentials {username:'app', password:''}
```

The connect path is fail-closed on a ref it cannot resolve, so an operator
reasonably reads "the datasource connected" as "the bound credential was used".
It was not: the credential was declared, resolved, injected into the factory —
and then dropped at the last call site with no diagnostic. That is
declared-≠-enforced (Prime Directive #10) one layer below the spec, and
`MongoConfigSchema.url` is the contract it broke, verbatim: *"bind the secret
(`external.credentialsRef` / the connection form's secret field) and **it is
injected at connect time**. A bare username (`user@host1`) stays writable."*
The arm's behaviour was decided by whether the operator happened to author a
URL — the composed branch five lines below had honoured the secret since #4410.
This closes the last arm of the family #7314 / #7385 / #8152 / #8875 have each
closed one driver at a time.

**The fix injects `options.auth` beside an unmodified url — it does not rewrite
the URL.** Measured on mongodb 7.5.0 (the `MongoClient` constructor resolves
credentials eagerly, so all of it is assertable with no server):

```text
'mongodb://app@db.internal:27017/app'  + auth{app,BOUND} -> password BOUND
'mongodb://app:embedded-legacy@h/app'  + auth{app,BOUND} -> password BOUND
'mongodb://app@h1:27017,h2:27017/app'  + auth{app,BOUND} -> password BOUND
'mongodb+srv://app@c0.example.net/app' + auth{app,BOUND} -> password BOUND
'mongodb://app@h/app?authSource=admin' + auth{app,BOUND} -> source admin
```

So the authored URL is handed over byte for byte, no second dialect of
`mongodb://…` enters this repo, the multi-host and `+srv` forms ride through
unharmed, and a bound secret **wins** over a legacy password embedded in a
stored pre-#8082 row — the same precedence the mysql arm states, reached by a
different mechanism because the clients merge in opposite directions. The
userinfo **username** `auth` also requires is read through the platform's own
DSN grammar (`urlUserinfoUsername`, #8876) and percent-decoded at the call
site: `new URL()` cannot even parse the multi-host form this schema documents,
and a second hand-rolled copy of those boundaries is the shape #8082's ruling
rejects by name.

**A URL that names no user gets nothing, deliberately.** `auth` is not
constructible from a password alone, and inventing an empty username is
measurably worse than silence: `mongodb://db.internal:27017/app` carries no
credentials at all today, and would carry `{username:''}` — a guaranteed
handshake failure — if the arm injected regardless. Injection happens only
where the URL already declares authenticated intent, which is also exactly what
the composed branch has always done with the same input. Making that
contradictory pair (a bound `credentialsRef` beside a user-less URL) loud
belongs at the authoring door, where both halves are visible at once; it is
filed rather than guessed at here.

**Blast radius is exactly the broken class.** A datasource that binds no secret
reaches the client byte-for-byte as before, and the `options` passthrough keeps
arriving verbatim — the injected `auth` is merged into it, not assigned over
it.

The pin extends `__tests__/bound-secret-dsn-branches.test.ts` (the mysql half's
file) and asserts at the **client-construction seam**: every mongo assertion
reads `MongoClient`'s own resolved `credentials`, never the URL string the
factory built. That distinction is load-bearing — a test asserting
`buildMongoUrl`'s return value would have passed throughout this defect's life,
and the postgres arm passes the equivalent config-layer assertion while still
being broken one layer lower.
