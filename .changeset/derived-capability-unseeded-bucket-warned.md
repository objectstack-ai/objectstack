---
"@objectstack/plugin-security": patch
---

fix(plugin-security): the derived capability seeder's skip is counted and warned instead of leaving the platform bucket silently unseeded (#8536)

**This does not change what the seeder does. It changes whether an operator can
tell what it did.** No adoption, no backfill, no new writes — the #5876 guard
keeps declining an authored row, which is the ruled behaviour (#8552 settled the
posture on an occupied platform bucket: keep declining, loudly).

`bootstrapSystemCapabilities` derives a placeholder `sys_capability` row for any
capability a bootstrap permission set grants by name. Its lookup runs under the
system context, which carries no `tenantId`, so it reads **across
organizations** — and when the row it finds is one it does not own, the #5876
guard `continue`s before any insert is attempted.

Before #8461 that was harmless, because `name` was unique installation-wide: "a
row resolves this name" and "the platform holds a row for this name" were one
statement, which is exactly what #5876's reasoning rests on ("the capability
resolves and the authored copy is the better one"). Per-organization uniqueness
(ADR-0120 D1) separated them. An organization's row now satisfies the lookup
while the platform's NULL-organization bucket is **never written at all**, and
nothing said so: `skippedAuthored` moved, and that counter cannot distinguish
"an authored copy was left alone" from "the platform's definition exists
nowhere".

The skip now reads the platform bucket once — on that branch only, the same cost
the curated half already accepted — and warns with the curated half's
provenance-naming shape: it names the `managed_by` and organization it **read**
off the blocking row rather than asserting an ownership verdict, states which of
the three bucket observations it saw (free / held by an unstamped row / held by
a row with a named provenance), and carries the #8552 hand-resolution line only
where a row an operator may legitimately rename is what blocks the bucket. Where
an organization's row is what stands in the way, the message says there is
nothing to remove — that row is a supported ADR-0066 D1 extension.

The warning fires only where the platform's own placeholder is genuinely
**absent**, so it means one thing. A skip that declines a mere refresh — the
placeholder is present and simply was not the row the cross-organization lookup
selected — stays summary-only, as #4632 decided.

`CapabilitySeedResult` gains `unseededDerived`, a documented **subset** of
`skippedAuthored` rather than a split of it: the existing counter keeps its
meaning and its value, because the two facts are separable only since #8461 and
neither should be inferred from the other.
