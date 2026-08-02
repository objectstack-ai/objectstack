---
"@objectstack/spec": patch
---

Reference docs: import examples are now spelled from the package's real export surface

`build-docs.ts` derived each page's "TypeScript Usage" block from the JSON Schema file
name — the value import verbatim, the `import type` line with a `Schema` suffix stripped —
and nothing verified either name existed. `check:docs` could not catch it: it diffs the
generator's output against the committed docs, so a name the generator invents stays "in
sync" with itself forever. 150 of the committed `import type` names did not compile, and
the `.parse()` example called a type rather than the schema const.

Both lines are now resolved against `api-surface.json`, the committed record of every
`name (kind)` per entry point: only names the entry really exports are emitted, and the
example parses with the actual schema const. A name that resolves to nothing is dropped
from the page and recorded in the new `docs-import-surface.baseline.json` — a shrink-only
ratchet, so removing a type alias while its schema keeps a reference page now turns
`check:docs` red instead of silently publishing a dead import.
