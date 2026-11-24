---
'@objectstack/types': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

refactor(studio): every Studio address comes from one builder; no address changes

Clause-②: no
Metadata-protocol: none

Studio redesign groundwork (#36895, epic #36890). Every place that produced a `/studio...` URL now calls one builder, so a later change can move an item type to its metadata address in one place. Every address is byte-for-byte what it was: no link, bookmark or redirect changes.

- **Console.** `studioAddress.ts` in `@object-ui/app-shell` builds every Studio address: the landing, a package, a pillar, an item (`studioItemPath`), the "All metadata" area, and the draft review links. `studioAddressTable.ts` lists every address family, every `?surface=` spelling and every query parameter, with what each becomes on the metadata address. The retired `/interfaces` redirect keeps exactly the parameters that table marks. New exports from `@object-ui/app-shell`: `STUDIO_ROOT_PATH`, `STUDIO_HOME_PILLAR`, `studioLandingPath`, `studioPackagePath`. Existing exports keep their names and values.
- **Server.** `studioChangesReviewLink` and `studioItemReviewLink`, new in `@objectstack/types`, build the review links that `os meta register` prints and that the MCP authoring tools return after a draft save. The text an AI is handed is unchanged.
- **Guards.** A test under `ui/` refuses a hand-built Studio address in any ui source. A test in `@objectstack/types` refuses one in any server package, and holds the review links quoted by the `objectstack-mcp-build` skill's evals equal to what the builder returns.
