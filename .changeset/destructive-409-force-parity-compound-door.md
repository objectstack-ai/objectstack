---
"@objectstack/rest": minor
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
---

**Fix:** the `409 DESTRUCTIVE_CHANGE` on the two remaining `/meta` write doors stops prescribing a `?force=true` those doors never read — the compound-name REST `PUT` now reads it, and the runtime dispatcher says plainly that it cannot (#11095).

`saveMetaItem`'s Phase 3a-destructive gate raises one refusal and ends it with a remedy clause. That clause read `— re-submit with ?force=true to proceed.` on every door, and was true of exactly one of them. A caller refused on either of the other two, doing precisely what the sentence told them to do, got the identical refusal back, with nothing in the second answer saying the parameter had been ignored. #11015 repaired the duplicate-package face; these are the two doors it measured and deliberately left, because the honest repair for each was a contract question rather than a wording one.

The maintainer ruled a **split**, and the two halves are not the same fix:

- **`PUT /api/v1/meta/:type/:section/:name` (compound name) now accepts `?force=true`**, so the sentence became true rather than being reworded. This is #7019's ruling applied once more with its reason: the compound route is "word for word the same operation" as its single-segment twin — one generic `saveMetaItem`, reached by a name spelled in two segments — and gating only the twin was *measured* to leave this door a bypass of the gate. Every divergence found between the pair since has closed on that same finding (#6603/#7019's capability gate, #8805's write-side organization, #7035's 501 envelope). The truthy spellings (`true`/`1`/`yes`/`on`, case-insensitive) match the twin exactly, and a **repeated** `?force` is refused with `400 VALIDATION_ERROR` in the same stroke — #6877's sharpest measured case is on this very parameter one route over, where an array falls through to `!!raw` and turns a doubled explicit opt-*out* into force ON.
- **The runtime dispatcher's `PUT /meta` does not gain `force`, and does not pretend to.** It has no twin precedent and a different call shape: the branch is reached with a path, a method and a body, so `?force=true` names a channel the transport does not have rather than a parameter someone forgot to read. It now states its own write face (`meta-dispatch`) and its refusal says so, prescribing what a caller can actually do at that door — submit a body that keeps what the stored item still carries, or reconcile that item first.

For callers this is one widened surface and one corrected instruction. A Studio or SDK caller that hit the compound-name door on a destructive object edit and had no way forward now has the same acknowledgement path the single-segment door has always offered; a dispatcher caller stops being sent in a circle. Nothing that was accepted before is refused now: the dispatcher's accept set is unchanged, and `?force` on the compound door only ever *widens* what that door takes.

The `422 INVALID_METADATA` behaviour is untouched on every door — the new face shares the existing headline case, so the structured `issues[]` channel and the trimmed message stay exactly as #10888 left them.
