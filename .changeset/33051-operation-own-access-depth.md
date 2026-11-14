---
'@objectstack/plugin-security': patch
---

fix(plugin-security): each data operation reads at its own object's access depth, even when sibling operations share one request

Clause-②: no
Metadata-protocol: none

The authz middleware resolves an access depth per object (`readScope` / `writeScope`, ADR-0057 D1) and hands it to plugin-sharing's owner-match further down the same operation. It used to write that depth onto the caller's execution context in place. One caller context serves every operation a request runs, concurrent ones included, so a sibling read on another object could overwrite the depth before plugin-sharing read it. The record page payload (`POST /api/v1/data/:object/:id/page`) reads its related lists concurrently: on the showcase, a member staffed `showcase_manager` got the Contacts list filtered at the owner depth of the next list's object, so it showed 1 row beside `total: 26` whenever Contacts was not the last list. The admin was not affected.

The depth, and the external audience's grant stamp beside it, now ride on a copy of the envelope that the middleware hands to the rest of its own operation. The caller's context is never written, so concurrent operations cannot see each other's depth. Request-wide memos (membership sets, queues) are still staged on the caller's context before the copy is made.
