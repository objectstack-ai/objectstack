---
'@objectstack/lint': minor
---

feat(lint)!: `objectstack validate`, `compile` and the publish gate refuse a form open to anonymous intake that declares a file field (#25650)

Clause-②: no (narrowing: a form view open to anonymous intake whose sections declare a field of a `FILE_REFERENCE_TYPES` type is refused at `objectstack validate`, `compile` and the publish gate)
Metadata-protocol: narrowed
Ruling-ref: ruling C on #25572 (the maintainer, 「25619 C 25495 B」, recorded on PR #25619 with the seat record `6383110676`); triage `6385114404`

A public form takes no attachment. A form view is open to anonymous intake when its `sharing` declares `enabled: true`, `allowAnonymous: true` and a `publicLink` (`anonymousFormIntakeCandidates`, `@objectstack/spec/ui`, the rule both anonymous doors serve from). Such a form collects the fields its sections declare. A visitor has no route to upload a file, so a declared `file`, `image`, `avatar`, `video` or `audio` field can never be filled. The new authoring rule `validatePublicFormFileFields` (rule id `public-form-file-field`, exported as `PUBLIC_FORM_FILE_FIELD`) refuses it, naming the field and the object.

**BREAKING — what moves for authors.**

- FROM: a public form whose `sections[].fields` (or legacy `groups[].fields`) name a file-typed field of the bound object published clean. TO: an error. `objectstack validate`, `compile` and `lint` fail with `public-form-file-field` at the field's entry (`views[0].formViews.apply.sections[1].fields[2]`), and an active `view` write answers `422 INVALID_METADATA` with that issue. The item is not stored. This covers `saveMetaItem` in publish mode (Studio, REST `/meta`, MCP) and the promotion of a draft (`publishMetaItem`). All three form shapes are judged: a view's default `form`, each `formViews` entry, and the flattened `config` of a `viewKind: 'form'` item. A bare field name and a `{ field }` entry are both read.

**Fix (one line).** Take the file field off the public form. To collect a file from someone outside the organization, have them register and sign in, then fill a form that is not open to anonymous intake and declares the field. There is no guest upload.

**Unchanged.**

- The parse. No schema shape moves, and nothing is added to `@objectstack/spec`. A stored view carrying such a form keeps loading and serving until it is next saved, and that save is judged. Saving as a draft is still allowed; publishing the draft is judged.
- A form that is not open to anonymous intake (either switch off, or no `publicLink`) is not judged, whatever fields it declares.
- An `object` write is not judged by this rule: its snapshot carries no views. Changing a field's type to a file type under a published public form is caught by `objectstack validate` and `compile`, and by that view's next publish.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: 0 producers declare such a form. `examples/app-crm` (through the built `@objectstack/lint`: 0 findings, 1 for a planted file field on its public form), `app-todo` and `app-multi-package` (0 public forms); `app-showcase`'s one public form, read in source (`inquiry.view.ts`, fields `name`, `email`, `company`, `message`: text and email); `@objectstack/platform-objects` (0 public forms); HotCRM at `a4b3560`, whose two public forms (`src/sales/views/lead.view.ts`, `src/service/views/case.view.ts`) declare text, email, url, select, currency, number and markdown fields only.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `objectstack validate`, `compile` and the publish gate of a form open to anonymous intake that declares a file-typed field: no authorable key, spelling or stored shape moves, the parse is unchanged, and no stored row is read, rewritten or converted. A stored view carrying such a form keeps loading until it is next saved, and the repair is the author's choice of where the file is collected (off the public form, onto a signed-in form), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
