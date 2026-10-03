---
'@objectstack/spec': patch
---

The `ApprovalActionRow` documentation now says what `reassign_from` and `reassign_to` hold. It said both were users. They hold a slot address in its stored spelling: a user id, an email, or a position address such as `position:legal`. A reassignment moves a slot, not necessarily a person, and the person who made the move is `actor_id`. The `reassign_from_name` and `reassign_to_name` documentation now says when a name resolves: only for a user id, or for an email an account carries. A position address never resolves, so a consumer renders the address when the name is absent.

Clause-②: no

Documentation only. No schema, export or type changes.
