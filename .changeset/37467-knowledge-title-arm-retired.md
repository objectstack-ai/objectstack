---
'@objectstack/service-knowledge': patch
---

fix(service-knowledge): the knowledge field gate stops asking about a field named `title`; a source whose index could still hold an earlier-rule title is searched only once its index is proven built under the current recipe

Clause-②: yes (narrowing) — narrowed: for a caller other than the system context, a source over an object that declares a field named `title` it does not serve (the object's display field is another field, and the source lists `title` in neither `content` nor `metadataFields`) is now searched only when its adapter's `indexStatus` reports the fingerprint and the recipe hash the service computes now; otherwise the search names it in `refused` as `KNOWLEDGE_REBUILD_REQUIRED` (409), and refuses whole when it was the only source, where it was searched for any caller who may query `title`. That holds until a complete build of the source has completed, and for good on an adapter with no `indexStatus`, or with no `completeBuild` to record a recipe hash. Widened: saving a `knowledge_source` over such an object no longer requires the author to query `title`, which the source never indexes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is whether a search serves a source whose index is not yet proven built under the current recipe. The operator's fix is in the body. -->

**BREAKING** for deployments whose knowledge sources sit over an object that declares a field named `title` beside another display field:

- **Such a source is refused `KNOWLEDGE_REBUILD_REQUIRED` until its index is proven current.** The boot's build pass builds a source whose index records no recipe hash or another one, and the refusal ends when that build completes. Fix: none is owed for a built-in adapter (memory, pgvector, Turso); to end it sooner, run `os knowledge rebuild <source>`.
- **On an adapter with no `indexStatus`, or with no `completeBuild`, such a source stays refused**, since what its index was built under cannot be read. Fix: implement `indexStatus` and `completeBuild` on the adapter (`@objectstack/spec/contracts`, `IKnowledgeAdapter`), then rebuild the source.

The field gate (ADR-0090 D10 rule 1) kept asking whether the caller may query a declared `title` field alongside the object's display field, because a document indexed before the title became the display field carries the value of `title`. That arm is retired. A complete build under the current recipe removes every such document: the recipe hash names the title rule (ADR-0161 K7) and was first recorded by code that already read the display field, and a complete build rewrites each document whose title changed (its `docHash` covers the title) and purges the rest. So the search asks for that proof per source instead, and only for a source where it matters: one over an object that declares no `title` field, whose display field is `title`, whose `title` is credential-class or `internal`, or that serves `title` itself, is searched as before, with no extra read. Every other arm of the gate (the display field, each `content` and `metadataFields` member, the fields `where` reads, the object-level gates) is unchanged.
