---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

fix(lint)!: a knowledge source is checked for its object, its fields and the search gates that need no caller, in `os validate` and at publish

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-ai/SKILL.md

<!-- adr-0087: registered knowledge-source-publish-refuses-missing-references-and-gated-objects -->

ADR-0161 K4, row 4.

**BREAKING** for the publish of a knowledge source that carries one of the four errors below: it was accepted before and is refused now (422, the finding's rule id, path, message and fix), and `os validate` / `lint` / `compile` / `build` refuse the same source. The schema is unchanged, and stored sources are not rewritten or refused at boot.

A new rule, `validateKnowledgeSource`, exported from `@objectstack/lint` with its five rule id constants. It runs on all three CLI commands and on the runtime publish gate for a `knowledge_source` write, with one set of rule ids and messages. Four errors, because a source that carries one indexes nothing:

- `knowledge-source-object-unknown`: `source.object` names an object that the stack, a package of its artifact, or (at the publish gate) the host does not define. Under the package closure the publish gate states, an object outside it is worded for the closure with the remedy to declare the dependency. A platform object a known package registers is not judged when the stack does not carry it; a platform-prefixed name no known package registers is a warning.
- `knowledge-source-field-unknown`: a `source.content` or `source.metadataFields` member names no field of the object, declared (the stack's own object extensions included) or injected by the platform (`owner_id`, `created_at`, …).
- `knowledge-source-object-not-searchable`: the object's API exposure does not serve `search` (`canServeApiOperation(enable, 'search')`): `enable.apiEnabled: false`, an `enable.apiMethods` list that grants neither `search` nor `list`, or `enable.searchable: false`.
- `knowledge-source-system-object-not-ai-readable`: a `sys_` object that does not declare `enable.aiReadable: true` (`isAiReadExposed`).

One warning, which refuses nothing:

- `knowledge-source-field-never-indexed`: a member names a credential-class field or a field declared `internal: true`; the index never carries either, even when named, so the member is skipped.

The two gates are the knowledge service's own search-time gates that need no caller, asked through the same spec predicates. The disabled-package gate and the field-queryable gate need an environment or a caller and stay at save, judged for the author. `os explain` answers each of the five ids.

## FROM → TO

- `source: { object: 'kb_artcle', … }` → `source: { object: 'kb_article', … }`, an object the stack or a declared dependency defines.
- `content: ['title', 'bdy']` → `content: ['title', 'body']`.
- a source over an object with `enable: { apiEnabled: false }` → serve the object (`apiEnabled: true`, and an `apiMethods` list that grants `list` or `search`), or index another object.
- a source over `sys_audit_note` → index a business object, or declare `enable.aiReadable: true` on the system object's own definition.

`@objectstack/spec` adds only the upgrade-guide entry `knowledge-source-publish-refuses-missing-references-and-gated-objects`.
