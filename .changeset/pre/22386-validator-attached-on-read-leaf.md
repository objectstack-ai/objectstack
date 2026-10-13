---
"@objectstack/formula": minor
"@objectstack/lint": patch
"@objectstack/metadata-core": patch
---

The shared build validator (`@objectstack/lint`'s expression rule over `@objectstack/formula`) judges `record.<block>.<leaf>` against an object's declared read attachments (`ObjectSchema.attachedOnRead`)

- **`@objectstack/lint`.** The field index the expression rule builds now adds each block an object declares under `attachedOnRead` to the names `record.<x>` resolves to, and hands the shared validator the block's declared leaves. A predicate such as `record.viewer.can_act` on an object that declares the `viewer` block is accepted where it was refused as an unknown field.
- **`@objectstack/formula`.** `ExprSchemaHint` gains an optional `attachedOnRead` (block name → declared leaf keys). When a `record.` or `previous.` reference names a declared block, its next segment must be a leaf the block declares. Anything else is refused with the existing `unknown-field` code: `field` is the dotted path as written (`viewer.can_actt`), `suggestion` the nearest declared leaf (`viewer.can_act`), and the new optional `block` and `leaves` params carry the leaves the block declares, which the message names. No new refusal code.
- **`@objectstack/metadata-core`.** The ADR-0106 field-level-security masker classifies the new top-level key as passed through unchanged (`OBJECT_REFERENCE_POSITIONS.attachedOnRead`): a block name and its leaf keys never name a field, so no caller's served object definition loses or gains anything.
- **Unchanged.** An object that declares no block keeps every verdict it had, and a second segment off any other field is not judged. Index access, a method call on a block and a third segment stay unjudged.
