---
"@objectstack/spec": minor
---

fix(spec): the owner-stamp build door judges a `packages[]` artifact's top level the way the boot does

`defineStack`, `os validate` and `os build` refuse a collection item whose body `_packageId` names a package other than the one that ships it. For a release artifact (`packages[]`), the top-level item no body declares is the stack's residual, judged against `manifest.id`. Which top-level items are residual is now read the way the boot reads it (`unclaimedTopLevel`, `@objectstack/metadata`), so the build door refuses a residual's stamp exactly when the boot does:

- top-level seed `data`, `datasets` and `jobs` are never judged as residual items: the boot applies, consumes and schedules them straight off the stack, files none of them as residual items and judges none of their stamps. A package body's items of these collections are still judged at both doors;
- a top-level view container is claimed by the object it binds to (its own `object`, else its list's or form's `data.object`), however the binding is spelled, and a body's container also claims every view it expands into. A top-level copy of a body's container written the other way round is no longer judged against the artifact's id, and a top-level container binding another object through its list alone is no longer passed over as a copy;
- a top-level item with no registry slot (no `name`, and for a view no binding) is not judged, since no door registers it.

Clause-②: yes (widening) — the build door stops refusing three shapes the boot accepts: a foreign-stamped top-level seed dataset, `datasets` entry or job of a `packages[]` artifact, and a top-level copy of a body's view container spelled with another binding. The one shape it now refuses that it accepted before, a top-level list-bound container no body declares wearing a foreign stamp while a body carries any list-bound container, is one the boot already refused and the pending build-door refusal for collection item stamps already declares refused ("a top-level item no body declares judged against `manifest.id`").

Metadata-protocol: added (a foreign `_packageId` on a top-level `data`, `datasets` or `jobs` item of a `packages[]` artifact, and on a top-level copy of a body's view container, is accepted at the build doors as it is at boot)
