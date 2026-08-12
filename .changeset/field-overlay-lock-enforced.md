---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): enforce the `field` overlay lock — an artifact-backed field PUT is refused instead of accepted 200 (#7743)

The metadata-type registry declares `field` with `allowOrgOverride: false`, and a
field a code package ships is an artifact. Yet
`PUT /api/v1/meta/field/showcase_task.title` answered **200** `state:'active'`
with an admin bearer, the row persisted, and it read back with
`_diagnostics.valid=true`. Reproduced on `showcase_task.status`. The door
answered success twice over for a write the registry forbids.

**Why the declaration was never consulted.** `field` is the ONE type in
`DEFAULT_METADATA_TYPE_REGISTRY` whose artifacts are not standalone registry
items: its `filePatterns` (`**/*.field.ts`) match nothing in any app, because
fields are authored *inside* the object (`ObjectSchema.fields`). So the object's
loader registers one `object` item and no `field` items at all, and
`getArtifactItem('field', 'showcase_task.title')` missed on a field the package
unambiguously ships.

That miss is a load-bearing authorization input, not a cosmetic one.
`isArtifactBacked` is what picks the write INTENT for
`SysMetadataRepository.assertAllowed` (`override-artifact` vs `runtime-only`) and
what arms `saveMetaItem`'s own `NOT_OVERRIDABLE` gate. With the lookup empty, an
override of a packaged field was classified as a runtime-only **create** — and
`field` carries `allowRuntimeCreate: true`, so `allowOrgOverride: false` was
never reached. Both doors read the same predicate, so both are closed by making
it truthful: `isArtifactBacked` now resolves a `<object>.<field>` name through
the object's artifact and answers about the field the package actually ships.

**The other tier is untouched, deliberately.** `allowRuntimeCreate: true` is
real: a genuinely new field the object's artifact does not carry is still
accepted, and so is a field of a runtime-created (non-packaged) object. This
closes the overlay tier only.

**Scoped to `field`, measured rather than assumed.** Every other declared type
either registers its artifacts standalone with a `_packageId` — `action` (70 on
the showcase), `page` (33), `permission` (16), `dataset` (9), `doc` (9), `hook`
(4), `report` (4) — or genuinely ships no artifacts, where "not artifact-backed"
is the true answer. `action` is the instructive one: also nested inside the
object document, yet registered standalone, and already refused correctly.
`object` / `view` / `dashboard` / `job` were measured as already correct in the
same run and behave identically after this change.

The refusal is pinned at the **live route** (`packages/runtime`), driving the
real dispatcher, protocol and repository on both topologies — the environment
kernel and the no-`environmentId` showcase, which refuse at different sites. The
27 existing protocol-level cases in `overlay-precedence.test.ts` were green
throughout the defect's life precisely because the route was not in their
coverage.

Two defects found alongside this one are filed rather than folded in: the
accepted write is also **inert** (#7893 — a legitimately created field never
appears in the object's `fields`), and the **plural** URL spelling
`/meta/fields/<name>` still walks around this lock because `PLURAL_TO_SINGULAR`
has no `fields` key (#7894, which spans four types). The plural gap is
characterized by a test that names it and goes red when it is closed.
