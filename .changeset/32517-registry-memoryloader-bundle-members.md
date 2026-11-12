---
'@objectstack/metadata': patch
---

fix(metadata): the metadata service's own reads keep every locale of a package's email template

Clause-②: no
Metadata-protocol: none

A bundled type (`email_template`, one member per `locale`) holds several members under one `(package, name)`. `DatabaseLoader` keeps a row per member, but `MetadataManager`'s in-memory registry and the `MemoryLoader` the artifact door saves into kept one item per `(package, name)`. A second locale of one package's template overwrote the first there, so the metadata service's own `list`, `loadMany` and `loadManyKeyed` answered only the locale written last. The served reads (`GET /meta`, the execution read the email send path uses, and both with `?package=`) already answered every locale through the ObjectQL registry, and they answer the same bytes as before.

- **Each member has its own key under its slot**, in the registry and in the `MemoryLoader`. The canonical member (`en-US`) keeps the slot's own key, so a template with one locale, and every unbundled type, is stored exactly as before.
- **The slot rules still count packages, never members.** One package's two locales are one holder, so a read or removal naming no package is refused (`409`, ADR-0150 D3) only when two packages hold the name, and the refusal names each package once. A package-less locale under a name one package holds is that holder's member (D4). A removal naming a package drops every member of its slot and no other package's. A read of a slot answers its member written last, as before.
- **`unregisterPackage`** removes a slot's members together, with the one `deleted` announcement the slot made before.
