---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `revertCommit` states its write intent per item, so an `object` overlay can be reverted at all (#6563)

`ObjectStackProtocolImplementation.revertCommit` restored an edited artifact
through `repo.restoreVersion(ref, prevVersion, { actor, source, message })` — with
no `intent`. `SysMetadataRepository.restoreVersion` therefore fell back to its
`?? 'override-artifact'` default, `put` opened with
`assertAllowed(ref.type, opts.intent)`, and that gate refuses every type whose
registry entry is not `allowOrgOverride`. `object` is exactly such a type, so
every `object` item of a reverted commit came back in `failed[]`:

```
[NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.
Overlay-allowed: view, page, dashboard, app, action, report, dataset, ...
```

The package-commit undo (ADR-0067) therefore could not revert the metadata type
Studio and AI-built apps create most, while the same edit reverted fine one
artifact at a time through the version-history revert — the two user-facing
revert paths disagreed about what is revertable. The failure was per item, so
the call still answered `success` overall with a populated `failed[]`, which
reads as a flaky revert rather than a systematic refusal.
`rollbackToPackageCommit` reverts through the same loop and inherited it, and
there the symptom was quieter still: a per-item refusal never throws, so the
rollback recorded the commit as reverted and answered `success: true` while the
object was untouched.

`revertCommit` now derives the intent from the artifact the way its sibling
`rollbackMetaItem` already does — `isArtifactBacked` gives `'override-artifact'`,
otherwise `'runtime-only'` — and does it **per item**, because a commit is a
batch that routinely mixes a runtime-created object with an overlay on a
packaged view.

The repository's default is deliberately unchanged: it is right for callers that
genuinely mean "override a packaged artifact", and the defect was this caller
never saying which of the two cases it is. So the gate is not widened — an
object a code package really ships still resolves to `'override-artifact'` and
is still refused with `NOT_OVERRIDABLE`, which is pinned alongside the fix.
