---
"@objectstack/spec": minor
---

feat(spec): refuse the contradictory pair "`external.credentialsRef` bound + a composed mongo config naming no `username`" at publish (#9147)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`, like the sibling refusals #8337,
#9040 and #9041; the migration prescription is registered under protocol major
18, where `os migrate meta` users will look).

The COMPOSED-branch twin of #9041, and the last unserved corner of the "absence
must be loud" half of the #8696 family. #9041 refused a bound
`external.credentialsRef` beside a mongo `config.url` whose userinfo names no
user; its fences deliberately scoped that to the URL branch, leaving the same
defect one branch over still accepted:

```yaml
driver: mongodb
config: { database: events, host: mongo.internal }
external: { credentialsRef: sys_secret:01J9ZK4T2N }
```

With no `config.url` the driver factory COMPOSES the connection URI from the
discrete fields, and the bound secret has exactly one route into it — the
userinfo written beside a username (`buildMongoUrl`: `const auth = user ? … :
''`). A falsy `username` closes that route, and this branch has no second one:
`buildMongoAuth` returns early when there is no `url`, because the composed
branch injects THROUGH the URI it builds rather than beside it. So the artefact
above parsed green, connected **anonymously**, and told the operator nothing —
byte for byte the defect #9041 closed, one branch over. Both branches were
measured to agree on this input before either was refused, so this inherits
#9041's ruling rather than re-opening it.

The refusal is a one-condition widening of the same datasource-level
refinement (the one door that sees both halves at once), pathed at
`config.username`, and it names BOTH valid authoring fixes without prescribing
either. Its message is deliberately **not** #9041's: there `config.url`
supersedes the discrete `username` so the only fix is the URL's userinfo, while
here `config.username` is the live field — a refusal naming a remedy that does
not apply is worse than no refusal.

**Scope fences, each measured**: mongodb arm only, legacy `driver: 'mongo'`
rows judged identically via `resolveDriverId` (the postgres arm is not widened
to — #8873 measured `pg` receiving the bound password regardless of the DSN
naming a user); "names no username" is `undefined` **or** `''`, the two
spellings that are falsy at the composer's `user ?` test and therefore drop the
secret identically (note the deliberate asymmetry with #9041's present-but-empty
userinfo carve-out: there `MongoClient` itself throws, so the shape is already
loud, while `username: ''` here connects — silently); a non-string `username` is
the driver-config gate's finding, not this one; an empty-string `credentialsRef`
is not a binding (mirrors the connect path's truthy check); a composed config
that names a user is untouched — that is the branch #8696 already works on.

Also corrected while redrawing this boundary: **an empty `config.url` is the
composed branch, not the URL branch.** `buildMongoUrl` opens `if (explicit)
return explicit;`, so `url: ''` falls through and composes from the discrete
fields — but #9041's arm judged it as a URL "naming no user" and refused it even
with a live discrete `username`, i.e. rejected at publish a datasource that
connects authenticated at runtime. Both arms now split on the factory's own
branch test, so each judges exactly the branch that will run.

## FROM → TO

```yaml
# before — parsed green; the binding was a silent no-op and the datasource
# connected anonymously with the bound secret unused
driver: mongodb
config: { database: events, host: mongo.internal }
external: { credentialsRef: sys_secret:01J9ZK4T2N }

# after (authenticated intent) — name the user; the bound secret is
# interpolated beside it into the composed URI at connect (#8696)
driver: mongodb
config: { database: events, host: mongo.internal, username: svc }
external: { credentialsRef: sys_secret:01J9ZK4T2N }

# after (anonymous intent) — drop the binding that could never land
driver: mongodb
config: { database: events, host: mongo.internal }
```

There is deliberately no automatic rewrite: the two fixes are contradictory
intents — authenticate (name the user) versus anonymous (drop the binding) —
and choosing between them requires knowing what the datasource is for.

<!-- adr-0087: registered datasource-credentialsref-mongo-composed-no-username-refused -->
