---
"@objectstack/plugin-security": patch
---

fix(security): comment moderation stops being dead behind the platform delete floor — `sys_comment` gets the per-object delete policy that lets a parent-record editor moderate (#8839)

<!-- adr-0087: not-required (no-migration-prescription) One per-object RLS policy
added to a shipped default permission set. Nothing authorable is renamed,
retired or tombstoned, so there is no conversion to register. The behavioural
change is that a `sys_comment` DELETE by a non-author is no longer refused by the
platform's ownership floor before plugin-audit's author-or-parent-editor gate is
consulted. -->

`plugin-audit` implements an explicit **author-or-parent-editor** rule for
removing a comment — *"Rewriting or removing someone else's words is moderation,
hence the tighter author-or-parent-editor rule"* — deriving a comment's access
from the record its `thread_id` names, the way an attachment's derives from its
parent.

**That rule was unreachable in every org-bound deployment.** `member_default`
ships a wildcard row-level delete floor:

```
{ name: 'owner_only_deletes', object: '*', operation: 'delete',
  using: 'created_by == current_user.id', positions: ['org_member'] }
```

A parent-record editor moderating someone else's comment holds `org_member` and
is not the comment's `created_by`, so the floor answered `PERMISSION_DENIED`
before the moderation rule was ever consulted. The floor is a **second,
parent-blind implementation** of "who may remove this row", and on `sys_comment`
it was winning against the one authority that can actually see the parent.

**Why nothing caught it:** the only fixture proving the capability
(`comments-permission-matrix.dogfood.test.ts` case (d)) booted **org-less**, so
its principals resolved `positions: ['everyone']`, the positions-gated floor never
applied, and the case passed over the broken behaviour — #8023's disarm shape.

**The fix is one per-object policy** in `member_default`:

```
{ name: 'sys_comment_moderation', object: 'sys_comment', operation: 'delete',
  using: 'id != null', positions: ['org_member'] }
```

It contributes the **alternate match** that stops the floor pre-empting the gate;
it does not re-implement the rule. The parent-editor limb is not expressible as a
row predicate — the authority lives on another record and RLS has no join — so
`id != null` is every row of this object said plainly, the same spelling and
reasoning as the existing `sys_invitation_org_admin`. What actually narrows a
`sys_comment` delete is, in order: the object-level delete bit (this set grants no
`allowDelete` at all), Layer 0's tenant wall, and then plugin-audit's gate, which
requires every matched row to pass and fails closed on a thread naming no
authorizable parent. That gate is not optional — `AuditPlugin` registers
`sys_comment` and installs the gate in the same `start()`.

⛔ **The wildcard floor itself is unchanged.** The widening is scoped to
`sys_comment`, and to the `delete` limb only; the `update` half of plugin-audit's
rule deliberately stays under the floor.

The `positions: ['org_member']` domain is load-bearing rather than cosmetic: it
confines the widening to exactly the principals the floor binds. An undomained
twin would carry a `using` into a delete class that is **empty** today for
org-less and `everyone`-only principals, switching off the derive-from-select rule
that currently bounds their writes to their readable set — widening them too.

Access-widening approved by maintainer ruling (2026-08-15), which is what the
standing manual floor on relaxing an access-control boundary required.

The pin is the fixture, now **armed**: `orgContext: true` plus `assertArmed` on
both the author and the moderator persona, so the file can never again certify
moderation from a boot structurally unable to observe the floor. Reverse-verified
— with the policy removed and the artifact rebuilt, exactly one case reddens with
`PERMISSION_DENIED` on `sys_comment` and the other nine stay green. The
stranger-without-parent-EDIT case now asserts its refusal code **exactly**
(`RECORD_NOT_ACCESSIBLE`, plugin-audit's gate — not the floor's
`PERMISSION_DENIED`), so the floor silently re-asserting itself over `sys_comment`
cannot pass as a correct refusal.
