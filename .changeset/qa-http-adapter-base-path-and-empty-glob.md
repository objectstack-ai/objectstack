---
"@objectstack/core": patch
"@objectstack/cli": minor
---

fix(core,cli): `os test`'s record action types reach the served route, and a zero-match glob states its posture (#7848)

Two defects on the same surface, both measured on a booted showcase while
authoring the `qa` platform-checklist item.

## 5 of the 8 declared action types could not reach a stock server

`HttpTestAdapter` built `${baseUrl}/api/data/:object`. A stock server serves
`{apiPath}/data/:object` with `apiPath` = `/api/v1`, so every record-shaped
member of `TestActionTypeSchema` was one version segment short and answered
`HTTP Error 404: {"error":"Not found"}` — `create_record`, `read_record`,
`update_record`, `delete_record` and `query_records`. `update_record` was wrong
twice: it issued `PUT` where the route is `PATCH`, and there is no `PUT`
sibling to fall back on. Only `api_call` and `wait` executed, which is why the
gap survived — everything the Quality Protocol had been used for so far was
expressible through `api_call`.

All five now address the route the server registers, and `update_record` uses
`PATCH` with `id` peeled off the body (the body is the field patch, not a
column write). The prefix is no longer written down: it is derived from the two
schemas `RestServer` itself resolves from — `RestApiConfigSchema`
(`apiPath ?? {basePath}/{version}`) and `CrudEndpointsConfigSchema.dataPrefix`
— so the adapter's default cannot drift from the declaration again. Defaults
only: a deployment that overrides `api.apiPath` or `crud.dataPrefix` is still
out of reach for the record action types, and `api_call` remains the escape
hatch there.

`run_script` still has no adapter branch and still throws by name; nothing here
implements it.

## A run that loaded no suite reported success silently

`os test 'qa/nothing-matches-*.test.json'` exited **0** after executing nothing,
so a CI step whose glob stopped matching (a renamed directory, a moved suite)
reported success forever.

The default exit status is deliberately unchanged — a repository that
legitimately ships no suites must not begin failing CI. What changes is that the
posture is now **declared** rather than accidental:

- `os test --help` states it: a pattern matching no suite prints
  `Found 0 test suites.` and exits 0;
- **new flag `--fail-on-empty`** opts into the strict reading and exits 1 on an
  empty match;
- `Found N test suites.` is emitted on **every** run, `Found 0 test suites.`
  included. It was previously printed only when the count was positive — absent
  from exactly the run where a caller needs it to tell "every suite passed" from
  "there were no suites".

Both exit-code arms now carry explicit assertions over a real child process.
