---
"@objectstack/plugin-security": patch
"@objectstack/objectql": patch
---

fix(plugin-security): a row-level `check` now holds for every row a multi-row write stores — an array insert and a predicate (`multi: true`) update (#19950, #19964)

A row-level security `check` (declared on the policy, or defaulted from its `using`) is the write-side half of the policy: a row the check refuses is never stored. The write gate enforced it for a single-row insert and for a by-id update. It did not enforce it for the two multi-row write shapes:

- **An array insert** (`insert(object, [rows])`, which the create-many data route calls). No check was installed for an array payload, so the rows were stored unjudged.
- **A predicate update** (`update(object, changes, { where, multi: true })`). The new rows were never judged. The gate assumed a `using`-scoped `where` covered the write, but a policy that declares only `check` scopes nothing, and a scoped `where` says nothing about the new row in any case.

Both shapes are now judged row by row, with the same refusal the single-row shapes give: `403 PERMISSION_DENIED`, and nothing is stored. One failing row refuses the whole write.

- **Array insert.** Every row is judged on the image the `beforeInsert` chain produced, as a single insert is.
- **Predicate update.** Every row the write selects is judged on its new image: the matched row merged with the final payload. The engine supplies the rows (`@objectstack/objectql`): the security layer installs its judgement on `OperationContext.postHookWriteImageCheck`, the seam the insert check already uses, and the engine runs it on the predicate path over the rows its composed query selects, once the payload is final. That is the one matched-row read the path already makes for validation and per-row hooks, not a second one.

**Writes that are now refused.** A multi-row write is refused where the same row written alone would be:

- a predicate update under a policy that declares only `check`, when any matched row's new image fails that check;
- a predicate update that moves a matched row out of a policy's `using` when no applicable policy declares `check`. The `using` is the defaulted check, and this is the answer the by-id update already gives;
- an array insert when any row fails the check, including every configuration that already refused each single insert (a `using` or `check` that does not compile).

**What does not change.** A by-id update and a single-row insert are judged exactly as before. A predicate update still touches only the rows its scoped `where` selects; the check refuses a write, it never widens or narrows which rows are selected. A predicate update whose new rows all pass is admitted as before. A system-context write is not gated.

**Hosts that run the security plugin with their own write executor.** A predicate update that installs the judgement and returns without the engine having run it is now refused, as an insert already is: `403`, and an `error` log saying the check was not evaluated.
