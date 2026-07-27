---
"@objectstack/spec": major
---

feat(spec)!: dissolve the ObjectStackProtocol composition alias — ADR-0076 D9 end-state (v17, #3606)

The transitional union of the twelve per-domain contracts (and its parallel
`ObjectStackProtocolSchema` Zod object + `ObjectStackProtocolZod` inferred
type, 171 schema lines) is removed. Capability availability comes from the
runtime discovery `services` registry — a static union was its degraded
snapshot (ADR-0076 rev.7 verdict). Depend on the narrowest per-domain slice
(`DataProtocol`, `MetadataProtocol`, …; composition precedent: REST's
`DataProtocol & MetadataProtocol`, A1.5/#3028).
`ObjectStackProtocolImplementation` now declares exactly the four domains it
actually provides (Data/Metadata/Analytics/Package) — the D10 "facade never
implemented the other domains" reality, now enforced by the type system.
BREAKING for anything importing the alias or the Zod schema; no runtime
behavior change.
