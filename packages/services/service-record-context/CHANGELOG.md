# @objectstack/service-record-context

## 19.0.0-next.3

### Patch Changes

- Updated dependencies [22e1089]
- Updated dependencies [e606bab]
- Updated dependencies [d578952]
- Updated dependencies [c06dac7]
- Updated dependencies [58b513a]
- Updated dependencies [1f1cd21]
- Updated dependencies [10321fa]
- Updated dependencies [fe0473d]
- Updated dependencies [3550665]
- Updated dependencies [33a0d4f]
- Updated dependencies [ee2ffca]
- Updated dependencies [98099ea]
- Updated dependencies [3ffa92d]
- Updated dependencies [9609c13]
- Updated dependencies [da08375]
- Updated dependencies [86ce7a3]
- Updated dependencies [f9c6f92]
- Updated dependencies [d59478f]
- Updated dependencies [a7f7f3f]
- Updated dependencies [03f39cc]
- Updated dependencies [898b056]
- Updated dependencies [216524a]
- Updated dependencies [d994002]
- Updated dependencies [ba2d960]
- Updated dependencies [fd06b7a]
  - @objectstack/spec@19.0.0-next.3
  - @objectstack/types@19.0.0-next.3
  - @objectstack/core@19.0.0-next.3

## 19.0.0-next.2

### Patch Changes

- Updated dependencies [34f7078]
- Updated dependencies [0b539b6]
- Updated dependencies [ab04434]
- Updated dependencies [abf1eeb]
- Updated dependencies [c23e556]
- Updated dependencies [b4c99b8]
- Updated dependencies [27ee984]
- Updated dependencies [dbe0716]
- Updated dependencies [3c53b85]
- Updated dependencies [0b87f12]
- Updated dependencies [b316afa]
- Updated dependencies [8b47659]
- Updated dependencies [a145e24]
- Updated dependencies [6e2a8f2]
  - @objectstack/spec@19.0.0-next.2
  - @objectstack/core@19.0.0-next.2
  - @objectstack/types@19.0.0-next.2

## 19.0.0-next.1

### Patch Changes

