---
'@objectstack/metadata-protocol': minor
'@object-ui/app-shell': minor
---

fix(metadata-protocol): a mapping override is served, a pair's removal of its own override of any overridable type brings the base's item back, and an excluded type's `overrides` refusal names a remedy that works for it (#30062)

Clause-②: no — ADR-0146 D2 says an item in the customization package replaces the base's item and removing it brings the base's back, and ADR-0146's revert ("Restore package original") is deleting the overriding item from `.custom` so the base's document is served again. The 403 on removing a pair's own doc or mapping override, and the unserved mapping override, refused what that text already admits. A removal that names the base still keeps today's answer.
Metadata-protocol: semantic

- **A mapping override in `<base>.custom` is served.** A mapping item that declares `overrides: { package: '<base>', … }` in the base's customization package now replaces the base's mapping for the by-name read (no `?package`, `?package=<base>`), both lists and the layered read, as page, app, dataset, doc and book already did. The import door (`@objectstack/rest`'s `import-mapping.ts`) resolves a named mapping through that package-less by-name read, so it now gets the pair's mapping.
- **Removing a pair's own override works for every overridable type.** `DELETE` of a declared override the customization package holds (named with `?package=<base>.custom`) was admitted only for a flow; a doc or mapping override answered `403 NOT_OVERRIDABLE` on the environment kernel. The removal now admits the pair's row for every type `isOverridableMetadataType` names. The row is deleted and the base's item is served again under every address. A removal that names the base (`?package=<base>`) is unchanged: the pair's row stays and its override stays served.
- **An excluded type's refusal names a remedy that works for it.** A save of `overrides` on a type that takes no override now cites that type's own record (ADR-0146 D6 for the security catalog and code-only types, D1 for a datasource, D9 for a behavioural switch, D10 for a field, ADR-0126 §3 for one-shot types, D2 for the rest) and prescribes a door that exists for that type: a new item under a new name where the type may be created at runtime, the documented switch route for a sharing rule, Setup › Queues for a queue, Setup › Datasources for a datasource, an object extension for a field, and a new version of the base for a type defined only in package source. The error code and status are unchanged.
- **`@object-ui/app-shell`: the All metadata tile agrees with the Customize door.** On a read-only package, a type's tile reads 可定制 (Customizable) exactly where Studio offers a Customize door for it (flow and app included, whose overlay flag is off) and 只读 (Read-only) elsewhere (doc and mapping, which have no door yet). It no longer reads the overlay flag.

The label precedence of a translated override (card item 3) is not in this change.
