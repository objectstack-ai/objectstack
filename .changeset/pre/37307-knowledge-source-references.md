---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

**Shipped in 19.0.0-next.2**, whose CHANGELOG missed this entry; listed here one prerelease late.

fix(lint)!: a knowledge source is checked for its object, its fields and the search gates that need no caller, in `os validate` and at publish

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-ai/SKILL.md

<!-- adr-0087: registered knowledge-source-publish-refuses-missing-references-and-gated-objects -->

ADR-0161 K4, row 4.

**BREAKING** for the publish of a knowledge source that carries one of the four errors below: it was accepted before and is refused now (422, the finding's rule id, path, message and fix), and `os validate` / `lint` / `compile` / `build` refuse the same source. The schema is unchanged, and stored sources are not rewritten or refused at boot.

A new rule, `validateKnowledgeSource`, exported from `@objectstack/lint` with its five rule id constants. It runs on all three CLI commands and on the runtime publish gate for a `knowledge_source` write, with one set of rule ids and messages. Four errors: a source over a missing object has nothing to index, a missing field indexes no text for that member, and a gated object is never searched for a caller the service judges:

- `knowledge-source-object-unknown`: `source.object` names an object that the stack, a package of its artifact, or (at the publish gate) the host does not define. Under the package closure the publish gate states, an object outside it is worded for the closure with the remedy to declare the dependency. On the CLI, while the manifest declares a dependency the artifact does not carry, the build cannot see that package's objects, so the finding is a warning that clears when the dependency defines the object (the publish gate judges it against the closure, which holds them); with no such dependency it is an error. A platform object a known package registers is not judged when the stack does not carry it; a platform-prefixed name no known package registers is a warning.
- `knowledge-source-field-unknown`: a `source.content` or `source.metadataFields` member names no field of the object, declared (the stack's own object extensions included) or addressable without a declaration (`id`, which the driver provisions, and the injected system columns `owner_id`, `created_at`, …).
- `knowledge-source-object-not-searchable`: the object's API exposure does not serve `search` (`canServeApiOperation(enable, 'search')`): `enable.apiEnabled: false`, an `enable.apiMethods` list that does not grant `list` (search derives from it; `search` itself is a retired list value the parse strips), or a list that grants `list` beside `enable.searchable: false`. With no `apiMethods` list, `searchable: false` does not refuse it.
- `knowledge-source-system-object-not-ai-readable`: a `sys_` object that does not declare `enable.aiReadable: true` (`isAiReadExposed`).

One warning, which refuses nothing:

- `knowledge-source-field-never-indexed`: a member names a credential-class field or a field declared `internal: true`; the index never carries either, even when named, so the member is skipped.

The two gates are the knowledge service's own search-time gates that need no caller, asked through the same spec predicates. The disabled-package gate and the field-queryable gate need an environment or a caller and stay at save, judged for the author. `os explain` answers each of the five ids.

## FROM → TO

- `source: { object: 'kb_artcle', … }` → `source: { object: 'kb_article', … }`, an object the stack defines. An object a dependency defines clears at publish once the package's manifest declares that dependency in `dependencies`; on the CLI it stays a warning while the artifact does not carry the dependency.
- `content: ['title', 'bdy']` → `content: ['title', 'body']`.
- a source over an object with `enable: { apiEnabled: false }` → serve the object (`apiEnabled: true` and, where it declares `apiMethods`, a list that includes `list`, with `searchable` not false), or index another object.
- a source over `sys_audit_note` → index a business object, or declare `enable.aiReadable: true` on the system object's own definition.

`@objectstack/spec` adds only the upgrade-guide entry `knowledge-source-publish-refuses-missing-references-and-gated-objects`.
