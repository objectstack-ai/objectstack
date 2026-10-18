---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Clause-②: no

The `description` of four metadata types in `DEFAULT_METADATA_TYPE_REGISTRY`, which Setup shows under the
type's title, is now one plain sentence for an administrator instead of ADR vocabulary:

- `api`: "A stable HTTP URL that other systems call to run a flow or work with records in the app"
- `doc`: "A help page written in Markdown that a package ships or you write yourself"
- `book`: "A table of contents that groups help pages into ordered sections"
- `capability`: "A permission a package defines; you grant it through permission sets"

The ADR references (ADR-0121, ADR-0046, ADR-0046 §6, ADR-0066 D1) moved to the comments beside the
registry rows. The generated metadata-forms translations carry the new sentences in en, zh-CN, ja-JP
and es-ES. No key, type or accept/refuse result changes.
