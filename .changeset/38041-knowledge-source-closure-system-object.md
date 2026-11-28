---
'@objectstack/lint': minor
---

fix(lint)!: under a stated package closure, a knowledge source naming a `sys_` object the host does not serve is refused at publish; the no-package refusal is worded for its author

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — the published skill already teaches that a `source.object` naming no object is refused, and names no platform-name arm this change moves

<!-- adr-0087: not-required (already-registered knowledge-source-publish-refuses-missing-references-and-gated-objects) the entry that registered this rule's publish refusal landed with the rule itself; this change extends the same refusal to an absent `sys_` name judged under a stated package closure, which keeps every system object the host serves. No id is added and no key is added, removed or re-shaped. -->

ADR-0161 K4, row 4.

**BREAKING** for the publish of a packaged knowledge source whose `source.object` is a `sys_` name the host does not serve: when the publish gate states the package's closure, such a name, known (`sys_user`) or not, is now a `knowledge-source-object-unknown` error (422). Before, a known one was not judged, and an unknown one was refused with a dependency remedy that cannot help, because the closure already keeps every system object the host serves. FROM a source over such an object TO a source over an object the host serves: name the system object by its full name, or install the package that registers it where this package is installed. A `cloud_` or `ai_` name is not on this arm: the closure keeps such an object only when its definition marks it `isSystem: true`, so its verdict is unchanged. On the command line nothing changes.

- A knowledge source write that names no package, refused for an object the host does not serve, now tells its author to name an object the organization has or install the package that provides it, instead of a stack and a manifest that author does not have.
- `ai_context`: a `body.field` of `id` is reported as the record id every object carries, not as "a untyped field"; a declared field's type now takes the right article.
- `os explain knowledge-source-object-unknown` and the rule's header state which platform-name arm holds on the command line, under a closure, and against the whole collection.
