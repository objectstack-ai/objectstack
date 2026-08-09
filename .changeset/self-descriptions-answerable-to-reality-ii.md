---
"@objectstack/spec": patch
---

docs(spec): two self-descriptions re-anchored to measured reality — the `chartConfig` liveness evidence and `allowAddTab`'s `.describe()` (#7017, #6961)

Sweep card #7056. Both members are prose that stopped being answerable to the
code it describes: one **overstated** what a reader delivers, one **understated**
what a renderer now delivers. Zero acceptance-face change — no schema key, no
enum member, no strictness posture moves, and the only generated artifact that
shifts is the `.describe()` row in `content/docs/references/ui/view.mdx`.

**#7017 — `widgets.children.chartConfig`'s evidence said "chart-config bag
forwarded", which was never measured.** The cited lines took the bag out of the
widget and the line after them read exactly one key (`showLegend`, #3135); the
rest of `ChartConfigSchema` stayed unforwarded. #5175 measured that (1 of 14
keys reaching the renderer) and recorded that the wording had already mis-steered
the #5022 measurement for half its length. Since then #7016 landed the enforce
half in objectui, so the row is re-anchored to today's reality rather than to
either older state: at objectui `@230ffd875`, `chartConfigPresentation` lowers
**nine** keys one `if` per key — `showLegend`, `showDataLabels`, `title`,
`subtitle`, `description`, `height`, `annotations`, `interaction` and `colors`
(split into the positional palette and `categoryColors`) — and the caller spreads
the result onto the chart schema handed to the renderer, with a DOM test pinning
each forwarded key. The remaining **five** are named as unforwarded and why:
`xAxis` / `yAxis` / `series` are derived from the dataset selection, `type` is
answered by the widget's own `type` through `CHART_TYPE_MAP`, and `aria` has no
reader on that path. The entry also gains `verifiedAt: 2026-08-09` and
`evidenceScope: "cross-repo"` (the objectui realm was walked, at a pinned
commit), the two fields #7024 added for exactly this.

The verdict is unchanged — `live`, as it was, now for a reason the evidence
actually supports. No `children` are opened and no key is classified: the
narrowing half for the five unforwarded keys is still an open maintainer decision
on #5175, and the note says so, so this row cannot be read as pre-empting it.

**#6961 — `UserFiltersSchema.allowAddTab` still described the interim,
deliberately-narrowed contract.** #5073 promoted the key with a `.describe()`
that promised only that the tab bar *renders* an add-tab affordance, because the
button objectui shipped had no click handler — narrowing on purpose rather than
advertising a capability the runtime did not deliver (PD#10). The maintainer then
ruled **A1 — implement, session-scoped** (#5236, 2026-08-06) and objectui#3926
delivered it. The describe now states the semantics that are actually shipped:
the affordance asks for a name and snapshots the filters currently applied as a
new tab; the tab is **session-scoped** — it lives only for the current mount and
is never written back as metadata (ADR-0047, which scopes an end user's filter
choices to the session) — and it carries a remove control the authored presets do
not. The applicability sentence #5073 wrote is kept verbatim: page lists only,
object views use `listViews` for named presets. The `⚠️ Scope of the promotion`
TSDoc above the schema, which recorded the dead-button state as current, now
records how it was resolved instead.

The ruling confirmed renderers do not read this text, so this is documentation
semantics only: no runtime change, and the JSON-Schema baselines and the docs
site are regenerated with the describe.
