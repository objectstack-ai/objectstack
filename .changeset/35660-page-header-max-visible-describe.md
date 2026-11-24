---
'@objectstack/spec': patch
---

docs(spec): `page:header` `maxVisible` / `mobileMaxVisible` descriptions state the renderer's real fallbacks per host

Clause-②: no
Metadata-protocol: none

The two descriptions said the renderer shows 3 inline header buttons (1 on mobile) when the key is unset. Since the record page's header became one row, an unset `maxVisible` gives 1 there and 3 on any other header, and an unset `mobileMaxVisible` gives 2 in a record page's bottom action bar on a phone and 1 elsewhere. Text only: the schema shape, its validation and its lack of a schema default are unchanged.
