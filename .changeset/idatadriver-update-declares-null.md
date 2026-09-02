---
'@objectstack/spec': minor
---

feat(spec): `IDataDriver.update()` declares its not-found arm (#13878)

**BREAKING** for TypeScript consumers, shipped as `minor` under the repo's launch-window convention for breaking changes (maintainer ruling 2026-09-01, option A). `IDataDriver.update()`'s return type is now `Promise<Record<string, unknown> | null>` — the shape `findOne()` already carries and the not-found vocabulary `delete()` already uses (`false`) — and its docblock says when `null` is returned: no record with that id exists, on a driver not configured to throw on missing records. The Zod mirror `DriverInterfaceSchema.update` carries the same `.nullable()` output and the same sentence. This declares the behaviour four of the six shipped drivers have always had, which the previous declaration forbade.

What breaks: a caller that read fields straight off an `update()` result compiled before only because the arm was undeclared; it now narrows the `null` arm first — a compile-time obligation at the call site in place of a silent runtime hazard. No metadata key, no runtime behaviour and no wire shape moves.

<!-- adr-0087: not-required (no-migration-prescription) A declared return type gains the not-found arm the implementations already answer: no metadata key is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta`, `spec-changes.json` or the upgrade guide to rewrite; the obligation is a TypeScript narrowing at the consumer's own call site, and the compiler is the channel that reaches every affected consumer. -->
