---
"@objectstack/spec": minor
---

The unknown-authoring-key lint now descends into nested metadata, not just each
item's top level.

`lintUnknownAuthoringKeys` (#3786) reported unknown keys on each metadata item's
top level plus one hard-coded hop into `object.fields`. That left **227
strip-mode objects** nested below those roots reporting nothing — and they are
concentrated exactly where authoring volume is: `object` 71, `view` 49, `page`
24, `dashboard` 18, `agent` 16, `mapping` 14. Those sites were both silently
dropping keys and contributing nothing to the evidence base the v18 strict
close-out is meant to be scheduled on.

The walk now follows the authored value alongside its schema through nested
objects, arrays and records. Posture rules are unchanged, so the lint still never
double-reports what the parse already handles:

- `strict` → silent (the parse is loud on its own)
- `passthrough` → silent (the key legally survives)
- `strip` → reported, and the descent continues through it

Unions descend only when the authored value picks a branch unambiguously — a
discriminated union whose discriminator the author actually wrote. Otherwise the
merged posture applies at that level and the walk stops, because guessing a
branch would invent findings against a shape nobody wrote.

`object.fields` still reports as the `field` surface with its curated guidance,
now via an explicit override table rather than a special case — so its own nested
sites (`fields.*.options[]`, …) are covered too.

Still non-blocking: these are warnings from `defineStack()`, `os validate` and
`os compile`, exactly as before. Expect existing projects to surface more of
them — each one is a key that was already being dropped, now visible.
