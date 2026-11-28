---
'@objectstack/spec': minor
---

feat(spec): the `data-draft-review` part — the drafts one ask turn saved, with the door's verdict and the Studio review routes

Clause-②: yes (widening)
Metadata-protocol: added

- New in `@objectstack/spec/ai`: `DRAFT_REVIEW_PART_TYPE` (`'data-draft-review'`), `DRAFT_REVIEW_MAX` (50) and `DraftReviewListSchema` (`{ drafts, omitted? }`), with `DraftReviewItemSchema`, `DraftReviewVerdictSchema`, `DraftReviewVerdictRefusalSchema` and `DraftReviewLinksSchema` and their types. One row is `{ type, name, package, label?, verdict, verdictWithheld?, verdictError?, verdictRead, review }`: `verdict` is the light authoring door's own `list_drafts` verdict (`{ publishable, refusals, advisories }`, the findings in `RuntimeAuthoringIssueSchema`'s shape) or `null` when none was read, `verdictWithheld` / `verdictError` carry the door's `{ code, message, status }`, `verdictRead` is `turn-end` or `save`, and `review` holds the `changes` and `item` Studio routes, each a Console path. Every level is closed: an unknown key is refused, never dropped.
- A host whose admin skill saved drafts during an ask turn sends one such part before the stream's `finish`; the console's chat draws it as a review card under the answer. Nothing in this repository produces the part.
