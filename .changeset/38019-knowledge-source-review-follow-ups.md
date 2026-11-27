---
'@objectstack/lint': minor
'@objectstack/service-knowledge': patch
'@objectstack/spec': patch
---

fix(lint)!: a knowledge source naming an absent platform object is refused at publish; `ai_context` accepts `id`; the save door's search refusal names `list`

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37310

<!-- adr-0087: registered knowledge-source-publish-refuses-missing-references-and-gated-objects -->

ADR-0161 K4, row 4.

**BREAKING** for the publish of a knowledge source whose `source.object` is a platform name the host does not serve: when the publish gate judges the source against the whole collection the host serves (a write that names no package), a platform-prefixed name no package registers there, and a known platform object (`sys_user`) the host does not serve, are now `knowledge-source-object-unknown` errors (422), as an unprefixed name already was. Before, the first was a warning and the second was not judged. FROM a source over such an object TO a source over an object the host serves: name the object by its full name, or install the package that registers it. On the command line nothing changes: a platform-prefixed name no known package registers stays a warning, and a known platform object the stack does not carry is not judged.

- `ai_context`: a field named `id` (in `fields`, a related list's `fields`, `where` or `orderBy`) is no longer reported as `ai-context-field-unknown`. The driver provisions it, so it exists on every object; existence is now asked through the same column set the other existence rules use. A `body.field` of `id` is reported as not long text, never as unknown.
- `@objectstack/service-knowledge`: the save refusal for an object the API does not serve for search names the cause and fix in the words of `knowledge-source-object-not-searchable`: `enable.apiEnabled` false, an `enable.apiMethods` list that does not grant `list` (from which search derives), or `list` beside `enable.searchable: false`; the fix is to include `list` with `enable.searchable` not false. It no longer tells the author to grant `search`, a retired list value the parse strips.
- `@objectstack/spec`: the upgrade entry `knowledge-source-publish-refuses-missing-references-and-gated-objects` is listed by `os migrate meta` only for a stack that declares `knowledgeSources` (`--all` still lists it), and its surface states that the platform-name warning is the CLI's.
