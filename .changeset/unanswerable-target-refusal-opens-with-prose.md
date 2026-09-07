---
"@objectstack/metadata-protocol": patch
---

`findReferencesToMeta`'s unanswerable-target refusal now opens with prose instead of a machine-shaped `[unanswerable_target]` tag that nothing read.

```
before  501 {"error":{"code":"NOT_IMPLEMENTED","message":"[unanswerable_target] References to a 'field' item cannot be computed. … Ask the owning object instead: GET /api/v1/meta/object/account/references."}}
after   501 {"error":{"code":"NOT_IMPLEMENTED","message":"References to a 'field' item cannot be computed. … Ask the owning object instead: GET /api/v1/meta/object/account/references."}}
```

Nothing else moves: same `501`, same `NOT_IMPLEMENTED`, same envelope position, and the prescriptive sentence ADR-0110 D3 requires is untouched. Callers branch on `code`, which is unchanged; only the human-facing sentence is shorter.

Why the tag was wrong here specifically. This producer writes a bracketed tag on many refusals, and every other one is the lowercase restatement of that throw's own declared `code` — `[item_locked]` with `ITEM_LOCKED`, `[no_draft]` with `NO_DRAFT`, `[invalid_request]` with `INVALID_REQUEST`. Measured across the two producer files, 30 of the 31 tagged throw sites that declare a code restate it that way. This refusal declares `NOT_IMPLEMENTED`, so its tag was the sole exception: it named a token the envelope carries on no axis, and a repo-wide search finds no parser, no switch, no assertion and no doc that reads it. Per the ruling behind the `/data` door's `FORBIDDEN:` prefix removal, `error` is human language and `code` is the machine token.

It became worth fixing when the `/meta/:type/:name/references` door started relaying the producer's prose verbatim: before that the whole sentence was replaced by `Internal server error` and the tag reached nobody, and after it the tag was the first thing an operator read on the screen where they decide whether to delete something. The `@objectstack/rest` entry in this release quotes the pre-removal sentence in its example; this entry is the later word on that wire text.

The absence is now pinned in `protocol.reference-target-unanswerable.test.ts` — nothing pinned the tag, so without a pin nothing would have pinned its removal either.
