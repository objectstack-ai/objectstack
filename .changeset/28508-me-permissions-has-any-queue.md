---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-hono-server': patch
---

feat(plugin-hono-server,plugin-sharing): `GET /auth/me/permissions` answers `hasAnyQueue`, whether the caller's organization has at least one ownership queue

Clause-②: yes
Metadata-protocol: none

The console's list toolbar offers an "in a queue" toggle, and it needs to know, once per session, whether that toggle can ever return a row. A plain member cannot find out: `member_default` names no `sys_queue` entry, so `GET /data/sys_queue` answers 403. The server now answers the one question for them.

- **The field.** Every authenticated `/auth/me/permissions` body carries `hasAnyQueue: boolean`. It is `true` when the caller's organization has at least one ownership queue: a declared queue the activation ledger has not switched off, or a `sys_queue` row of the organization. A row under a declared queue's name does not count, since that name resolves nowhere. Only the boolean is disclosed: no names and no counts. An anonymous caller still gets `{ "authenticated": false }` and nothing else.
- **Where it is resolved.** `OwnershipQueueService.hasAnyQueue(organizationId)` in `@objectstack/plugin-sharing`, under system context, with the same registry-first read and activation-ledger filter `queuesOf` uses.
- **When there is no answer.** No ownership-queue service registered, a service without the method, or a service that throws answers `false`. A throw is logged at `warn` and does not cost the caller the rest of the permissions body. The closed body the handler answers on a fault carries `false` too.
- **Unchanged.** A member's read of `sys_queue` and `sys_queue_member` stays refused. No route is added.
