---
"@objectstack/spec": patch
---

docs(liveness): designer previews count as consumers — re-grade four docs-shaped rows dead → live and write the principle into the ledger methodology (#7131)

The ledger said `job.label`, `job.description`, `translation.label` and
`translation.name` had **no runtime consumer**. objectui's metadata-admin
previews had been rendering all four to a human the whole time:
`JobPreview.tsx` takes `label`/`description` off the job draft and renders them
as the preview card's title and subtitle, and `TranslationPreview.tsx` takes
`label` — falling back to the body `name` — and renders it as the item's title.

Per the maintainer ruling of 2026-08-10, a designer preview that renders a key
to a human **is** a runtime consumer, so the four rows re-grade to `live` with
realm-marked, commit-pinned objectui evidence, and each carries a `producer`
naming the `registerMetadataPreview` call and the surface that resolves it — a
preview no registry ever hands a draft to is a read point that never runs.

Nothing about enforce-or-remove moves: all four keys remain docs-shaped,
deliberately KEPT under the ADR-0033 exemption, and still not `authorWarn`'d.
`job.label` is `live` because a human sees it in the designer; the scheduler
still stores name and schedule only, and the row now says so explicitly.

The README gains the methodology section the ruling asked for, so the next sweep
asks the question mechanically instead of rediscovering it: enumerate a type's
registered preview read points **before** writing "no runtime consumer", and
record their absence when there are none. It divides against the existing
"an authoring/preview renderer is NOT a runtime consumer" section on what the
property claims rather than on what the surface is — for a **display** key the
render is the whole of the declared effect, while for a **behavioural** key a
panel echoing the value back still proves nothing. The 2026-07 sweep's ten
corrections are explicitly not reopened.

Ledger and documentation only; no schema, no runtime behaviour.
