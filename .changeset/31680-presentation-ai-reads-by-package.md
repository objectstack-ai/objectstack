---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

feat(objectql)!: the by-name reads of apps, pages, dashboards, reports, books, analytics cubes, tools, skills and agents consult `(package, name)` (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which item a bare name resolves to at read time, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

`SchemaRegistry.getApp`, `MetadataFacade.get` / `getEntry` / `exists` and the protocol's by-name read that names no package (`GET /api/v1/meta/TYPE/NAME`, and MCP `agent_prompt`, which reads it) now answer these nine types through the one package-scoped resolver. A package caller gets its own item, else the one holder in its declared dependencies (plus `sys`). A caller with no package gets the environment's own item, else the one package holder. A name with one holder, and a name with none, answer exactly as before.

**BREAKING** for three bare-name reads that were served a guess and are now refused with `409 RESOURCE_CONFLICT`, the message naming every holder:

1. A caller with no package reads a name that two packages both ship (for app, page, dashboard, report, book, analytics cube or tool; skills and agents already allow one holder only). It was served whichever package registered first.
2. A package caller reads a name that only the environment's own item holds.
3. A package caller reads a name whose one holder is a package it does not declare as a dependency.

The fix is one line. For 1 and 3, declare the holding package in the reading package's `dependencies`, or name the package the read means with `?package=`. For 2, ship the item in the reading package or in a package it depends on. None of the four example apps in this repository hits any of the three.
