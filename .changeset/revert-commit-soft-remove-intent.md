---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `revertCommit`'s soft-remove limb states its write intent per item, so a commit that CREATED an object can be reverted (#6620)

`ObjectStackProtocolImplementation.revertCommit` has two limbs. #6563 (PR #6642)
fixed the one that RESTORES an edited artifact, where the intent was unstated and
fell through to `restoreVersion`'s `?? 'override-artifact'` default. The other
limb — an artifact the commit CREATED, which the revert soft-removes — stated the
same intent as a literal constant:

```
intent: 'override-artifact',
```

`SysMetadataRepository.delete` opens with `this.assertAllowed(ref.type, opts.intent)`,
the same gate `put` uses, and it refuses every type whose registry entry is not
`allowOrgOverride`. `object` is exactly such a type, so every created object of a
reverted commit came back in `failed[]`:

```
[NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.
Overlay-allowed: view, page, dashboard, app, action, report, dataset, ...
```

This is the FIRST-BUILD undo — the Studio / AI flow that publishes a brand-new app
and then undoes it. Every object the commit created stayed behind, the call
answered `success: false` with a populated `failed[]`, and the package was left
half-reverted: its overlay-allowed items removed, its objects not.
`rollbackToPackageCommit` reverts through the same loop and inherited it, and
there the symptom was quieter still — a per-item refusal never throws, so the
rollback recorded the commit as reverted and answered `success: true` while the
created object was untouched.

The limb now derives the intent from the artifact the way the sibling DELETE
caller `deleteMetaItem` already does — `isArtifactBacked` gives
`'override-artifact'`, otherwise `'runtime-only'` — and does it **per item**,
because one first-build commit routinely creates a runtime object beside a
packaged-artifact name. All three delete/revert callers (`deleteMetaItem`,
`rollbackMetaItem`, both `revertCommit` limbs) now derive the same fact the same
way.

The repository's gate is deliberately unchanged: it is right for callers that
genuinely mean "override a packaged artifact", and the defect was this caller
never saying which of the two cases each item is. An object a code package really
ships still resolves to `'override-artifact'` and is still refused with
`NOT_OVERRIDABLE`, which is pinned alongside the fix.
