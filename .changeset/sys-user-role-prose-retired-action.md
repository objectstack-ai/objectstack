---
"@objectstack/platform-objects": patch
---

`sys_user.role`'s field description and its `readonly` comment stop pointing at the retired Set Platform Role action (#15188)

Both strings named `set_user_role` / "Set Platform Role", an action retired in #9968 — the description told an operator to press a button that no longer exists anywhere in the product. This is not a source comment: a field `description` is authored data that ships in the published bundle and is extracted into the i18n bundles, so it surfaces in the admin UI's field help and in generated reference material. The correct path was already there and already the only one: platform-admin standing comes from an unscoped `admin_full_access` grant in `sys_user_permission_set` (ADR-0068 D2), which is exactly what the #9968 removal note in the same file says.

- **`description`** now reads "Legacy better-auth role scalar (admin, user, …). ObjectStack no longer writes it (ADR-0068 D2) — grant platform-admin standing with an unscoped `admin_full_access` assignment in `sys_user_permission_set`." It states what the column IS (a vendor authentication-layer scalar that stays published as `user.role`) and where the operator actually goes, and it deliberately does not claim the scalar confers nothing: `judgePlatformAdmin` still reads `user.role === 'admin'` as the legacy fallback it has always been, so a pre-D2 deployment carrying the value is not locked out. Saying "this field grants nothing" would have replaced one false sentence with another.
- **The `readonly` comment** keeps its ADR-0092 anchor and now states the true reason the field is not editable — nothing writes it since #9968 — instead of naming a writer that is gone.
- **`en.objects.generated.ts`** follows by regeneration (`pnpm i18n:extract`), not by hand: the default locale's leaves are rewritten from the source on every run.

**Deliberately unchanged, and pinned so it stays that way.** The same file carries a third mention inside the #9968 removal note — *"a working \"Set Platform Role\" button **was** a supported, one-user-at-a-time resurrection channel…"*. It is past tense, it narrates what was removed, and it is true; sweeping it up with the other two would turn a true sentence false. A new test pins the removal note's tombstone opener and that past-tense sentence as occurrence counts over the source text, so both directions fail: deleting the history drops a count to 0, and re-introducing the retired action's name in live prose pushes one past 1.
