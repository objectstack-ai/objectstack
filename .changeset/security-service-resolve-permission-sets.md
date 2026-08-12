---
"@objectstack/spec": minor
"@objectstack/plugin-security": patch
---

feat(spec,plugin-security): publish the caller's resolved permission SETS on the `security` service (#7616)

`ISecurityService` could report the caller's effective permission-set **names**
(`resolvePermissionSetNames`) and nothing else. That is the right primitive for
an audience check — "does this caller hold `sales_manager`?" — and the wrong one
for a **merge**. A consumer that must fold the caller's grants into one answer
needs the sets themselves: `objects`, `fields`, `systemPermissions`,
`tabPermissions`. None of the four is reachable from a name.

So the two consumers that need a merge re-implement the resolution instead.
`/auth/me/permissions` and `/me/apps` (`plugin-hono-server`'s
`current-user-endpoints.ts`) each resolve the caller's permission sets by hand,
alongside `SecurityPlugin`'s own copy on the data plane — **one rule, three
copies**, and it has now drifted from the enforcement path three times, each
divergence found only after it reached a user:

- **#7608** — the plugin applied the ADR-0090 D5 baseline additively while both
  endpoints kept the `resolved.length === 0` fallback cliff, so a member's first
  grant took them from **2 apps to 1** on `/me/apps`.
- **#7555 / PR #7605** — an app-declared `isDefault` set *displaced*
  `member_default` here rather than composing with it.
- **#6334** — the same file's grant aggregation missed `sys_user_position`
  entirely; closed by delegating to `resolveUserAuthzGrants`, which is the
  precedent this extends one step further.

**New: `ISecurityService.resolvePermissionSetsForContext(context)`** — the same
resolution `resolvePermissionSetNames` reports the names of, returned whole and
in resolution order. Implementations must return the sets their own enforcement
path resolved (positions expanded, the D5 baseline applied additively, the D10
agent-principal rule honoured), never a re-derivation. Merge semantics stay with
the caller on purpose: two consumers legitimately project different subsets of
the same sets, and folding a merge in here would make the method a fourth copy
of the rule rather than the one source of its input.

**It is OPTIONAL, and that is load-bearing.** The contract's availability rule
has consumers resolve this service as `Partial<ISecurityService>`, so a caller
must keep its own resolution as the fallback until a floor version carrying the
method can be assumed. Declaring it optional makes that degradation a property
of the type — the unguarded call does not compile — rather than a promise in
prose.

`plugin-security` exposes it on the **registered service literal**, not merely
as a public class member. That distinction is the whole point: the two
consumers must never take a runtime dependency on `plugin-security` (it is
optional in the stacks those endpoints serve), so the service locator is the
only seam that can carry the delegation, and a method the class declares but the
literal does not expose is unreachable across it.

**One implementation gap closed so the declaration is true rather than
nominal.** The plugin's `sys_permission_set` loader hydrated `objects`, `fields`
and `systemPermissions` but dropped `tab_permissions`, so every **DB-authored**
set came back without the column `/me/apps` filters its app list with. Nothing
on the data plane reads `tabPermissions` (the evaluator never mentions it), so
this is inert for enforcement today — but shipping a contract that promises the
sets whole over a loader that drops a quarter of them is exactly the
declared-≠-delivered defect this card exists to prevent. The row is already
fetched in full: no extra query, one JSON parse.

**No behaviour changes today.** The method has no caller yet — by design. The
call sites are step 2 and land separately, because `/me/apps` deliberately
projects a narrower column set than `/auth/me/permissions`, so delegating
changes which columns load on both surfaces: a user-visible change that wants
its own before/after measurement rather than riding along on a contract
addition.

Also corrects a stale doc-comment on `resolveFallbackPermissionSets`, which
still described the `resolved.length === 0 && fallbackName` second step that
PR #7615 deleted (that guard *was* the fallback cliff D5 abolishes).
