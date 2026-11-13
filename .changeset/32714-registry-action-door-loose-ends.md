---
'@objectstack/metadata': patch
---

fix(metadata): the in-memory store declares a view where it is made, and a refusal of a slot it does not hold names each holder once

Clause-②: no
Metadata-protocol: none

Loose ends of the per-member registry keys. No served answer changes.

- **Views are declared, not inferred.** A read the registry cannot answer judges a view assembled from the registry's and the loaders' items. A bundled type's slot (`email_template`, one member per `locale`) answers that view's first member, the member its sources wrote last. The store used to infer "this is a view" from "no write was ever recorded on it". It now marks the view where it builds it, so a store that is not a view answers by its write order, as every other read of "written last" does. Every view the manager builds is marked, so each read answers as before.
- **One holder, one candidate.** The refusal of a write addressed to a package that holds no slot of the name (`not-held-by-qualifier`, `409`) lists each holder once. One package's two locales, or one package's action bound to two objects, is one candidate, as the other refusals already count it. Its one caller, `DatabaseLoader`'s rollback, keys one row per slot, so its refusals read the same.

Pinned with them, unchanged: a second locale of a bundled item is announced `added` and a rewrite of a held locale `changed`, because an email template's identity is `(name, locale)`. A package's first item of a name whose bundle the environment holds takes over that member only, and leaves the environment's other locales the environment's, in the registry, the `MemoryLoader` and `DatabaseLoader` alike. On a host whose `protocol` serves no merged action listing, two packages' same-named action bound to one object is refused at the activation and execution doors (`409`, naming both packages), MCP `list_actions` lists one row per package, and the bare `run_action` is refused naming both.
