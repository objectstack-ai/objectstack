---
"@objectstack/spec": patch
"@objectstack/plugin-audit": patch
---

docs(spec,plugin-audit): record that the parent-record write gates match ownership at `own` BY DESIGN (#7144)

Documentation only — no gate changes what it returns for any input.

`ISharingService`'s write gates widen ownership "by write DEPTH", but that depth
is an INPUT the caller supplies: the CRUD middleware resolves it for the object
of the operation in flight and stamps it on the operation context. The
`sys_comment` gates (`@objectstack/plugin-audit`) and the `sys_attachment` kit
(`@objectstack/service-storage`) ask this service about the PARENT record's
object, so the stamped depth belongs to a different object and is dropped — and
the owner-match runs at its narrowest, `own`. A caller whose write depth on the
parent is `unit` / `unit_and_below` / `org` can therefore edit that parent
directly and is refused when editing a comment or attachment on it.

That divergence is deliberate and runs in the restrictive direction (refusals,
never a leak). The contract now says so, and — the part that matters for anyone
tempted to "fix" it — says WHY the alternative is not merely unimplemented:
`ISecurityService.resolveWriteScope`, the only tool a package outside
`plugin-security` has for the parent's depth, fails OPEN, because
`getEffectiveScope` returns `'org'` when no permission set mentions the object
at all — indistinguishable from a genuine `modifyAllRecords` holder. Handed to a
write gate as the depth it becomes authoritative on its own and the owner-match
short-exits `true` for every owned row of that object. Inheriting the parent's
edit authority starts with a depth primitive that can tell "org depth" from
"nothing matched", not with these gates.
