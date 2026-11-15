---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a seed load for one organization finds a person among that organization's members, by keyset, and judges a person named by an id-shaped value by the same membership rule

Clause-②: no (narrowing) — narrowed: on a load for one organization (the per-organization replay, a reseed, an install into an organization), a person reference (`owner_id`, a `sys_user` lookup) whose value is UUID- or ObjectId-shaped is resolved only when it names a member of that organization, where it was written verbatim, so an id of a person outside the organization linked the row to them. A member's id still resolves to itself, and a load with no organization, a dry run and every other reference target keep an id-shaped value verbatim, as before. Unchanged: the lookup by name or email resolves the same member it did.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which person an id-shaped seed reference resolves to on a load for one organization, so there is nothing for a migration to rewrite and no tombstone -->

**BREAKING** for a seed that names a person by an id-shaped value (UUID or ObjectId) on a load for one organization, where that person is not a member of the organization. The row is still seeded; the reference stays empty and the load's error says the person is not a member of that organization, exactly as it does for the same person named by name or email. The fix: add the person to the organization, or name a member of it. The seed documentation already teaches a natural key (`name`, `email`) rather than an id, which differs between environments.

What changes:

- **The membership lookup is bounded by the organization.** It reads the load organization's `sys_member` rows in `user_id` order, a page at a time by keyset (`user_id` greater than the last one seen), and asks ONE `sys_user` read per page, constrained to that page's people and the natural key. It no longer reads every same-named person in the deployment, 50 at a time by offset, which cost two reads per 50 organizations per reference value on a hosted deployment where every organization holds the same seeded names, and which could skip the member under a concurrent delete and say "not a member" falsely. An organization smaller than one page (500 members) answers a resolved reference with one membership read and one person read. Whether someone outside the organization answers to the key is one bounded read (`limit: 1`), asked only on a miss, to word the error.
- **An id-shaped person value is judged by membership** on a load for one organization, as an id of any other shape already was.
