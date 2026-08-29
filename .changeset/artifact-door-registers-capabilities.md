---
"@objectstack/metadata": minor
---

feat(metadata): the artifact door registers stack-declared `capabilities` (#12892 step 1)

`ARTIFACT_FIELD_TO_TYPE` — the map that decides which collections of a compiled
artifact reach `MetadataManager` — now carries `capabilities: 'capability'`.
This is step 1 of the maintainer's 2026-08-29 ruling on #12892 (option 1: *the
door owns the registration route* for the five artifact security collections).

**FROM.** `capabilities` is an authorable top-level stack collection (ADR-0066
D1), but the door did not map it while `AppPlugin`'s ADR-0057 `SECURITY_FIELDS`
block did — making that block the collection's **sole registrar on an artifact
boot**, and it registers the raw bundle bytes with no strict parse, no schema
default and no ADR-0010 provenance. On a `bootstrap: 'artifact-only'` runtime
where `AppPlugin` does not run, a package's declared capabilities reached no
registry at all: `GET /meta/capability` answered **empty**, and
`bootstrapDeclaredCapabilities` seeded **no `sys_capability` row** for them.

**TO.** The door registers them like every other mapped collection: strict
parse, schema defaults, ADR-0010 provenance. Measured on a real artifact-only
kernel boot with no `AppPlugin`, over a package declaring
`{ name: 'crm.export', label: 'Export CRM data' }`:

- `GET /meta/capability` went from `[]` to one item carrying `scope:'platform'`
  (the `CapabilitySchema` default) plus `_packageId` / `_packageVersion` /
  `_provenance`;
- `sys_capability` went from 9 rows (platform-curated only) to 10 — the
  declaration now materializes with `managed_by:'package'` and its `package_id`.

**What this does NOT change, deliberately.** On the ordinary artifact boot
`AppPlugin` still registers `capabilities` and still runs last, so its unparsed
copy still wins the registry — measured byte-identical before and after this
change. Two registrars on one route is the interim state the ruling explicitly
permits while step 2 (that block stops registering the five on the **artifact**
path, after a census of the non-artifact boots that depend on it) lands. No
authoring surface moves, and no artifact that parses today stops parsing.
