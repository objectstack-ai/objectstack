---
'@objectstack/cli': minor
---

feat(cli): `os meta register` takes `--force`, so a CLI user can send the acknowledgement the `409 DESTRUCTIVE_CHANGE` refusal prescribes (#23480)

Clause-②: yes (widening)

**What is new.** `os meta register` declares a boolean `--force` flag, off by default and with no short alias. When given, it is forwarded as the SDK's `SaveMetaItemOptions.force`, sent as `?force=true`:

```bash
os meta register object --data object-def.json --force   # applies a save that drops or transforms existing data
```

**Why.** The save door `PUT /api/v1/meta/:type/:name` refuses an `object` save that removes a field or changes a field's type incompatibly, with `409 DESTRUCTIVE_CHANGE` and a message ending "re-submit with ?force=true to proceed." The command had no way to send that parameter, so a CLI user was told to do something the CLI could not do.

**What a refusal now prints.** The server's message is passed through unchanged. On a run without `--force`, one more line names the flag: in the text output as a warning line under the error, and in the `--format json` envelope as a new `hint` key beside `error`, `code` and `httpStatus`. Every other failure is reported exactly as before, with no `hint`.

**Unchanged.** Without `--force`, the command sends the same request as before: no `force` parameter at all, never `?force=false`. A non-destructive save with `--force` lands exactly as the same save without it. `--force` combines with `--package`.
