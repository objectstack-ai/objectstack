---
'@objectstack/skills': patch
---

docs(skills): objectstack-data teaches an object extension's `fieldPatches` — relabel a vendor field without redeclaring it in `fields`

Clause-②: no
Metadata-protocol: none

- **Before.** `ObjectExtensionSchema.fieldPatches` is applied by the registry merge and refused at install and by `os validate` when it names nothing, but the published `objectstack-data` skill's *Object Extension Model* taught only `fields` / `priority`, so an agent that wanted a vendor field to read "Sector" instead of "Industry" redeclared the field in `fields` and took it over.
- **Now.** The section carries one paragraph on `fieldPatches`: display keys only (`BASE_FIELD_DISPLAY_WHITELIST` — `label`, `description`, `inlineHelpText`, `placeholder`, and an option's `label` keyed by its stored `value`), type / values / rules stay the owner's, a tenant's edit wins, the higher `priority` wins between extensions, a patch naming a missing field or option is refused at install and by `os validate`, a `picklist`-bound field's options are not patchable — with the `crm_account.industry` example.
- The file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (the search section's second refusal paragraph, folded into its first; the index blockquote and the validation type list, each already carried by `rules/indexing.md` / `rules/validation.md`). No ceiling moves, no frontmatter, schema, key or behaviour changes.
