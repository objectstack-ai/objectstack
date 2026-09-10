---
'@objectstack/plugin-security': patch
---

security(rls): the RLS compiler refuses `RESERVED_RLS_MEMBERSHIP_KEYS` by name

A caller-supplied `ExecutionContext.rlsMembership` entry could supply a RESERVED
kernel key — `id`, `organization_id`, `positions`, `org_user_ids`,
`accessible_org_ids`, `email` — whenever the kernel had not resolved a value for
that key on the request. `RLSCompiler.compileFilter` admitted a membership key on
the test `userCtx[key] === undefined` ("did the kernel happen to resolve one"),
not on whether the key is reserved, so an absent kernel value handed the name to
the bag.

The direction was widening. With the key unresolved, the predicate referencing it
fails CLOSED — it joins the dropped-policy path and the compile returns the deny
sentinel, which yields zero rows. The bag instead produced a satisfiable filter
over caller-chosen values, converting a denial into a match.

The merge now refuses reserved keys by name, at the one seam both faces pass
through (the read layer compiles `using` there, the ADR-0058 D4 write gate
compiles `check` there). `stageRlsMembership`'s existing screen covers only the
registered resolver's answer, and only when a resolver is registered at all — it
returns at its first line otherwise — so it could not carry this guarantee.

No behaviour change for non-reserved membership keys, and none when the kernel
did resolve the reserved value: the kernel's value already won, and still does.
A refused key simply stays unresolved, so its policies drop out and fail closed
through the reason vocabulary that already exists.
