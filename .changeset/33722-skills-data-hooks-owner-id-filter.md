---
'@objectstack/skills': patch
---

docs(skills): the data-hooks query example filters on the injected `owner_id`, not a hand-named `owner`

Clause-②: no
Metadata-protocol: none

The `ctx.api.object(name)` query-shape example in objectstack-data's `references/data-hooks.md` now filters `task` on `{ owner_id: uid }`. The old `{ owner: uid }` named a field the object does not have unless an author hand-adds a second owner beside the injected one; on an object without it the query is refused with `400 INVALID_FILTER`. The objectstack-data eval about a required `user` field with `deleteBehavior: 'restrict'` now names that field `reviewer`, a role apart from the record owner, instead of an `owner` field that holds the ticket.
