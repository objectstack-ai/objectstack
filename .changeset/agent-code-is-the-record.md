---
---

docs(spec,metadata-protocol): record why platform `agent` definitions have no metadata change log (#4507)

Comment-only — no behaviour changes, nothing to release.

`agent` is the only authorable metadata type with no governed write path
(`allowOrgOverride` and `allowRuntimeCreate` are both `false` per ADR-0063 §2,
which closes `*.agent.ts` to third parties). Its rows are written by the
shipping plugin at boot — `AIStudioPlugin.registerMeta` → `metadataService.register()`
→ `MetadataManager.register` → `DatabaseLoader.save` — which writes
`sys_metadata` directly with a fresh checksum and appends no
`sys_metadata_history` row. So a shipped agent definition that changes between
releases leaves no metadata-side change log.

That is accepted rather than overlooked, and the reasoning now sits beside the
declaration instead of in an issue: the two definitions live in version control
(`@objectstack/service-ai-studio` in the `cloud` repo), so git already holds the
full reviewable history. A second history in `sys_metadata` would be a *worse*
record — it would capture only the boots where a given deployment happened to
see the checksum move, so two deployments on the same release would carry
different "histories" of an identical, code-fixed definition.

Two consequences that read as bugs and are not are named explicitly: the
`skipped` outcome `os migrate meta --stored` reports for `agent` rows is correct
and permanent for this type, and Studio showing no History tab for an agent is
the absence of anything to show. `migrateStoredMetadata`'s TSDoc now points at
the note rather than leaving its skip reason to be read as a to-do.

The note also states its own expiry: if `agent` is ever opened to tenant
authoring, an author-owned definition has no git to fall back on, so opening the
type and giving it a real history path become the same piece of work.
