---
"@objectstack/plugin-approvals": patch
---

fix(approvals): refuse `organization` on directory-less approver types instead
of silently ignoring it (ADR-0105 D9)

`user`, `field` and `manager` return EARLY in `resolveApproverSpec` — they name
a person outright rather than expanding a directory. D9's org resolution was
placed after those returns, so an `organization` declared on one of them never
reached the check: it was silently INERT.

That is the one behaviour ADR-0105 D9 rules out and the authoring docs
explicitly promise against ("`organization` on those is refused at runtime").
The `os lint` rule caught it at author time, but the runtime claim was false —
and a stored flow that predates the lint, or one assembled programmatically,
got no signal at all.

Resolution now happens at the top of `resolveApproverSpec`, above every early
return, so the refusal reaches all three types. The ordinary path is unchanged
and still costs nothing: with no `organization` declared the resolver returns
the request's organization without reading anything.

Found by cloud's group-posture dogfood driving a real `group` boot — the
resolver's own unit tests could not see it, because they call the resolver
directly and never traverse the early return.
