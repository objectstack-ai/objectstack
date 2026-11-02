---
'@objectstack/core': patch
---

fix(core)!: an ordinary member of an organization with more than 1,000 members sees every fellow member in `sys_user` again, and an organization too large for the database's bound-parameter limit is refused loudly instead of served a short list

Clause-②: no (narrowing)
Metadata-protocol: none

The claim declared `no` for an interim that reads the membership to completion; the seat's ruling (6577690137 on #29281) reads the refusal past the bound-parameter limit as a narrowing.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export, type or metadata changes: the authorization resolver reads a list it already read, to completion. No author has anything to rewrite; the one new refusal is the database's own, for an organization whose membership exceeds what one statement can bind. -->

**BREAKING** for organizations past the database's bound-parameter limit only: their members' `sys_user` reads, which used to answer a silently short list, now fail.

`sys_user`'s organization-members row scope (`id in current_user.org_user_ids`, the object's default row scope and `member_default`'s `sys_user_org_members`) reads the fellow-org peer list the request's authorization resolver builds. That list was built from one `sys_member` read bounded at 1,000 rows, so in an organization with more members everyone past the 1,000th `sys_member.id` was missing from it with no signal: a people picker or lookup searching for them found nothing, and reading them by id answered `404`. Which members vanished was arbitrary, because member ids are random.

- **Every member, nobody else.** When that first read comes back at its bound, the resolver now reads the active organization's membership to completion, in pages of 10,000 ordered by id, and the list holds every member plus the caller. Members of other organizations stay out.
- **Smaller organizations are unchanged.** An organization under 1,000 members issues exactly the one read it always did; nothing else is read and nothing is logged. An organization of exactly 1,000 gets the same list after one more read, and nothing is logged.
- **Said once.** The first time an organization's membership outgrows the first read, the server logs one `warn` naming the organization and its member count. Every request in that organization now reads its whole membership, and each `sys_user` read in it binds one parameter per member.
- **Who sees the narrowing.** An organization whose membership passes the backend's bound-parameter limit: on SQLite, 32,000 members were served and 40,000 refused (`too many SQL variables`, `500`); Postgres's wire protocol caps a statement at 65,535 parameters. Its members' `sys_user` reads now fail where they used to answer a list missing everyone past the 1,000th member. The `warn` line names the organization and its count so an operator can connect the two.
- **Loud, never short.** A membership page that fails to read, or a driver that does not honour the id cursor, fails the request with the existing `503` authorization-store error instead of answering a shorter list.

**The remedy.** None is needed below the limit. Past it there is no workaround in this release: the relational membership predicate (#29360) removes the per-member parameters altogether.
