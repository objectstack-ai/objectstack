---
'@objectstack/spec': patch
'@objectstack/skills': patch
---

docs(spec,skills): an `object-metric` tile's `polarity` is declared against the aggregate before `invert`, and `pages.md` points at it

Clause-②: no
Metadata-protocol: none

- **Before.** The `polarity` description said the badge arrow shows which way the number moved. Under `invert: true` the tile shows `1 - value`, so there are two numbers, and the text did not say which one the arrow and `polarity` read. The `objectstack-ui` skill's `rules/pages.md` taught the inline `object-metric` without naming `compareTo` or `polarity`.
- **Now.** The `polarity` description (and the reference page generated from it) says the badge and `polarity` read the aggregated value before `invert`, so `polarity` is declared against the raw value: an error rate shown as uptime is `lower`. The `object-metric` row in `rules/pages.md` names `polarity` and links to the `compareTo` section of `rules/dashboards.md`. The pointer is paid for by deleting three restatements in the same file; the file stays at its token count and no ceiling moves.
- **Unchanged.** No schema, accepted value, default or renderer behaviour moves.
