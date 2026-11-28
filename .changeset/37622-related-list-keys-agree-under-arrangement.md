---
'@objectstack/lint': patch
'@objectstack/rest': patch
'@objectstack/spec': patch
---

fix(lint,rest)!: `os i18n extract` / `os i18n check` expect the `_relatedLists` keys `os validate` accepts under a `.custom` arrangement, and the object read translates a tab title the arrangement sets

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no schema key, accepted value, stored shape or export moves; the moved answers are the coverage gate's expected key set and the translation an object read serves, and the remedy is a translation the author adds or drops in a bundle, which no conversion can write -->

**BREAKING** for a stack that runs `os i18n check --strict` (or `--threshold`) and carries a paired `.custom` package's `relatedLists` arrangement (ADR-0146 D10) that labels a record-page tab. The coverage gate now expects `objects.<object>._relatedLists.<list>.label` for each list the arrangement labels, with the arrangement's text, so a stack that passed in 19.0.0-next.1 without that translation now reports it missing. Add the translation, or drop the arrangement entry's `label`. Keys over a list the arrangement hides, names bare or re-states without a `label` are no longer expected, so a gate that demanded a key `os validate` refuses stops demanding it.

**What changes in `@objectstack/lint`.**

- `collectExpectedEntries`, which `os i18n extract` and `os i18n check` read, folds the owner's `relatedLists` with the stack's `objectExtensions` the way `translation-target-unknown` folds them: every placement first, then the arrangement, whose entries replace every entry they cover (`relatedListNameCovers`). It is one fold, `related-list-titles.ts`, read by both. `os i18n extract` scaffolds no key over a list the arrangement hides, names bare or re-states without a `label`, and scaffolds one, carrying the arrangement's text, over a list it labels. A label only a code extender's `place` entry gives is still not scaffolded: the rule accepts its key, but the registry may not apply the placement.
- The two `translation-target-unknown` hints for such a key name the list it addresses, `{ list: 'LIST', label }`, instead of "the owner's `label`". The stripped label may be a placement's, and where a bare child name covers a dotted list, the entry to write is the dotted list's own.

**What changes in `@objectstack/rest`.** The `/meta/object` reads (by name and list) hand the translator the paired `.custom` package's own `objects.<object>._relatedLists` translations, read for the pair of the base the object's packaged base ships in. A tab title the arrangement sets or changes now reads the pair's translation, then keeps its own text. Before, it read nothing, because an object answers no `servedOverrideBaseOf` (ADR-0146 D10, unchanged). Only that subtree is handed on: every other string of an object keeps the ranking it had.

**What changes in `@objectstack/spec`.** The wording of the `translation-related-list-key-under-arrangement-refused` ledger entry: the label the arrangement strips may be a placement's, and the remedy no longer says that a translated title needs the owner's label.
