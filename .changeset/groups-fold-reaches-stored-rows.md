---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a Studio-saved form authored with `groups` reaches the stored row as `sections` (#7134)

#6926 / PR #7128 folded `FormViewSchema.groups` onto the canonical `sections` at
the producer, which made the declared alias true for every consumer of a
**parsed** form. It did not reach a form authored in **Studio**. `saveMetaItem`
parses the body through that very schema — so since #7128 it already *computes*
the folded body — and then discards `parsed.data` on purpose, because a
wholesale swap would strip the Studio-only round-trip keys (`isPinned`,
`isDefault`, `sortOrder`) that ride along with an overlay. The authored spelling
was therefore persisted verbatim, and the row reached `sections`-reading
consumers still spelled `groups`.

Measured consequence on the public-form routes in `@objectstack/rest`, for a
form saved from Studio rather than declared in code:

- `GET /forms/:slug` published an **empty** field schema (#6601's narrowing
  found no declared fields to publish);
- `POST /forms/:slug/submit` computed an empty `allowedFields` whitelist and
  **refused the submit outright** (#6920).

**The fix is a new sibling of `graftNormalizedOperators`, not a fallback in the
consumer.** Per Prime Directive #12 the producer stays strict and
`rest-server.ts` is untouched — a `?? match.form?.groups` there would fossilize
the alias into a second de-facto contract and leave the next consumer blind.
`graftFoldedFormSections` walks the authored body and `parsed.data` in lockstep
and replays exactly one normalization: at any position where the author wrote
`groups`, the parse dropped it, and the parse produced `sections` in its place,
the authored array is moved to `sections` verbatim. That is the exact
post-condition of the producer's fold, so no list of "places a form can live" is
maintained — the flattened runtime overlay, `config` on a `ViewItem`, and
`form` / `formViews.*` on a container are all covered by one walk, and a form
slot added later is covered without an edit.

A **sibling** rather than a parameter on the existing helper because
`graftNormalizedOperators` walks by structure and copies a changed *scalar* at a
key both sides carry; `groups` → `sections` is a *key move* — one key removed,
another added — which its per-key loop cannot express. Both grafts now run on
every save, the fold first.

Nothing else about the save changes: the body is still persisted verbatim, the
moved array keeps the authored shape (no schema defaults are stamped onto it),
`sections` still wins when the author wrote both keys (empty array included, the
producer's own precedence rule), and the Studio round-trip keys still survive.

⚠️ Rows persisted **before** this change still carry `groups`; they are healed by
the author's next save, the same way #4542's flow rows are. Nothing is
backfilled at read.

`packages/spec` is unchanged — this narrows what is *stored*, never what is
*accepted*; `groups` remains legal at input.
