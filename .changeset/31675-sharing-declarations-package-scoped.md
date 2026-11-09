---
'@objectstack/plugin-sharing': patch
---

feat(plugin-sharing)!: declared sharing rules, queues and assignment rules are read on (package, name), and a name two packages declare is refused, naming both

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) nothing an author writes is renamed, removed or re-shaped; the change is which declared item a bare name reads at runtime, so there is no stored or authored shape for objectstack migrate meta to rewrite -->

**BREAKING**, narrowly, for a deployment that already installs two packages declaring a sharing rule, a queue or an assignment rule under the same name. Who is affected: such a deployment only. Measured first-party: none (the showcase declares two sharing rules, no queue and no assignment rule; no two packages share a name).

The three declared types are addressed by `(package, name)` (ADR-0150). Every place the sharing plugin reads one of them by bare name now goes through objectql's shared package-scoped resolver:

- A name one package declares answers exactly what it answered before.
- A name two packages declare used to answer the first package registered, or, for a user's queues and the session's queue flag, the last. It is now refused: the declared sharing rule is not served and grants nothing, the queue resolves nowhere (a refusal naming both packages for a caller that asked for one), and a lookup by that name answers `409 RESOURCE_CONFLICT` naming both packages. The name stays taken: no organization's own rule or queue may take it. The refusal is logged once at `warn`, naming every holder.
- A declared sharing rule's queue recipient is read from the rule's own package: its own queue, or the one queue its declared dependencies hold. A queue only an unrelated package holds, or only an environment-authored registry item holds, is refused, naming the holder, where it used to be served. An organization's own queue (a `sys_queue` row) is served as before.

What to do if you see the refusal: keep one of the two packages' items under that name. If a declared rule's queue lives in another package, declare a dependency on that package.
