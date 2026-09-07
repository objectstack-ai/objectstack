---
"@objectstack/service-analytics": patch
---

`CubeRegistry`'s documentation now describes what the class actually does. Four claims it shipped were measured false against the built package; no behaviour changes, and the corrected text ships in `dist/index.d.ts`, where consumers read it.

The class docblock said cubes reach the registry "from two sources: manifest definitions, and object schema inference". Neither half held. Two sources were missing — a compiled dataset's Cube (ADR-0021), registered under the dataset's name by `queryDataset`, and the ad-hoc Cube `ensureCube` / `inferCubeFromQuery` mints from the members a query references. And object schema inference is `inferFromObject`, which no path in this repository calls: its only in-tree caller is a unit test. The list now names the three sources that do write to the registry, and points at the method for the fourth door instead of advertising it as delivered.

`inferFromObject`'s own "heuristic rules" list was wrong in three of five bullets. Driving the built package:

- `number` / `currency` / `percent` fields mint one `sum` and one `avg` measure each — not the documented `sum`, `avg`, `min`, `max`. No `min` or `max` measure exists.
- `boolean` fields become a `boolean` dimension and nothing else. The documented "`count` measure (count where true)" is not minted.
- Every field becomes a dimension. The documented "all non-computed fields" implies an exclusion the code does not have, on a parameter that carries no such flag.

The two accurate bullets (a default `count` measure, and `date` / `datetime` fields becoming `time` dimensions granulated day/week/month/quarter/year) are kept and stated in the form the run produced.

The method's docblock now also records what it is: a published method with no in-repo caller, still callable by consumers through the package entry (`CubeRegistry`) or `AnalyticsService.cubeRegistry`, whose output does reach the wire because `getMeta()` serves its labels as `CubeMeta` titles.
