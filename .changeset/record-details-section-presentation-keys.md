---
'@objectstack/spec': minor
---

Declare `hideEmpty` / `collapsible` / `showBorder` on `record:details`
sections — the three keys objectui's renderer has honoured all along

`RecordDetailsRenderer` spreads every authored section through to
`DetailSection`, which reads all three — but the strict section schema
declared only `name` / `label` / `columns` / `fields`, so
`objectstack validate` warned that an authored key "did nothing". For
`hideEmpty` the warning hid the one key that decides whether a section
exists at all: the renderer forces `hideEmpty ?? true`, and a section whose
fields are all empty then renders nothing — no heading, no skeleton — with
no declarable spelling to ask the skeleton back (a freshly created record
losing two of its three authored sections is how this surfaced).

Accept-set widening only; the renderer is unchanged (maintainer ruling
2026-08-23, direction 1). All three keys are optional with **no schema
default** — the fallbacks are the renderer's, and the describe() texts
state them as measured at the `.objectui-sha` pin: `hideEmpty` on;
`collapsible` off; `showBorder` derived (on for a titled section, off for
an untitled one). `hideEmpty: false` now keeps a section's label skeleton
on an all-empty record, and schema and runtime finally say the same thing.
