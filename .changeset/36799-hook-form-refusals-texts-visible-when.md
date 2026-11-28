---
'@objectstack/spec': patch
---

fix(spec): the Studio hook form offers `refusals` and `texts` only where a hook may declare them

Clause-②: no
Metadata-protocol: none

`hookForm` offered the `refusals` and `texts` rows on every hook. `HookSchema` refuses both keys on an `expression` body, so an author writing an expression hook was offered two sections that could only make the save fail. Both rows now carry a `visibleWhen` that is the schema's own test: they are shown for a `js` body, and for a hook with no body and a non-empty `handler`, and hidden on an `expression` body. What a hook may declare does not change. Nothing to migrate.
