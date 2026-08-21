---
"@objectstack/cli": patch
---

**Fix:** `os datasource list-tables`, `os datasource introspect` and
`os datasource validate` now read the response envelope the server actually
emits, so all three work against a live server for the first time (#10675).

The three commands read the pre-#3843 **flat** shape — `body.tables`,
`body.draft`, `body.results`, and `body.error` as a string — while every REST
body the platform sends is the declared envelope written by `sendOk` /
`sendError`: `{ success: true, data: { … } }` or
`{ success: false, error: { code, message } }`. Nothing failed loudly, because
each payload simply read `undefined` and every command reported that as an
ordinary empty result:

- `list-tables` printed `No remote tables found.` while the server was
  returning two tables.
- `introspect` printed `Failed to generate draft` for drafts the server had
  generated.
- `validate` printed `No federated objects to validate.` and exited **0**
  against drift the server had flagged `missing_column … severity:error` — a
  schema gate green-lighting a CI-breaking condition it had never read.
- An unknown datasource crashed with `TypeError: first argument must be a
  string or instance of Error`, because the error **object** was handed to
  oclif's `this.error()` instead of `error.message`.

`validate`'s exit code is the behaviour change to note: a datasource whose
federated objects have drifted now exits **1** where it previously exited 0. If
you have a pipeline that treats this command as advisory, it starts failing on
drift that was always there.

A body that is **not** the declared envelope is now a loud failure rather than
an empty payload. That distinction is the point: "nothing found" is reachable
only from a server that really said so, never from a response the CLI could not
read. The legacy flat shape is deliberately *not* also accepted — a
consumer-side fallback would re-create the divergence as a second de-facto
contract.
