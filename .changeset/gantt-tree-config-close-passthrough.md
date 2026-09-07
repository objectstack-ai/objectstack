---
"@objectstack/spec": minor
---

feat(spec)!: `GanttConfigSchema` / `TreeConfigSchema` refuse undeclared keys — both `.passthrough()` windows are closed and the ten gantt members plugin-gantt read through the window are declared (#15469)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: every key either block accepted by declaration still parses, and the ten gantt keys that used to ride through `.passthrough()` are now DECLARED at the types the renderer reads, so an author who wrote them keeps parsing byte-identically. The only newly refused input is a key no renderer ever read — a misspelling or an invention — for which there is no rewrite to prescribe. -->

**BREAKING** accept-set narrowing on two published authorable config blocks —
`ListView.gantt` (`GanttConfigSchema`) and `ListView.tree` (`TreeConfigSchema`)
in `@objectstack/spec/ui`, reached through every view door (`defineView`,
`objects[].listViews`, the `view` metadata type): an UNDECLARED key inside
either block is now **refused** at parse with the `strictObject` named error
(`unrecognized_keys`; surface named, key echoed, closest declared key
suggested), where it used to pass through silently. Shipped as `minor` under
the repo's launch-window convention for breaking changes. Maintainer ruling
2026-09-05 on #15469 (director decision batch #41 item 2, verbatim 「同意」):
option A for both sites.

Both blocks were `strictObject(…).passthrough()` — the campaign's own helper
applied and immediately undone, so `colourField` on a gantt block parsed green
and rendered an uncoloured bar while the same typo on a calendar or timeline
block got a named refusal. One `strictObject` applied and then undone is two
contracts on one surface (Prime Directive #12); the renderer-ahead window it
kept open is shut, and a renderer knob is declared in the spec before it is
read.

**Newly declared on `GanttConfigSchema`** — all optional, types measured from
objectui's `GanttConfigExtensionFields` (`@object-ui/types/zod`) at pin
`a472b07`, each with a describe saying what plugin-gantt does with it:

- `borderColorField: string` — field carrying a per-task alert stroke color
- `lockField: string` — field marking a row view-only (truthy = locked)
- `objectField: string` — field carrying the row's own object API name (mixed-object trees)
- `summaryExtent: 'children' | 'self'` — how a summary bar's span is computed
- `defaultCollapsedDepth: integer ≥ 0` — auto-collapse nodes at or below this depth
- `dependencyTypes: boolean` — whether the store persists dependency link types
- `timeZone: string` — IANA business time zone the calendar renders in
- `exportFileName: string` — base name for exported PNG / PDF files
- `interactions: { move?, resize?, progress?, link? : boolean }` — per-interaction switches (closed sub-object)
- `timeSegments: { dayStart?: string, bands: [{ key?, label, start, end, color? }], showMidnight?: boolean }` — shift segmentation for the day-mode timeline (closed sub-objects)

**`TreeConfigSchema` declares nothing new.** plugin-tree's `getTreeConfig`
(objectui `a472b07`) reads exactly the four keys already declared —
`parentField`, `labelField`, `fields`, `defaultExpandedDepth` — from the `tree`
block, so the close refuses only what no renderer ever read.

**Who is affected (measured, objectstack `f7db8f4fd`):** zero gantt or tree
blocks under `examples/**`, `content/docs/**`, `skills/**` or any package
fixture author one of the ten keys or any undeclared key; objectui's own gantt
fixtures author the ten and keep parsing because the keys are now declared. A
block carrying a key outside the declared set — a misspelling such as
`colourField`, or a renderer knob authored ahead of its declaration — is refused
on upgrade with the key named; fix the spelling, or declare the knob in the spec
first.
