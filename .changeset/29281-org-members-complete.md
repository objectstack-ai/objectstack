---
'@objectstack/core': patch
---

fix(core): an ordinary member of an organization with more than 1,000 members sees every fellow member in `sys_user` again

Clause-②: no
Metadata-protocol: none

`sys_user`'s organization-members row scope (`id in current_user.org_user_ids`, the object's default row scope and `member_default`'s `sys_user_org_members`) reads the fellow-org peer list the request's authorization resolver builds. That list was built from one `sys_member` read bounded at 1,000 rows, so in an organization with more members everyone past the 1,000th `sys_member.id` was missing from it with no signal: a people picker or lookup searching for them found nothing, and reading them by id answered `404`. Which members vanished was arbitrary, because member ids are random.

- **Every member, nobody else.** When that first read comes back at its bound, the resolver now reads the active organization's membership to completion, in pages of 10,000 ordered by id, and the list holds every member plus the caller. Members of other organizations stay out.
- **Smaller organizations are unchanged.** An organization under 1,000 members issues exactly the one read it always did; nothing else is read and nothing is logged.
- **Said once.** The first time an organization's membership outgrows the first read, the server logs one `warn` naming the organization and its member count. Every request in that organization now reads its whole membership, and each `sys_user` read in it binds one parameter per member, so a SQL backend refuses that read outright once the membership passes the backend's bound-parameter limit (on SQLite, 32,000 members were served and 40,000 refused; Postgres's wire protocol caps a statement at 65,535 parameters) instead of answering a short list.
- **Loud, never short.** A membership page that fails to read, or a driver that does not honour the id cursor, fails the request with the existing `503` authorization-store error instead of answering a shorter list.
