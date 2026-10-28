---
'@objectstack/spec': minor
'@objectstack/plugin-security': minor
'@objectstack/lint': minor
'@objectstack/skills': minor
---

feat(security)!: `current_user.queues` is resolved by the platform from the ownership-queue service, and `queues` joins the reserved `current_user` keys (#27016)

Clause-②: no (narrowing) — `queues` joins `RESERVED_RLS_MEMBERSHIP_KEYS`, so an object's `membershipKeys` may no longer declare a key named `queues`, and a registered membership resolver's `queues` answer is screened off. Nothing is widened past what the platform itself resolves: where no app supplied the key, a policy reading `current_user.queues` matched no rows before, and now it matches the caller's own queues.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key, export or type is removed or renamed: one name is added to the reserved list, which makes a membership key of that name refused at parse. The replacement name is the author's to choose, so there is no mechanical rewrite to prescribe and no tombstone. -->

**BREAKING** accept-set narrowing in `@objectstack/spec` (`MembershipKeyNameSchema`, read through `ObjectSchema.membershipKeys`) and at the membership resolver screen in `@objectstack/plugin-security`.

- **Now.** A row-level security policy can read `current_user.queues`: the machine names of the ownership queues the caller belongs to in the active organization, directly or through a position, team or unit, as each queue's members define. The security plugin resolves it from the ownership-queue service's `queuesOf`, the same membership answer the claim gate's `isMember` reads, once per request and only when a policy about to compile reads the key. For example `owner_id == null && queue in current_user.queues` lets queue members read the unowned records sitting in their queues.
- **One source.** No other source can supply the key. A registered `rls-membership-resolver` that answers `queues` has that answer dropped with a WARN, a `rlsMembership` bag entry or a `queues` field on the execution context is never read, and a context copied for another user or organization does not carry the set. With no signed-in user, no ownership-queue service, or a membership read that fails, the key stays unresolved and every policy reading it matches no rows.
- **Who moves.** An object that declares `membershipKeys: { queues: … }`, or a membership resolver that lists `queues` among its keys. Census on this repository at 7eb613c3: none in `packages`, `examples`, `qa`, `skills` or `content`.

**The remedy.** Rename the membership key. `queues` is resolved by the platform; choose a name that says what your set holds.
