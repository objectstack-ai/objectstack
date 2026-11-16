---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol,rest,runtime): beside a disabled package, the read naming no package, `/layers` and `/published` serve the one enabled holder of a `doc`, `view` or any other type the registry does not read by package

Clause-②: no
Metadata-protocol: none

A disabled package holds no name (ADR-0150 D3). Take a name that one enabled and one disabled package both ship. For a type the registry reads by package, the bare read (`GET /api/v1/meta/TYPE/NAME`), `/layers` and `/published` already served the enabled holder. For every other type they read the layer they find by name alone. That layer is the metadata service's copy, which belongs to the package registered last, or else the registry's first composite. Either one could be the disabled holder's.

- The plain read answered `404` (the disabled body, withheld) although an enabled package ships the name. FROM `404`, TO the enabled holder's item.
- `/layers` served the disabled holder's body as `effective`. FROM that body, TO the enabled holder's item.
- `/published` answered `404` on both transports. FROM `404`, TO the enabled holder's item.

This covers `doc`, `view`, `translation`, `field`, `seed`, `datasource`, `external_catalog`, `object_extension`, `hook`, `job`, `sharing_rule`, `queue` and `assignment_rule`. `object`, `action` and `package` are not changed: an `action`'s own bare judge already serves the enabled holder.

Unchanged: no answer that was served becomes refused. Two enabled holders of a doc are still refused `409` naming both. A name only disabled packages hold still answers `404`. A name no disabled package holds reads as before. The bare save door is unchanged.
