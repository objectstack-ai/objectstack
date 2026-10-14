---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): an email-audience share link's refusal does the same work whatever email and password are presented

The refusal of an `email`-audience share link no longer does a different amount
of work depending on the caller's input, as its answer bytes already did not.
The refusal and the served response are byte-for-byte unchanged.

Clause-②: no
