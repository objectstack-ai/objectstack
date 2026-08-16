---
"@objectstack/spec": minor
"@objectstack/service-datasource": patch
---

feat(spec): refuse a credential in the mongo options passthrough (`config.options.auth.password`) at publish (#9040)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

The FOURTH spelling of the same inline secret: #7990 refused the top-level
`password` key, #8082 the URL userinfo (`user:password@host`), #8337 the
credential-bearing URL query parameters — and the MongoClient `options`
passthrough stayed open one syntax over.
`options: { auth: { username, password } }` parsed green, persisted the
password cleartext into `sys_metadata` (served back by the ordinary data API,
unredacted), and genuinely authenticated: measured on `mongodb@7.5.0`, the
client the driver spreads `config.options` into, the block is transformed into
`MongoCredentials` — so the workaround was live, not inert.

**What is refused** (write door, closed measured list
`MONGO_OPTIONS_CREDENTIAL_PATHS` behind `credentialFreeMongoOptions`, composed
with the #8336 placeholder refusal on the same slot): a NON-EMPTY STRING
`options.auth.password`, with the binder prescription — and the "wins over"
reassurance is true for this syntax: a bound `external.credentialsRef` secret
outranks the passthrough `auth` block at connect (#8696, measured).
Deliberately not refused, each measured: `auth.username` alone (#8876's
asymmetry — a username is not credential material), an empty password (the
passthrough twin of `user:@host`), every legitimate passthrough option
(`replicaSet`, `tls`, timeouts — byte-identical pins),
`authMechanismProperties.AWS_SESSION_TOKEN` (the v7 client itself throws on it
under MONGODB-AWS and nothing reads it otherwise), and the binder-slotless
client secrets (`proxyPassword`, `tlsCertificateKeyFilePassword`, `key`,
`passphrase`) — refusing those would name a remedy that does not exist (the
binder fills exactly one slot; the turso-`encryptionKey` posture, #8081
item 4).

**Read half** (additive, never the substitute — #8082's ruling): stored
passthrough secrets are now redacted on every read exit —
`options.auth.password` plus the binder-slotless names above and
`AWS_SESSION_TOKEN` — reported as dotted `redactedKeys`
(`options.auth.password`), which the metadata write door's generic
carry-forward already walks, so an untouched "Save" keeps the stored
credential on both admin doors (`restoreRedactedConfig` mirrors per leaf).
The #8155 credential-migration planner refuses a stored passthrough-credential
row with the per-row remedy instead of planning `nothing-to-migrate` over live
cleartext (dropping only the nested leaf would leave an `auth` block the
client refuses at construction, measured).

## FROM → TO

```yaml
# before — parsed green; password stored cleartext in sys_metadata and
# resolved into MongoCredentials at connect
driver: mongodb
config:
  url: mongodb://app@mongo.internal:27017/events
  options:
    replicaSet: rs0
    auth: { username: app, password: PLAINTEXT-IN-METADATA }

# after — rejected with the binder prescription; bind the secret instead
driver: mongodb
config:
  url: mongodb://app@mongo.internal:27017/events
  options:
    replicaSet: rs0
external:
  credentialsRef: sys_secret:01J9ZK4T2N   # or the connection form's secret field
```

There is deliberately no automatic rewrite: moving the value requires
encrypting it into `sys_secret` through a running secret binder, which a
source-file transform cannot do — and auto-dropping only the nested password
would leave an `auth` block the MongoDB client refuses outright.

<!-- adr-0087: registered datasource-config-mongo-options-credential-refused -->
