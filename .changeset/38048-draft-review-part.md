---
'@objectstack/spec': minor
---

feat(spec): the `data-draft-review` part — the drafts one ask turn saved, with the door's verdict and the Studio review routes

Clause-②: yes (widening)
Metadata-protocol: added

- New in `@objectstack/spec/ai`: `DRAFT_REVIEW_PART_TYPE` (`'data-draft-review'`), `DRAFT_REVIEW_MAX` (50) and `DraftReviewListSchema` (`{ drafts, omitted? }`), with `DraftReviewItemSchema`, `DraftReviewVerdictSchema`, `DraftReviewVerdictRefusalSchema` and `DraftReviewLinksSchema` and their types. One row is `{ type, name, package, label?, verdict, verdictWithheld?, verdictError?, verdictRead, review }`: `verdict` is the light authoring door's own `list_drafts` verdict (`{ publishable, refusals, advisories }`, the findings in `RuntimeAuthoringIssueSchema`'s shape) or `null` when none was read, `verdictWithheld` / `verdictError` carry the door's `{ code, message, status }`, `verdictRead` is `turn-end` or `save`, and `review` holds the `changes` and `item` Studio routes, each a Console path. The five new objects are closed: an unknown key on the list, a row, the verdict, a verdict refusal or the links is refused, never dropped. The findings in `refusals` and `advisories` keep the door's own `RuntimeAuthoringIssueSchema` shape, which drops a key it does not know. A review link is refused when a browser could read it as another host: it must start with one `/` and carry no backslash, whitespace or control character. `drafts` has one row per draft, unique by `package`, `type` and `name`: a draft saved more than once in the turn is one row, at its first save, with the verdict read last.
- A host whose admin skill saved drafts during an ask turn sends one such part before the stream's `finish`; the console's chat draws it as a review card under the answer. Nothing in this repository produces the part.
