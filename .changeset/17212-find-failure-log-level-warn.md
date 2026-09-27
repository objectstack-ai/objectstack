---
"@objectstack/objectql": patch
---

fix(objectql): a failed `find` reports at `warn`, not `error` — the caller was already told (#17212)

`find` ends its `catch` with `throw e`, and one frame down `reportFindFailure`
logged every failure it did not classify as a missing table at ERROR. AGENTS.md
→ *Degradation log levels* names that exact shape and forbids it: "a failure
handed to the CALLER is not a degradation at all … Do not bolt a `logger.error`
onto such a site." It is the read-door twin of the write doors' move to `warn`
(#17052).

**Nothing else about the entry moved.** Same message (`Find operation failed`),
same `object` meta, and the message and stack still travel with it: the `Logger`
contract gives an `Error` slot to `error`/`fatal` only, so the engine builds the
`{ error: { message, stack } }` meta that slot used to build — handing the Error
to `warn` as meta would have serialised `{}`, because those two fields are
non-enumerable. The throw is unchanged, and so is the missing-table branch,
which stays at `debug` without a stack. On the SQL read path the fault is also
reported one frame down on the driver's own `warn` line, as before.

If you grep your logs for this message, keep the message and drop the level
from the pattern. If you alert on error-level lines from `@objectstack/objectql`,
a failed read no longer raises one — the read's exception still does.
