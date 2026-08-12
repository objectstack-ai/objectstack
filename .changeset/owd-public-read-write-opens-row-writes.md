---
"@objectstack/plugin-security": patch
---

fix(plugin-security): a `public_read_write` object is writable by everyone the access matrix grants `edit`, not only by each row's creator (#8023)

An object declaring `sharingModel: 'public_read_write'` promised "everyone can
see and edit" and delivered "everyone can see, only the creator can edit". A
persona the access matrix grants `edit: true` could `GET` a row **200** and
`PATCH` the same row **403 PERMISSION_DENIED**, with the record-level refusal
("You do not have access to this record…"). Three declarations agreed the write
was allowed — the access matrix's `edit: true`, the object's OWD, and the
absence of any authored RLS — and the runtime refused it anyway.

The cause is the platform's own row-level write ownership floor.
`member_default` ships `owner_only_writes` (object `'*'`, operation `update`,
`created_by == current_user.id`, positions `['org_member']`). The by-id write
pre-image gate lets `ISharingService`'s tri-state verdict **replace** that floor,
but only on a positive `allow` — and on a public object the service **abstains**,
because record sharing genuinely does not enforce there. An abstain keeps the
floor, so the floor became the object's only row-level write gate and quietly
overrode its OWD.

An object whose author declared `public_read_write` now never inherits the
wildcard `update` floor in the first place. Three boundaries are deliberate:

- **`delete` is unchanged.** `public_read_write` is "see and edit"; the legacy
  `full` alias that also covered transfer/delete was refused a mechanical
  conversion for being *wider* than it (ADR-0090 D4). `owner_only_deletes` still
  refuses a non-creator delete.
- **Only the OWD that says so.** The declared model is read, never
  `plugin-sharing`'s effective bucket — which folds `controlled_by_parent` and an
  unset model on a system object into the same `'public'` value. A detail object
  derives access from its master, and an unset model on a `sys_*` table is a
  legacy default, so neither opens writes. An unresolvable schema fails closed.
- **Only the platform's floor.** Provenance decides, so an app-authored policy
  spelling the identical predicate still reaches the compiler and still refuses
  (ADR-0049).

Because the floor is removed at collection time, the write class is then empty
and the derive-from-select scope supplies the write filter — so "you cannot
mutate what you cannot see" continues to hold on these objects: a caller
narrowed by select-only RLS still cannot write a row outside its readable set.

Objects with any other OWD are untouched: on `private` and `public_read`, a
non-owner write is still refused. The object-level gate is untouched too — a
persona with `edit: false` still gets the object-level refusal, with its own
distinct sentence. `POST /api/v1/security/explain` follows the same composition,
so it stops reporting the `rls` layer as `narrows` for `update` on an object
with zero authored RLS, while continuing to report a narrowing for `delete`.
