---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

fix(lint)!: a `_relatedLists` translation key over a list the `.custom` arrangement hides or re-states without a label is refused, as nothing reads it

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered translation-related-list-key-under-arrangement-refused -->

**BREAKING** for a translation bundle that carries `objects.<object>._relatedLists.<list>` over a list the object's owner labels but the paired `.custom` package's `relatedLists` (ADR-0146 D10) re-states. `objectstack validate` and the other doors that run `translation-target-unknown` now report such a key as an error, where 18.x accepted it. Drop the key, or give the arrangement's entry a `label` (`{ list, label }`) and keep it.

**Why.** The registry applies the `.custom` arrangement after the owner's tab list and every `place` entry, and each arrangement entry replaces every entry it covers: the same list, or, for a bare child name, every list of that child (`relatedListNameCovers`). An entry `{ list, hidden: true }` leaves no tab, and a bare name or an entry with no `label` leaves the tab titled by the child lookup field's `relatedListTitle`. In both cases the served object has no `label` on that list for the key to translate. The rule judged the owner's label first and accepted the key before it looked at the arrangement, and it never saw the arrangement's bare names.

**What changes in `@objectstack/lint`.**

- The rule folds the arrangement's entries after the owner's entries and every placement, as the registry does. A list the arrangement labels resolves. A list it hides, names bare or names without a label does not resolve, whatever label the owner or a placement gave it. Lists the arrangement does not cover keep what they had.
- A key over a list the arrangement hides gets the "hidden by the `.custom` arrangement" message, now also when a bare child name such as `{ list: 'event', hidden: true }` hides a dotted list such as `event.related_to`.
- `VisibleObjectExtension` (`object-graph.ts`, internal) carries the extension's `relatedLists` as written, bare names included, as `relatedListArrangement`.

Measured first-party exposure: none. No example or first-party package ships a `.custom` arrangement that re-states an owner-labelled list together with a key for it.
