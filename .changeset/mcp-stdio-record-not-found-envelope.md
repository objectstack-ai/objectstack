---
'@objectstack/mcp': patch
---

fix(mcp): stdio bridge's `update`/`remove` throw the shared `RECORD_NOT_FOUND` envelope (#8422)

The stdio MCP bridge's `update()` and `remove()` — the two by-id write seams
that probe for the row before mutating it — minted their own local
`recordNotFound(object, id)`, returning a bare `Error` with neither `code`
nor `status`. The HTTP bridge's `callData` path already throws
`recordNotFoundError` (`code: 'RECORD_NOT_FOUND'`, `status: 404`,
`@objectstack/core`, #4435/#5138/#7867) for the identical miss, so the same
operation answered a missing id with two different envelopes depending on
which MCP transport served it.

`packages/mcp/src/stdio-data-bridge.ts` now imports `recordNotFoundError`
from `@objectstack/core` — a dependency the package already declares — and
throws it from both seams instead. `registerObjectTools` still turns the
throw into a tool error exactly as before; only the thrown object's shape
changed. No exported symbol moves and no authorable metadata is affected, so
this ships as a `patch`.