- 3806b2e: fix(record-context): a related object's read that fails is answered as a failure, not as "no access"
  
  Clause-②: no
  Metadata-protocol: none
  
  `get_record_context` reads each related object of a pack before it answers: the object's API exposure, its definition as the caller is served it, its published definition, and the related list itself. When one of the first three reads failed for a reason that is not a refusal (the database or the metadata store down, a bug), the call was refused `PERMISSION_DENIED` (403), as if the caller could not read the object. Such a failure now fails the call `INTERNAL_ERROR` (500), and the thrown error carries the original on `cause`. At the related-list read, the raw error left the executor and the MCP doors classified it. That is still so for every throw the `/data` door answers with a code or sentence of its own. `INTERNAL_ERROR` (500) applies there to an uncoded failure only, one the doors answered `INTERNAL_ERROR` (500) before, which now fails the call the same way and carries the original on `cause`.
  
  What an MCP caller sees for an uncoded failure, on either door: `{ code: 'INTERNAL_ERROR', status: 500 }` with the message `Internal server error`. The doors withhold a 5xx's own sentence, so the executor's sentence (which names the pack and the root record's object only) is read in-process only, for example by the host of `verifyRecordCitations`. Nothing names the related object, a field, a package or what the failed read said. Each door logs the failure at `error` on every call, with the thrown error and its `cause`.
  
  A refusal at the same reads is answered as before. At the first three reads a coded refusal (a string `code` with a declared 4xx status, a disabled package's included) refuses `PERMISSION_DENIED` (403). At the related-list read, a throw the `/data` door answers itself is left to the door as before, with its own code and sentence. A refusal: a sandboxed `beforeFind` hook's plain throw still answers `400 HOOK_ABORTED`, and a `PERMISSION_DENIED` with no status still answers 403. A coded fault: an unavailable datasource still answers `ERR_DATASOURCE_UNAVAILABLE` (503) with its sentence, a driver error the door recognises `DATABASE_ERROR` (500), a driver's declared `NOT_IMPLEMENTED` (501) and a declared 5xx their own code, with the sentence the producer declared for the caller.
  
  `verifyRecordCitations` therefore reports such a failure through `onError` (its citations are still dropped), where at the first three reads it used to drop them without a report. A host that retries or logs on `onError` now sees outages behind a pack with related lists.
  
  The package gains one dependency, `@objectstack/types` (already a dependency of `@objectstack/core`), for the `/data` door's classifier the related-list read asks.
- e86bf99: fix(service-record-context): `get_record_context` states nothing for a `related` object the stack does not define
  
  Clause-②: no
  Metadata-protocol: none
  
  A context pack whose `related` entry names an object no package and no environment defines (a misspelt name, or a package removed after the pack was written) is an author defect: `os validate` reports it (`ai-context-object-unknown`), and ADR-0160 D1 says the tool answer says nothing about it. Until now the section was left out and every caller was told "Some of the material this pack covers is not visible to you", which reads as a permission narrowing nobody configured.
  
  The section is still left out. The not-visible statement now fires only when the stack publishes the object and this caller is not served it, as it did before for a defined child. The judgement reads the published definition, which is the same for every caller, so the answer for one caller reveals nothing about another caller's access: two callers get the same bytes for a pack with an undefined `related` object, on the `/mcp` door and the stdio door alike. Nothing of the published definition is carried in the answer.
- 6b7b305: fix: the 5xx fault log and `ObjectLogger` print an error's `cause` chain
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  A server fault thrown with the original error on `cause` used to log the wrapper's message and stack only, so the root cause was missing from the operator's line. `logServerFault` (`@objectstack/types`) now prints the chain as `causes` beside `stack` on its console fallback, and `ObjectLogger` (`@objectstack/core`) prints it as `error.causes` for every `logger.error` / `logger.fatal` that passes an error. Each link carries its message and stack; a cycle stops at the first repeat and a chain stops after five links, each saying so in a last link. Nothing reaches a response body.
  
  `@objectstack/service-record-context` drops the `Caused by:` suffix it appended to a failed read's stack, since the fault line now renders the `cause` itself.
- Updated dependencies [0296d97]
- Updated dependencies [bb76b8c]
- Updated dependencies [d9bc148]
- Updated dependencies [c42a045]
- Updated dependencies [58570d8]
- Updated dependencies [81c68b3]
- Updated dependencies [eb683b8]
- Updated dependencies [561fe12]
- Updated dependencies [f722411]
- Updated dependencies [c3a4a30]
- Updated dependencies [b1c41e5]
- Updated dependencies [ea1b70a]
- Updated dependencies [dedc16c]
- Updated dependencies [adb65d1]
- Updated dependencies [adb65d1]
- Updated dependencies [87af66e]
- Updated dependencies [ddd5941]
- Updated dependencies [d58bf7a]
- Updated dependencies [bebc2cf]
- Updated dependencies [c3da753]
- Updated dependencies [9a65a48]
- Updated dependencies [9b99640]
- Updated dependencies [712df42]
- Updated dependencies [579b857]
- Updated dependencies [50b4bf8]
- Updated dependencies [6b7b305]
- Updated dependencies [91875c7]
- Updated dependencies [520cf3f]
- Updated dependencies [1bc265f]
- Updated dependencies [39fafc0]
- Updated dependencies [b1490f2]
- Updated dependencies [44ccf94]
- Updated dependencies [1dbf19a]
- Updated dependencies [14badad]
- Updated dependencies [f4d6bc5]
- Updated dependencies [3e87d7b]
- Updated dependencies [8071f35]
- Updated dependencies [f07d63a]
- Updated dependencies [709a087]
- Updated dependencies [54dc93a]
- Updated dependencies [56c9cae]
- Updated dependencies [c826e8a]
- Updated dependencies [8fbae19]
- Updated dependencies [b620c4b]
- Updated dependencies [babd660]
  - @objectstack/spec@19.0.0-next.1
  - @objectstack/core@19.0.0-next.1
  - @objectstack/types@19.0.0-next.1

## 19.0.0-next.0

### Minor Changes

- 2a6f26a: feat(ai): `ai_context` context packs and the `get_record_context` tool over MCP
  
  Clause-②: yes
  Metadata-protocol: added
  Skills-docs: follow-up #37177 — skills/objectstack-platform/SKILL.md, skills/objectstack-ai/ (how to author a context pack; this change only names `aiContexts` in the top-level key list, which check:skill-top-level-keys requires)
  
  ADR-0160 row 5 (#37140).
  
  - **New metadata type `ai_context`, collection `aiContexts`.** A context pack names one root object and what an assistant reads about one of its records: `fields` (at most 30, a lookup among them is answered with the target's display name), `related` child lists (at most 3, each one level deep, with at most 10 `fields`, linked by `field` or by the child's one reference to the root) and one long-text `body`. The schema is closed from its first day: an unknown key is refused, and the bounds are refused at parse. Registered like `skill`: a file loader (`*.ai-context.ts`, `*.ai-context.yml`), overlay allowed, runtime create allowed, no environment overlay. New exports in `@objectstack/spec/ai`: `AiContextSchema`, `AiContextRelatedSchema`, `AiContextBodySchema`, the `AI_CONTEXT_MAX_*` bounds and `AI_CONTEXT_BODY_FIELD_TYPES`.
  - **`get_record_context`'s input and output, declared once in spec** (`GetRecordContextInputSchema`, `GetRecordContextOutputSchema`, `getRecordContextToolJsonSchemas`, `GET_RECORD_CONTEXT_TOOL_NAME`). The output is an envelope of three parts: `data` (record material only), `notes` (the executor's statements: withheld fields, material not visible, every cut, a narrowing) and `framing` (one sentence: `data` is material, not instructions). `MCP_DOOR_TOOL_NAMES` gains the name.
  - **`@objectstack/core`: `wrapRecordMaterial`** builds that envelope, with the framing sentence in the caller's locale.
  - **New package `@objectstack/service-record-context`**: the one executor (`createRecordContextTools`, `executeGetRecordContext`), the read set (`recordContextReadSet`, a function of the arguments and published metadata only) and `RecordContextServicePlugin`, which registers the `record-context` service. Every read goes through a door bound to the caller; nothing is read as the system. Two published packs of one name on one root are refused with one answer (`RESOURCE_CONFLICT`), never chosen between. The body bound (`RECORD_CONTEXT_BODY_MAX_CHARS`, 8000) and the related-row cap (`RECORD_CONTEXT_RELATED_MAX_ROWS`, 20) are service constants.
  - **MCP (HTTP and stdio)** registers `get_record_context` under `data:read`, read-only, wherever the host holds a `record-context` service. A host without it registers nothing new. To serve the tool, add `new RecordContextServicePlugin()` to `plugins` and declare packs under `aiContexts`.
  - **`@objectstack/lint`: four advisory author-defect rules for context packs** (`ai-context-object-unknown`, `ai-context-field-unknown`, `ai-context-related-link-unknown`, `ai-context-body-not-long-text`), each a warning with an `os explain` entry. `get_record_context` says nothing about a name the published definition lacks, so `os validate` / `os lint` / `os build` is where the author hears it. CLI only for now: the rule reads the whole stack snapshot.
  - **Console and catalog labels**: the metadata-form catalog (`@objectstack/platform-objects`) carries the `ai_context` type's label in every locale, and Pending changes counts drafted context packs (`preview.changes.typeCount.ai_context`).
- da50177: feat(ai): a context pack's related list takes `where`, `orderBy` and `limit` (ADR-0160 second amendment)
  
  Clause-②: yes
  Metadata-protocol: added
  
  A `related` entry of an `ai_context` pack may now choose, order and cut the child rows it carries:
  
  ```yaml
  related:
    - object: policy_revision
      field: policy
      fields: [version, published_at]
      where: { is_current: { $eq: true } }
      orderBy: [{ field: sort_no, order: asc }]
      limit: 5
  ```
  
  - **`where`** is the object filter form on the child's own fields: `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$null` and `$exists` (`AI_CONTEXT_WHERE_OPERATORS`), joined by `$and` / `$or` nested at most `AI_CONTEXT_WHERE_MAX_DEPTH` (32) deep. A bare value reads as `$eq`. Refused at parse: any other operator (`$not`, `$between`, `$contains`, …), a dotted path or a condition on a lookup's target, a field-to-field comparand (`{ $field }`), a `$now` anchor, a formula, and a comparand that is one whole `{…}` placeholder (`{today}`, `{current_user_id}`, `${record_id}`, or an unknown one), and `$and` / `$or` nested deeper than the bound.
  - **`orderBy`** is `{ field, order }[]` (the sort node; `direction` is refused by name) on the child's own fields.
  - **`limit`** is a positive integer, at most `AI_CONTEXT_MAX_RELATED_ROWS` (20). Over it the pack is refused at parse, never lowered at call time. `RECORD_CONTEXT_RELATED_MAX_ROWS` in `@objectstack/service-record-context` is now this one number.
  
  `get_record_context` reads such a list in the one capped child query, as the caller: the link filter and `where` joined with `$and`, ordered by `orderBy`, cut at `limit` (else the row cap), and a cut is stated in the notes. The filter grants nothing: a row the caller's row rules hide stays absent. A `where` or `orderBy` field the caller cannot query on (outside the security service's `getQueryableFields`; without that answer, any field that declares a `maskingRule`, or that the caller's schema hides or field-level security withholds) drops the whole section with the one "some material is not visible" statement, and the field is never named. A field the child does not define leaves the section out and states nothing; `os validate` and the save-time check report it as `ai-context-field-unknown`. So does an `orderBy` field the child does not offer as a sort (a formula, or a field that declares `sortable: false`, which the record doors refuse with `INVALID_SORT`): the section is left out and nothing is stated, and `os validate` and the save-time check report it as the new warning `ai-context-sort-field-unsortable`. The call's read set does not change. A door may hand the executor the caller's queryable fields through the new optional `RecordContextDoor.queryableFieldsOf`.
- 7e9c50c: feat(objectql,service-record-context)!: a context pack (`ai_context`) is identified by its package and its name; `get_record_context` reaches each package's pack by its face
  
  Clause-②: yes (narrowing)
  Metadata-protocol: narrowed
  Skills-docs: follow-up #37177
  
  <!-- adr-0087: registered ai-context-package-scoped-name -->
  
  ADR-0150's addendum of 2026-11-25 puts the context pack in bucket 3 beside `skill`. Two packages may each ship a pack of one name, and each reader reaches the one it means.
  
  - **The four lists.** `ai_context` joins `PACKAGE_SCOPED_TYPES` (`@objectstack/core`: the one ADR-0150 D3 rule resolves a bare pack name), `PACKAGE_SCOPED_READ_TYPES` (`@objectstack/objectql`: the `/meta/ai_context/NAME` read and its `?package=` qualifier), `PACKAGE_SLOTTED_METADATA_TYPES` (`@objectstack/spec/api`: the metadata service keeps one copy per `(package, name)`, and uninstalling one package drops its pack and keeps another package's pack of the name) and `NAMESPACE_UNIQUE_TYPES` (`@objectstack/objectql`: D2's refusal of a second holder inside one namespace).
  - **`get_record_context` picks a pack by package and name.** The candidates are still the packs rooted on `objectName`. `context` is read the way a skill prompt's name is read. A face (`NS-NAME` for a package's pack, `deriveAiFaceName`) answers its one pack. A bare name resolves as for a caller with no package: the environment's own pack, else the one package that holds the name, else `409 RESOURCE_CONFLICT` naming each candidate by its face. With `context` omitted on an object with several packs, the answer (`400 VALIDATION_ERROR`) lists each pack by its face with its label, in English and in Simplified Chinese; a pack without a label would be listed by its face alone. The tool's description tells the model to name a package's pack as `NAMESPACE-NAME`.
  - **New door member.** `RecordContextDoor.packageNamespace(packageId)` (optional) gives a package's manifest namespace. A door without it spells every pack by its bare name, as an environment pack is spelt. Both MCP doors implement it from the `objectql` registry's package record (`@objectstack/runtime`'s `/mcp` route and `@objectstack/mcp`'s stdio bridge), so on either transport two packages' packs of one name are each reached by their face.
  - **New exports** (`@objectstack/service-record-context`): `contextPackCandidates`, and the types `ContextPackCandidate`, `ContextPackCandidateName`, `PackageNamespaceOf`. `selectContextPack` now takes the candidates `contextPackCandidates` returns, not the parsed packs. Its `several` outcome carries `packs` (each `{ face, label }`) in place of `names`, and its `duplicate` outcome carries `candidates`. `recordContextReadSet` returns the selected pack's face as `pack`. For an environment pack, and on a door without `packageNamespace`, the face is the pack's name, so these answers are unchanged there.
  
  **BREAKING (narrowing), each counted on `objectstack-ai/objectstack` at `d7f299c0` and `objectstack-ai/hotcrm` at `9b735103`:**
  
  - A second package of one namespace that ships a pack name another package of that namespace already holds is refused at install (`422 NAMESPACE_CONFLICT`, naming every holder) and by `os validate`. First-party packages refused: 0. The one declarer, `examples/app-showcase`, ships two packs with different names in one package. hotcrm declares none.
  - `GET /api/v1/meta/ai_context/NAME` with no package, for a name two packages hold, answers `409 RESOURCE_CONFLICT` naming both. Before, it served the first match. Read each pack with `?package=ID`. First-party reads refused: 0.
  - A package-less pack row under a name a package ships is that package's customization and is not served. The rule is read by type and name, whatever object the row is rooted on. This was already true and this change does not alter it. What changes is which item such a row is compared against: the one holder's. First-party rows affected: 0.
  
  Fix for an upgrading author: give a pack a name no other package of the same namespace uses, and read a shared name by its package. A model names the pack it means by its face, as the refusals list it.
- db46566: feat(ai): the record citation shape enters spec, with the verifier that checks a citation's quote as the asking user (ADR-0160 D9)
  
  Clause-②: yes
  Metadata-protocol: added
  Skills-docs: follow-up #37177
  
  An AI answer about a record may carry citations: the passage of the record it rests on.
  
  - **`@objectstack/spec/ai`**: `RecordCitationSchema` is `{ object, id, context?, anchor?, quote }`, closed (an unknown key is refused), with `quote` required and non-empty. `RecordCitationsSchema` is a list of at most `RECORD_CITATIONS_MAX` (20). `RECORD_CITATIONS_PART_TYPE` (`data-record-citations`) names the UI-message data part a verified list rides. `headingsOf` and `stripBodyTags` (`record-body-anchor.ts`) derive a body's headings and anchors, so the server and a surface that opens a record at a cited anchor derive the same anchor.
  - **`@objectstack/service-record-context`**: `verifyRecordCitations(citations, door)` returns the citations that survive. For each distinct `(object, id, context, anchor)` it calls `get_record_context` once, through the door bound to the asking user, and keeps a citation only when its `quote` is found in that answer's data member: a field or related-list cell `value` (when it is a string) or `display`, or the body `text` (an `html`/`richtext` body also with its tags removed). Whitespace runs collapse; case and every other character must agree. Notes, the framing sentence and labels are never matched. A refused call (a pack that does not exist, several packs and no `context`, an anchor that does not resolve, a record the caller cannot read) drops its citations. It never throws for a citation, and it reads at most the first 20 entries.
  
  Nothing produces or draws citations yet: the producer persists the verified list with the message, and surfaces draw it without re-verifying.

### Patch Changes

- 6831e04: feat(ai): `get_record_context` caps a body outline's entries and states the cut
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  A long body comes back as an outline of its headings. That outline had no cap, so a long body that is mostly headings made an outline answer as big as the body. The outline is now bounded whatever the body holds.
  
  - **`RECORD_CONTEXT_OUTLINE_MAX_ENTRIES` (80), new export of `@objectstack/service-record-context`.** An outline lists at most 80 headings, and its listing, serialized, stays within `RECORD_CONTEXT_BODY_MAX_CHARS` (8000). When a body has more, the outline keeps the shallowest levels first and lists them in body order, so a listed section's text holds the headings left out under it. Every heading's `anchor` still reads its section, listed or not, and a listed anchor is the same whether or not the outline was cut.
  - **New note kind `outline_truncated`** on `RecordContextNoteKind` in `@objectstack/spec/ai`. When the cap cuts, the answer carries one such note beside `body_outline`, and its sentence says how many headings are not listed. A consumer that switches over note kinds exhaustively must handle the new value.
  - A body whose only heading is too long to list within the bound is carried as text up to the bound and marked `truncated`, the same as a long body with no headings.
- 59571b2: feat(service-record-context): get_record_context lists a long body's outline in pages, so every heading's anchor is issued however many the body holds
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  ADR-0160 D3 "The body". No pack key and no error code changes. The tool's published input widens by one optional member, `outlineFrom`, and its body answer by one, `outlineNext`.
  
  - **The outline comes in pages.** An outline is still held to 80 entries and to the body bound per answer. Where a body has more headings than one answer lists, the answer's body carries `outlineNext`, and calling `get_record_context` again with the same arguments and `outlineFrom` set to it lists the next page. The pages run through every heading shallowest level first, then in body order, and each page lists its headings in body order: a nested body's first page is its top levels, as before; a body of many headings at one level is listed in runs. Before, a body whose headings all sat at one level issued no anchor for any heading past the first 80, so those sections could not be read.
  - **The `outline_truncated` note now says how many headings the page lists, how many it does not, and the `outlineFrom` that lists the next page** (or that no later page lists more). It no longer says that a listed section's text holds the headings left out, which was false when every heading sat at one level.
  - **A heading too long to list by itself no longer empties the outline.** No page lists it, the pages pass over it, and the note counts it; the other headings are listed. A body whose only headings are such headings is carried to the bound and marked truncated, as before.
  - An `outlineFrom` past the last page, or on a body that is not an outline, is refused `RESOURCE_NOT_FOUND` (404), as an unresolved `anchor` is. A call naming both `anchor` and `outlineFrom` is refused `VALIDATION_ERROR` (400) before anything is read.
- f131c83: fix(mcp,runtime): `get_record_context` reads a package's context packs on both MCP doors
  
  Clause-②: no
  Metadata-protocol: none
  
  A deployment serving context packs (`aiContexts`) answered every `get_record_context` call with `RESOURCE_NOT_FOUND` ("No context pack named … reads object …"), on the HTTP `/mcp` route and on stdio alike. Both doors read the packs from the protocol's served `ai_context` listing, which carries the read path's `_diagnostics` on every item; the record-context executor parses each pack with the closed `AiContextSchema`, so it dropped every one as an unrecognized key.
  
  Both doors now hand the executor the authored packs: the listing passes through `stripReadDecorations` (`@objectstack/spec/kernel`), which removes exactly the read decorations (`METADATA_READ_DECORATIONS`) and keeps the ADR-0010 protection envelope (`_packageId`, `_provenance`, `_lock`, …) the schema declares. The executor's parse is unchanged. Nothing to do on upgrade.
  
  For anyone implementing a `RecordContextDoor`: `listContextPacks` hands over the authored packs with the read decorations removed (`stripReadDecorations`), or the executor drops them.
- 8d60333: fix(service-record-context): get_record_context leaves out a related child the caller is not served, and both MCP doors hand over the caller's queryable fields and their page cap
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  ADR-0160 D3 "Object level", as amended, and its second amendment. No pack, key or code changes. The published surface widens by optional members only: `RecordContextDoor.pageCap?()`, and `StdioDataBridgeDeps.security` may carry `getQueryableFields`; `@objectstack/types` adds `resolveQueryReadPageCap`.
  
  - **A related child this caller is not served is left out, not refused.** The answer carries the root and every served section, with the one `not_visible` note, and names the child nowhere; nothing of the child is read after its object-level judgement, its published definition included. A child is still refused whole, as before, when a gate refuses it for everyone: the read guard, or API exposure — which is now asked before the served definition, so a child whose package is disabled (`OBJECT_PACKAGE_DISABLED`, which also serves its object to nobody) keeps its `PERMISSION_DENIED` refusal. A served-definition read that fails refuses the call, unnamed, and is never read as a narrowing.
  - **Both doors supply `queryableFieldsOf`.** The `/mcp` door and the stdio door now hand the executor the security service's `getQueryableFields` answer for the caller they resolved, so a related list's `where` or `orderBy` is judged on that answer before the read. A field outside it drops the section with the note, and is never refused by the engine's guard; a masked field this caller is served whole (its unmask capability held) is now filtered and sorted on, where the fallback dropped the section.
  - **A door's page cap is a stated cut.** A door may report its page cap (`pageCap`, optional); the executor then asks a related list for at most that many rows, cuts the list one row under it, and states the cut. Both doors report the deployment's smaller read limit (`OS_DATA_MAX_PAGE_SIZE`, `OS_DATA_QUERY_ROW_BUDGET`). Before, under a maximum page size below a list's cut plus its probe row, the `/mcp` door refused the whole call `MAX_RECORDS_EXCEEDED` and the stdio door read the full list.
  - The `related_truncated` note kind's doc line, and the `rows` and `truncated` descriptions of a related list in the tool's output schema, now say a list is cut at its entry's `limit`, at the row cap, or below either at the door's page cap.
  - `@objectstack/types` exports `resolveQueryReadPageCap()`: the smaller of `OS_DATA_MAX_PAGE_SIZE` and `OS_DATA_QUERY_ROW_BUDGET`, `undefined` when neither is set. Both doors answer `pageCap` from this one function, so they cut at the same row.
- 2776e88: feat(record-context): the citation verifier tells a refusal from a failure and reports failures to the host
  
  Clause-②: yes (widening) — new optional third argument of the exported verifyRecordCitations and two new exported types; existing calls unchanged
  Metadata-protocol: none
  
  ADR-0160 D9 verifies an answer's citations once, so a citation lost to an outage is lost for good. `verifyRecordCitations` used to drop a citation the same way whether the verifying call was refused or failed.
  
  - **A refusal** is a throw carrying an ADR-0112 `code` with a declared 4xx status (read as ADR-0112's reader reads it: `.status`, then `.statusCode`), the only shape `get_record_context` refuses with. Its citations are dropped and nothing is reported, as before.
  - **Any other throw** (no code, a driver code with no status, a 5xx) is a failure. Its citations are still dropped, so the result stays fail-closed, and the failure goes to the new optional `onError(error, call)` option, once per verifying call, so the host can log or retry. A failed read of the served definition behind an HTML body is reported too; there only the tag-removed reading is lost. A callback that throws, or returns a promise that rejects, is ignored.
  - A refused read and a missing record still give the host the same answer: dropped, not reported.
  - New exported types `VerifyRecordCitationsOptions` and `VerifyingCall`. Existing two-argument calls are unchanged.
  - Docs: the verifier says which list cap a producer gets (the first 20 read, where `RecordCitationsSchema` refuses 21) and that the tag-removed reading of an HTML body joins adjacent text, so it is not only stricter than matching as stored. `stripBodyTags` says it is not a sanitizer.
- 7d50dc8: Clause-②: no
  Metadata-protocol: none
  
  Documentation text only. The `aiContexts` description on the stack, the `@objectstack/service-record-context` README and the `RecordContextServicePlugin` docblock now name both ways a host mounts the record-context service that serves `get_record_context`: the stack declares `requires: ['record-context']`, which the CLI expands to the plugin, or a host that composes its own kernel lists `RecordContextServicePlugin` in `plugins`. Before, the stack description read the token as the only serving condition, and the README and docblock taught only the `plugins` mount. No schema, key or runtime behaviour changes.
- Updated dependencies [8236d9b]
- Updated dependencies [1d28405]
- Updated dependencies [b02484e]
- Updated dependencies [7a3f86c]
- Updated dependencies [52a2398]
- Updated dependencies [1c05546]
- Updated dependencies [42b4d09]
- Updated dependencies [4ffe9d3]
- Updated dependencies [b38e133]
- Updated dependencies [f796089]
- Updated dependencies [8f49499]
- Updated dependencies [b68f9ae]
- Updated dependencies [2e9e1ac]
- Updated dependencies [8e46424]
- Updated dependencies [f4dbcc2]
- Updated dependencies [9c29d73]
- Updated dependencies [0739dee]
- Updated dependencies [89364b4]
- Updated dependencies [dfc6bbf]
- Updated dependencies [97b9d1e]
- Updated dependencies [0f29688]
- Updated dependencies [5ecf937]
- Updated dependencies [2df9691]
- Updated dependencies [f19e6c6]
- Updated dependencies [feb9b79]
- Updated dependencies [b7d2474]
- Updated dependencies [50f85e9]
- Updated dependencies [4b1eb0e]
- Updated dependencies [c0716ed]
- Updated dependencies [7bd5d28]
- Updated dependencies [8856afc]
- Updated dependencies [9062756]
- Updated dependencies [cdb327f]
- Updated dependencies [6ffa816]
- Updated dependencies [09ba0c7]
- Updated dependencies [b863d2b]
- Updated dependencies [e75a528]
- Updated dependencies [5dd856f]
- Updated dependencies [5dd856f]
- Updated dependencies [61722e9]
- Updated dependencies [8384d18]
- Updated dependencies [f6902e9]
- Updated dependencies [df81f4c]
- Updated dependencies [ed906d5]
- Updated dependencies [e6fa510]
- Updated dependencies [99ece3c]
- Updated dependencies [3cfa5bc]
- Updated dependencies [bfd1049]
- Updated dependencies [2495486]
- Updated dependencies [16a96ac]
- Updated dependencies [f4de1de]
- Updated dependencies [53c9575]
- Updated dependencies [7411f9b]
- Updated dependencies [e114324]
- Updated dependencies [f71d488]
- Updated dependencies [f44758b]
- Updated dependencies [f7b172f]
- Updated dependencies [a0b01fa]
- Updated dependencies [5d2ce34]
- Updated dependencies [59392ed]
- Updated dependencies [c99156e]
- Updated dependencies [c8e9bec]
- Updated dependencies [7ee7a61]
- Updated dependencies [9b6db73]
- Updated dependencies [7c122ff]
- Updated dependencies [f98f18c]
- Updated dependencies [401eb44]
- Updated dependencies [29f1280]
- Updated dependencies [eb7ad70]
- Updated dependencies [de25d58]
- Updated dependencies [fe19096]
- Updated dependencies [4fb7169]
- Updated dependencies [d953558]
- Updated dependencies [af566c2]
- Updated dependencies [cedc094]
- Updated dependencies [bb1c55d]
- Updated dependencies [d7c257e]
- Updated dependencies [40e22f1]
- Updated dependencies [5dbcc02]
- Updated dependencies [bc9ace2]
- Updated dependencies [d6be99d]
- Updated dependencies [0a1b69c]
- Updated dependencies [2e07e61]
- Updated dependencies [643fe3b]
- Updated dependencies [0a3dd40]
- Updated dependencies [6b51822]
- Updated dependencies [f3c9d42]
- Updated dependencies [8df7bf2]
- Updated dependencies [170ca48]
- Updated dependencies [d33bf5a]
- Updated dependencies [236c804]
- Updated dependencies [c261a7c]
- Updated dependencies [f548bdc]
- Updated dependencies [e72f2aa]
- Updated dependencies [f2a990b]
- Updated dependencies [a23164e]
- Updated dependencies [8c5a81e]
- Updated dependencies [6db1dc2]
- Updated dependencies [78437e2]
- Updated dependencies [ed4d322]
- Updated dependencies [0628e08]
- Updated dependencies [b7fe94a]
- Updated dependencies [0b2118f]
- Updated dependencies [81eae2b]
- Updated dependencies [ad65d82]
- Updated dependencies [cb5a975]
- Updated dependencies [92e0475]
- Updated dependencies [d12ac84]
- Updated dependencies [ad92dfd]
- Updated dependencies [bb89b2d]
- Updated dependencies [8da2b7e]
- Updated dependencies [ec545de]
- Updated dependencies [7c9b22b]
- Updated dependencies [9742142]
- Updated dependencies [f3a8a13]
- Updated dependencies [543585d]
- Updated dependencies [70194ff]
- Updated dependencies [0002eaf]
- Updated dependencies [7a5ae65]
- Updated dependencies [70d07fd]
- Updated dependencies [73f2cf4]
- Updated dependencies [60e79ed]
- Updated dependencies [595844b]
- Updated dependencies [28588d0]
- Updated dependencies [3b58921]
- Updated dependencies [c45dd80]
- Updated dependencies [48c5484]
- Updated dependencies [cb2d6aa]
- Updated dependencies [d463c46]
- Updated dependencies [7501d0c]
- Updated dependencies [45ef94e]
- Updated dependencies [573a376]
- Updated dependencies [cbc06ff]
- Updated dependencies [8f141a2]
- Updated dependencies [d24e4ab]
- Updated dependencies [f66340a]
- Updated dependencies [fed637c]
- Updated dependencies [7a7ab47]
- Updated dependencies [08f4bad]
- Updated dependencies [70f454a]
- Updated dependencies [8644ce7]
- Updated dependencies [8aecf6d]
- Updated dependencies [8ddadc1]
- Updated dependencies [a03bc4e]
- Updated dependencies [021524c]
- Updated dependencies [129e637]
- Updated dependencies [13f5466]
- Updated dependencies [ff6f976]
- Updated dependencies [00aa574]
- Updated dependencies [d95d34f]
- Updated dependencies [76eea0f]
- Updated dependencies [84b1e0c]
- Updated dependencies [151e812]
- Updated dependencies [6210a08]
- Updated dependencies [81c1ae9]
- Updated dependencies [51b67f1]
- Updated dependencies [66452df]
- Updated dependencies [4f9a3f8]
- Updated dependencies [1cda7ea]
- Updated dependencies [5078f2f]
- Updated dependencies [01967c3]
- Updated dependencies [5078f2f]
- Updated dependencies [8b1841f]
- Updated dependencies [012f0a1]
- Updated dependencies [227e952]
- Updated dependencies [422df61]
- Updated dependencies [06c1f54]
- Updated dependencies [489d9fe]
- Updated dependencies [c349576]
- Updated dependencies [c063734]
- Updated dependencies [0439a04]
- Updated dependencies [5bf7242]
- Updated dependencies [f92d271]
- Updated dependencies [3d4f423]
- Updated dependencies [d7f299c]
- Updated dependencies [f9fda2a]
- Updated dependencies [91138ec]
- Updated dependencies [9981f27]
- Updated dependencies [3801775]
- Updated dependencies [40570d6]
- Updated dependencies [2a6f26a]
- Updated dependencies [b7dee0e]
- Updated dependencies [68250f6]
- Updated dependencies [fd462c5]
- Updated dependencies [d15e439]
- Updated dependencies [6831e04]
- Updated dependencies [efaafe3]
- Updated dependencies [875ae40]
- Updated dependencies [da50177]
- Updated dependencies [7e9c50c]
- Updated dependencies [5cf9941]
- Updated dependencies [204356a]
- Updated dependencies [59571b2]
- Updated dependencies [c94191d]
- Updated dependencies [ebac615]
- Updated dependencies [98b17fe]
- Updated dependencies [8d60333]
- Updated dependencies [db46566]
- Updated dependencies [2776e88]
- Updated dependencies [083e040]
- Updated dependencies [66c854d]
- Updated dependencies [372ce7c]
- Updated dependencies [df8a1b8]
- Updated dependencies [75925e1]
- Updated dependencies [7d50dc8]
- Updated dependencies [595e9cb]
- Updated dependencies [20d025f]
- Updated dependencies [64b278e]
- Updated dependencies [695b9db]
- Updated dependencies [ecd4b2b]
- Updated dependencies [d280de9]
- Updated dependencies [f9dd033]
- Updated dependencies [6296909]
- Updated dependencies [660e7cd]
  - @objectstack/spec@19.0.0-next.0
  - @objectstack/core@19.0.0-next.0
