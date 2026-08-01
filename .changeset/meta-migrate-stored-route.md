---
"@objectstack/rest": minor
"@objectstack/runtime": minor
"@objectstack/client": minor
---

feat(rest,runtime,client): `POST /meta/_migrate-stored` — run the stored-metadata migration without a shell (#4327)

`os migrate meta --stored` (#4327) gave ADR-0087's stored-metadata chain a finish
line, but only for someone who can reach the deployment's database from a
terminal. A hosted operator cannot, so on a managed deployment the chain had no
finish line at all — just the per-read conversion, running forever, with no way
to assert what protocol the rows are on.

The same pass is now reachable over HTTP:

```ts
const preview = await client.meta.migrateStored();               // writes nothing
const result  = await client.meta.migrateStored({ apply: true });
const flows   = await client.meta.migrateStored({ types: ['flow'] });
```

It returns the same `StoredMigrationReport` the CLI renders, and takes the same
posture:

- **Preview by default.** `apply` must be literally `true`; an empty body, a
  missing body, and `"apply": "yes"` all preview. Nothing is inferred.
- **Gated on `manage_metadata`.** Unlike the single-item `PUT /meta/:type/:name`
  next door, this rewrites every eligible row in the deployment, so it demands
  the ADR-0066 D1 authoring capability rather than just a session, and answers
  `403` otherwise. The gate runs before the protocol is probed, so an
  unauthorized caller cannot use `403`-vs-`501` to learn which kernels can be
  migrated. `/meta`'s anonymous-deny umbrella still closes it to anonymous
  callers first.
- **Attributed to the caller.** The `actor` recorded on the history and audit
  rows names the user who fired it — that is the question those rows exist to
  answer.

**Flows need no extra setup on this path.** The CLI has to boot an inert
automation engine to hold the executor registry ADR-0078's conflict guard needs;
a server already has a live one, and the protocol resolves it from the services
registry itself (#4498), so this route covers flow rows by simply running in the
process that owns them.

Registered on both the REST server and the runtime dispatcher's `/meta` domain,
ledgered in both route ledgers, and mounted before `/:type` so the
leading-underscore segment is never captured as a metadata type name.
