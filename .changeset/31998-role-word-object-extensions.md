---
'@objectstack/lint': minor
---

fix(lint)!: `security-role-word` judges what an `objectExtensions` entry writes onto an object (its fields, its `label`, its `fieldPatches` relabels), in `os validate` / `os build` / `os verify` and at the `object_extension` publish door (#31998)

Clause-②: no
Metadata-protocol: narrowed
Skills-docs: none — no page under `skills/**` teaches a field or label using the reserved word on an object extension (grep `security-role-word` / `reserved word`: zero hits in `skills/`); `content/docs/deployment/validating-metadata.mdx` gains the `object_extension` write type on the vocabulary-freeze row and one paragraph saying what an extension is judged on.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: ObjectExtensionSchema keeps its shape and meaning, and the build and the object_extension publish door now give an extension's field names and labels the verdict the same words already get on the object's own declarations (ADR-0090 D3). There is no rewrite that keeps what the author meant, because the refused word is the author's chosen vocabulary; the author renames the field or relabels it, and the refusal says with what. -->

**BREAKING** accept-set narrowing in `os validate` / `os build` / `os verify` and at the `object_extension` publish door (`PUT /api/v1/meta/object_extension/TARGET` and its publish, a package draft publish; Studio's add-field on a customization package, REST and MCP authors).

- **Before.** `objectExtensions: [{ extend: 'sd_agent', fields: { role: { type: 'select', … } } }]` passed every command and every door, and the app booted with `sd_agent.role`, while the same field in the object's own `fields` was refused `security-role-word` (ADR-0090 D3). The same held for a field labelled with the word, for an extension `label` such as `Agent Roles`, and for a `fieldPatches` relabel such as `{ industry: { label: 'Role In Market' } }`. The `object_extension` publish door ran no lint rule at all.
- **Now.** Each is refused `security-role-word` (error) with the message the object's own declaration gets, located at the entry the author wrote: `objectExtensions[0].fields.role.name`, `….fields.F.label`, `objectExtensions[0].label`, `objectExtensions[0].fieldPatches.F.label` (in an artifact, `packages[j].manifest.objectExtensions[i]…`). At the publish door the refusal is `422 INVALID_METADATA` with the rule id in `issues`.
- **System objects.** A field an extension adds to a `sys_*` object is judged: the exemption covers the platform's own declarations (better-auth `sys_member.role`), not words an app adds.
- **Not judged.** Option labels under `fieldPatches.F.options` and `pluralLabel`, which the object's own declarations are not judged on either; an entry a later entry of the same package replaces for the same target, whose fields are never served.

**What an author does.** Rename the field (`role` → `group_function`, `duty`) or relabel it with `Position` or a domain word, as the refusal's hint says. A stored `object_extension` row carrying the word keeps being read; its next publish is refused until renamed.
