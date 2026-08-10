---
'@objectstack/spec': patch
---

Align two schema `.describe()` strings with their measured acceptance faces (docs-only; no acceptance change — every previously-valid input is judged byte-identically):

- `GroupingConfigSchema.fields` no longer claims "(supports up to 3 levels)". The gate is `.min(1)` with no upper bound, nothing downstream enforces a cap, and the grid renderer recurses over all configured levels — the describe now states the shape instead: array order is nesting order (first entry outermost), at least one field. (#7084)
- `NotifyConfigSchema.sourceObject` / `sourceId` no longer say "Requires sourceId." / "Requires sourceObject.". The schema deliberately accepts the half-specified pair — the executor drops it at execute time so the inbox never renders a dead link (the module JSDoc's recorded contract) — and the describes now state that tolerance. (#7085)
