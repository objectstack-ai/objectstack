---
'@objectstack/organizations': patch
---

Clause-②: no
Metadata-protocol: none

On a walled boot, the Default Organization's seed now resolves the platform owner it is bound to. The default-organization bootstrap writes the `default` organization as SYSTEM and then the owner's `sys_member` row; the per-organization seed replay ran on the organization write, before that member existed, so a seeded `Field.user()` or `Field.lookup('sys_user')` column naming the owner was stored as NULL (only `owner_id` was repaired later, by the seed-ownership handoff). The replay of the organization that bootstrap creates now waits for the owner's member row and runs inside it, the same way an organization a person creates already does, with the owner as the locale user. When the bootstrap binds nobody (the bind was decided earlier, or the member write failed), the organization still replays once, with no person, as soon as the bootstrap call is over. Un-walled boots and every other organization write are unchanged.
