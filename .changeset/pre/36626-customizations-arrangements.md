---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

feat(runtime): `GET /packages/:id/customizations` lists the arrangements the base's `.custom` pair writes

Clause-②: yes (widening)
Metadata-protocol: added

An administrator who arranges an installed object's record page (reorders, retitles or hides its tabs, or arranges its field groups or actions) writes that arrangement into the base's paired `<base>.custom` package as an object extension (ADR-0146 D10). Until now the per-base customization read did not show it: its lists covered the overrides, the extension fields, validation rules and indexes, the switched-off items and other packages' contributions, so a tab arrangement was a customization nobody could see in that read.

The read now answers a fifth list, `arrangements`, with its count:

- **What is listed.** One `{ object, key }` entry per object the base owns and arrangement key the pair's extension of it writes: `fieldGroups`, `relatedLists` (the record page's tab list) or `actionLayout`, the keys of `CUSTOM_ARRANGEMENT_KEYS`. A key counts as written when the extension carries any value under it, an empty list included.
- **What is not.** The arrangement's content: read it back with `GET /api/v1/meta/object_extension/<object>?package=<base>.custom`. Nothing is compared with the base, which stays as its package declares it. Another package's extension, and the pair's extension of an object the base does not own, are not listed.
- **Its own kind.** An arrangement is one whole declaration of the object, not a member of one of its collections, so it is not an `extensions` entry and `counts.extensions` is unchanged.
- Ordered by object, then key in the order `fieldGroups`, `relatedLists`, `actionLayout`.

`GetPackageCustomizationsResponseSchema` declares the member and `counts.arrangements`, strict as the rest of the answer. A client that parses the answer through the schema (`client.packages.customizations(id)` returns its type) needs this version of `@objectstack/spec`: an older schema refuses the new member.
