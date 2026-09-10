---
"@objectstack/objectql": patch
---

fix(objectql): a refused write reports at `warn`, not `error` — the caller was already told (#17052)

`insert`, `update` and `delete` each end their `catch` with `throw e`, then
logged the failure at ERROR one statement earlier. AGENTS.md → *Degradation log
levels* names that exact shape and forbids it: "a failure handed to the CALLER
is not a degradation at all … Do not bolt a `logger.error` onto such a site."

**This moves published behaviour**, which is why it is a changeset rather than a
`skip-changeset`: the level is what an operator greps, and at least one consumer
reads it structurally. `scripts/publish-smoke.sh` fails a boot on any
error-level line (`SMOKE_ERROR_LOG_PATTERN`), and that is how the defect was
found — `@better-auth/oauth-provider` seeds `sys_oauth_resource` in `insertOnly`
mode and documents its `identifier` UNIQUE constraint AS its race-safety
mechanism, catching the collision and continuing at `debug`. Our line was
emitted before that catch ever ran, so a healthy first boot of every fresh
`create-objectstack` project printed `ERROR Insert operation failed` and red-lit
`publish-smoke / packed-tarballs` for six consecutive runs on a candidate whose
auth and CRUD probes were all green.

**Nothing else about the entry moved.** Same message, same `object` meta, same
redaction (#8682: the bound statement and its values stay cut from `message`
and `stack`), same subject (#14095: the entry carries the driver's own error —
a `DuplicateRecordError`'s `cause` — never the envelope, so the failing column,
MySQL's index name and the driver's frames survive). The `Logger` contract gives
an `Error` slot to `error`/`fatal` only, so the engine now builds the
`{ error: { message, stack } }` bag that slot used to build; handing the Error
to `warn` as meta would have serialised `{}`, because those two fields are
non-enumerable. The rendered line is byte-identical apart from the level word,
and that equivalence is pinned rather than asserted.

If you grep your logs for these three messages, keep the message and drop the
level from the pattern. If you alert on error-level lines from `@objectstack/objectql`,
a refused write no longer raises one — the write's exception still does.
