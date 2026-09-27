---
"@objectstack/lint": minor
---

`rls-predicate-unenforceable` now reports the RLS predicates the runtime refuses on every request, which the shape check cannot see (#19951).

`validateRlsPredicateEnforceability` judged a predicate's shape with every `current_user` value replaced by a placeholder, so a predicate whose refusal depends on a value passed `os validate` cleanly and enforced nothing. Its reference pass now reports two such classes as `error`, so **a previously green `os validate` can fail** on a stack that declares one of these predicates. Measured over this repository, 0 of the 126 authored `using` / `check` predicates (77 of them `current_user` predicates) change verdict.

**A `current_user` value of the wrong type for its position.** The kernel resolves `positions`, `org_user_ids` and `accessible_org_ids` as lists and `id`, `organization_id` and `email` as one value on every request, and `current_user` alone is the whole caller context. The compiler refuses a mismatch on every request, and the RLS compiler drops the policy: reads return no rows and `check` writes are refused 403.

- FROM silent TO `rls-predicate-unenforceable`: `record.f != current_user.org_user_ids` (any list key). Write `!(record.f in current_user.org_user_ids)`.
- FROM silent TO `rls-predicate-unenforceable`: `record.f == current_user.positions` and `!(record.f == current_user.positions)`. Write `record.f in current_user.positions`, keeping any enclosing `!(...)`.
- FROM silent TO `rls-predicate-unenforceable`: `record.f in current_user.id` (any one-value key). Write `record.f == current_user.id`.
- FROM silent TO `rls-predicate-unenforceable`: `record.f in current_user`, `record.f.startsWith(current_user)`, `.endsWith(current_user)` and `.contains(current_user)`. Name the key that holds the value, for example `record.f in current_user.org_user_ids` or `record.f.startsWith(current_user.email)`.
- FROM silent TO `rls-predicate-unenforceable`: `record.f.startsWith(current_user.org_user_ids)` (a list handed to a string method). Write `record.f in current_user.org_user_ids`, or pass a one-value key.

**A `null` list member or `null` ordering bound.** The platform refuses both in every filter it is sent. The RLS compiler runs that check on its own filter too (#20212) and drops the policy on every request: reads return no rows and `check` writes are refused 403.

- FROM silent TO `rls-predicate-unenforceable`: `record.f in ['a', null]` and `!(record.f in ['a', null])`. Write `(record.f in ['a'] || record.f == null)`, or drop the `null` member.
- FROM silent TO `rls-predicate-unenforceable`: `record.f in [null]`. Write `record.f == null`.
- FROM silent TO `rls-predicate-unenforceable`: `record.f > null`, `>= null`, `< null` and `<= null`. Write `record.f != null` or `record.f == null`, or compare against a real bound.

Each finding's hint carries the rewrite with the predicate's own field and key.

**Unchanged.** A comparison whose answer depends on which caller asks, such as `current_user.email == 'ops@acme.com'`, stays silent: it grants everything to the caller it names and is refused for everyone else, so no probe value can stand for it. The list literal (`record.f != ['a', 'b']`) and the bare root under `==` / `!=` (`record.f != current_user`) were already reported. `field == current_user.id`, `field in current_user.org_user_ids` and `field == null` stay clean.
