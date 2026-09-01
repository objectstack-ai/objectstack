---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

feat(spec,metadata-protocol): a page hit kind on `GET /api/v1/search` — the command palette indexes published pages (#13216)

Direction 3 of #13216, the complement the 2026-08-29 maintainer ruling adopted
beside the landed direction 1 (#13372): a custom page created and published at
runtime rendered perfectly and was absent from the ⌘K palette door alone
(#13100 measured it) — `searchAll` swept object RECORDS and nothing else, so
the artifact an agent grew into a running app was reachable by direct URL only.

**The widened body.** `SearchAllResponseSchema` gains a required `pages`
member — an array of the new `SearchAllPageHitSchema`
(`{ kind: 'page', name, title, snippet?, pageType? }`), declared as produced
like its #11924 siblings. Page hits are deliberately a SIBLING array, never
members of `hits`: every `hits` element is a record with an `object`/`id`
address, and an existing consumer iterating it must not receive an element
whose address vocabulary it predates. `kind: 'page'` is the self-describing
discriminant for clients that flatten both arrays into one palette list. The
blank-query short-circuit carries `pages: []`.

**Zero new authorization surface — the swept set IS the served set.** Pages
reach the sweep through `getMetaItems({ type: 'page' })`, the same verb the
REST `GET /meta/page` list door serves, org-scoped through the same
registry-derived predicate every REST meta read door uses
(`organizationIdForMetaRead`, #9454). Published (`state: 'active'`) items
only — drafts surface exclusively under `previewDrafts`, which the sweep
never passes — and whatever the read door withholds (a disabled package's
pages included) the sweep never saw. A page hit therefore surfaces to a
caller exactly what that caller's own meta read door already answers — name,
label, description — never more; opening the hit goes through the existing
page routes/renderer, where the page's own audience gate
(`assignedProfiles`) applies unchanged. Search is not a second read door,
and no `allowOrgOverride` / `allowRuntimeCreate` flag moves.

**Matching and caps.** AND of terms, OR of fields (name, every locale value
of label/description), case-folded — the record sweep's term semantics,
restated for metadata because there is no engine expansion to delegate to.
Page hits cap at `perObject` (the page store is one more scanned container,
not a competitor for `limit`), titles resolve through the shared
`resolveI18nLabel` chain, and the snippet is cut from the description with
the same excerpt geometry as record hits. A SCOPED sweep (`?objects=…`)
answers `pages: []` — it asks for records of those objects. A failed page
read propagates (#8896's rule): a partial scan must not wear a whole one's
answer.

No REST handler change — `GET /api/v1/search` relays the producer's return
bare, exactly as before, and no request parameter is added.
