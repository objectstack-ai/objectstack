---
'@objectstack/spec': patch
---

Correct what `retiredFromLoadPath` declares about its own reach.

The flag's docs said a retired conversion is "never at load" and that "the load
seam never sets this — only `objectstack migrate meta` (and the fixture CI)
replays it". Neither half held. Three data-at-rest call sites pass
`includeRetired: true` on purpose — `applyConversionsToStoredItem` (which pins
it rather than offering it), flow rehydration in the automation engine, and the
artifact-ingestion door `applyArtifactForwardConversions` — and `migrate meta`
does not reach the option at all: `applyMetaMigrations` looks each step's
conversion up by id and calls `apply` directly.

What the flag actually governs is the **authoring** surface: it keeps the entry
off `normalizeStackInput`, the single funnel for `defineStack`, `validate`,
`lint`, `compile`, `info` and `doctor`, so a live author meets the tombstone
instead of a silent rewrite. That split is what ADR-0087's
`## Addendum (2026-07-31)` and the artifact-door ruling both bought.

Documentation only — no behaviour, no schema key and no export moves. The
corrected text ships in `dist/*.d.ts`, and the split it describes is now pinned
by a test that drives `normalizeStackInput` and `applyConversionsToStoredItem`
over the same bytes, so the sentence and the behaviour cannot drift apart again.

Authors setting this flag on a **default flip** (old and new shapes both legal,
meaning different things) should read the corrected doc: the flag does not
confine such a rewrite to history — the data-at-rest seams still apply it.
