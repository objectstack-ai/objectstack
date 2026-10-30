---
'@objectstack/objectql': patch
---

feat(objectql): a conformance kit a plugin driver outside this repository runs in its own CI, so a change to the contract the engine holds plugin drivers to is caught there

Clause-②: yes
Metadata-protocol: none

A plugin driver (a `driver.NAME` service a server plugin publishes, such as a vendor's closed-source Salesforce driver) serves an external datasource behind the engine's correctness floor. The floor's contract was pinned only by this package's own tests, which a driver living in another repository never runs. `@objectstack/objectql` now exports the kit that driver runs instead.

- **What it asserts.** The floor's contract, against the spec's driver conformance tables (`FILTER_LOGIC_CASES`, `FILTER_TEXT_CASES`, `TEMPORAL_CASES`, `PAGINATION_CASES`): for every filter, the driver's own answer to the query the floor sends holds every matching row and only stored rows, or refuses with a status of 400, 404 or 422, and the floored answer equals the table's. Also: each row's stored values come back unchanged (a `null` stays `null`, a number stays a number), `count` through the floor, the floor's paged walk by every table `orderBy`, write refusals reaching the caller as `422 EXTERNAL_WRITE_REFUSED` (from write probes the caller names), an outage reaching the caller as `503 ERR_DATASOURCE_UNAVAILABLE` and never as rows (from an unavailable remote the caller builds), and the `introspectSchema()` shape when the driver offers it.
- **Pushdown is measured.** `DriverCapabilities` carries no pushdown claim, so each read case reports how the driver answered: `exact`, `superset` or `refused`.
- **A second tier, `direct`.** Opt-in: the driver answers the whole query itself (an exact filter, `count`, `findOne`, a deterministic paged walk, `limit` by presence). The floor does not need it; it is the oracle a later verified-pushdown credential, letting a tested driver skip the floor, will be built on.
- **How to run it.** Hand `setup(fixture)` a driver over a remote holding exactly the fixture's rows (a fake of the remote's API in front of the driver's real translation code, or a sandbox seeded from `pluginDriverConformanceFixtures()`). Then `definePluginDriverConformanceSuite({ describe, it, afterAll }, options)` registers one test per case under vitest or jest, or `runPluginDriverConformance(options)` answers a report with no test framework. Case ids (`tier/group/fixture/case name`) are stable.

New exports: `createPluginDriverConformance`, `runPluginDriverConformance`, `definePluginDriverConformanceSuite`, `pluginDriverConformanceFixtures`, `PLUGIN_DRIVER_CONFORMANCE_FIXTURE_NAMES`, `PluginDriverConformanceFailure`, and their types. Nothing existing changes.
