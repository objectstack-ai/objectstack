---
"@objectstack/spec": patch
---

docs(spec): restore the historical table name in the ADR-0006 rename sentence (#12485)

The Environment protocol's module doc comment — and therefore the generated
page at `content/docs/references/cloud/environment.mdx` — claimed that
`sys_environment` was renamed to `sys_environment`: a table renamed to itself.
The sentence is not merely stale, it is self-refuting, and it destroyed the one
fact it exists to carry, for the reader who consults it precisely because they
are confused about the rename.

The historical name is `sys_project`, corroborated by `packages/metadata`'s
changelog entry for the platform-objects object renames (`sys_project` →
`sys_environment`, alongside `sys_project_member` and `sys_project_credential`)
and by ADR-0006 v4 itself.

Cause, which generalises past this one line: a mechanical `project` →
`environment` sweep rewrote the *historical* name inside the very sentence
documenting the rename. A sweep that cannot distinguish "the name we use now"
from "the name we used to use" will always corrupt exactly the prose that
explains a rename. **In a sentence that documents a rename, the old name is the
payload — it is not drift, and it must never be "consistency-fixed".**

Fixed at the producer: the `.mdx` under `content/docs/references/` is generated
from the spec source by `build-docs.ts` and pinned by `check:docs`, so the doc
comment in `packages/spec/src/cloud/environment.zod.ts` is the fix site and the
page is regenerated.
