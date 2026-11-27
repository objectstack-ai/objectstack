---
'@objectstack/runtime': patch
---

fix(runtime): a dispatcher door is served only by the request's own kernel

Clause-②: no
Metadata-protocol: none

Every dispatcher door bridge — the auth door, the comment doors, the approval action page, the webhook redeliver door, the inbound automation hook (including the engine that judges a qualified hook's address), and the personal-view, attachment and print doors — reads the services it serves with off the request's own kernel, and only there. When the request's kernel holds no such member, the door answers its typed not-available `501 NOT_IMPLEMENTED`, the same answer an empty slot already gave. On a host with one kernel nothing changes: the request's kernel is that kernel.
