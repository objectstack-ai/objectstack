---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the ADR-0070 D1 refusal tells an operator with the hatch open that it does not reach package writability (#8361)

`OS_METADATA_WRITABLE` unlocks a metadata **type**; it has never unlocked a
package's **writability**. #8146 wrote that sentence into both package-door
emitters in `SysMetadataRepository`, so a refusal emitted while the variable is
set says so instead of leaving the operator to guess. On the override side that
clause is reachable, and #8184 made it reachable on scoped kernels too.

On the **create** side it was reachable from nowhere an author actually writes
from. `saveMetaItem`'s ADR-0070 D1 gate refuses on a strictly wider predicate
than the repository's package door — no "did the caller name a base" limb, no
registry limbs above it — so it threw first on every kernel, with its own
sentence, which had no hatch clause in it. Measured before the fix, with
`OS_METADATA_WRITABLE=permission` set and a runtime-only create aimed at a
read-only package:

```text
[writable_package_required] Cannot save permission/runtime_reviewer: the package
'com.example.showcase' is read-only (provided by code or an installed app).
Switch to a writable package in the package selector, or create a new one, and retry.
```

Byte-identical with the hatch open and with it shut. The operator is told the
base is read-only — true — and never told that the variable they set a moment
ago cannot make it writable. Milder than the false prescription #8146 closed on
the override side (D1 never told anyone to set the variable), so nobody retried
forever; the missing half is guidance, which is why this ships as a diagnostic
fix.

**What changed.** D1 now calls the repository's existing emitter,
`SysMetadataRepository.readOnlyBaseCreateError`, instead of spelling a second
sentence for the same condition — the create-side mirror of what #8184 did on
the override side, and the same one-emitter direction: two independently
authored refusals behind one condition is how a vocabulary drifts. The same
request now answers:

```text
[writable_package_required] Cannot create permission/runtime_reviewer in package
'com.example.showcase': that package is read-only (provided by code or an installed
app), so it is not a writable base. Switch to a writable package in the package
selector, or create a new one, and retry. (OS_METADATA_WRITABLE is set for
'permission': it unlocks the metadata TYPE, not package writability, so it does not
make a read-only package a writable base.)
```

With the hatch **shut** the clause is absent and the sentence keeps the remedy
that is true there — the clause is selected, never appended.

**No acceptance decision moves.** D1's predicate is untouched: every create it
refused it still refuses, with the same `WRITABLE_PACKAGE_REQUIRED` code, the
same 422, the same `packageId`, and the same ADR-0070 `docs` pointer; every
create it admitted — into a writable base, or naming no base at all — still
lands. Only the sentence the refusal carries changed.

`readOnlyBaseCreateError` gained an optional trailing `name` so the delegated
sentence can keep naming the item the way D1's always did. Omitted, its output
is byte-identical to what shipped in #8146 — which is what the direct
`repository.put` callers (`promoteDraft`, `restoreVersion`, `revertCommit`) see,
and until this change they were the *only* callers reaching that clause at all.
