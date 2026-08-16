---
"@objectstack/spec": minor
---

feat(spec): refuse the contradictory pair "`external.credentialsRef` bound + a mongo `config.url` naming no user" at publish (#9041)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`, like the sibling refusals #8337
and #9040; the migration prescription is registered under protocol major 18,
where `os migrate meta` users will look).

The "absence must be loud" half of the #8696 family, previously unserved:
after #8696 a mongo datasource that binds `external.credentialsRef` and
authors a `config.url` gets the secret injected as MongoClient `auth` — but
`auth` needs a username as well as a password, and with `url` present the only
place the username can come from is the URL's own userinfo. So the injection
is conditional on the URL naming a user:

- `mongodb://app@db.internal:27017/app` + bound secret → injected, correct;
- `mongodb://db.internal:27017/app` + bound secret → **nothing happens** — the
  datasource connects anonymously and the operator is told nothing.

The second shape is a configuration that cannot work as written; it is now
refused at the datasource level (`DatasourceSchema`'s refinement — the one
door that sees both halves at once; a config-level refinement cannot, because
`credentialsRef` sits on the datasource and `url` inside `config`). The
refusal names BOTH valid authoring fixes without prescribing either: add the
username to the URL, or drop the binding.

**Scope fences, each measured**: mongodb arm only, legacy `driver: 'mongo'`
rows judged identically via `resolveDriverId` (the postgres arm injects on a
user-less DSN by its own measured mechanism, #8873, and is not assumed to
share the defect); "names no user" means `urlUserinfoUsername` answers
`undefined` — the present-but-empty userinfo forms already throw in
MongoClient itself (`MongoParseError: URI contained empty userinfo section`);
an empty-string `credentialsRef` is not a binding (mirrors the connect path's
truthy check); the composed branch (no `url`) is untouched — its discrete
`username` field is live. Injecting a fabricated empty username instead of
refusing was measured worse on mongodb@7.5.0: it turns a connection that works
anonymously today into a guaranteed handshake failure. Composes independently
with the sibling refusals (#8082 userinfo, #8336 placeholders, #9040 options
passthrough) — one artefact violating several reports each at its own path.

## FROM → TO

```yaml
# before — parsed green; the binding was a silent no-op and the datasource
# connected anonymously with the bound secret unused
driver: mongodb
config:
  url: mongodb://mongo.internal:27017/events
external:
  credentialsRef: sys_secret:01J9ZK4T2N

# after (authenticated intent) — name the user in the URL; the bound secret
# is injected at connect (#8696)
driver: mongodb
config:
  url: mongodb://app@mongo.internal:27017/events
external:
  credentialsRef: sys_secret:01J9ZK4T2N

# after (anonymous intent) — drop the binding that could never land
driver: mongodb
config:
  url: mongodb://mongo.internal:27017/events
```

There is deliberately no automatic rewrite: the two fixes are contradictory
intents — authenticate (add the username) versus anonymous (drop the binding)
— and choosing between them requires knowing what the datasource is for.

<!-- adr-0087: registered datasource-credentialsref-mongo-url-no-user-refused -->
