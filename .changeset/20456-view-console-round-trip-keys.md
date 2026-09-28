---
'@objectstack/spec': minor
---

feat(spec): the console's round-trip keys on a stored `view` row are declared on the wire, so a parse keeps them (#20456)

Clause-②: yes

`saveMetaItem` stores a `view` body exactly as it was sent (ADR-0005 appendix (c)), and the members of `ViewMetadataSchema` that judge a stored row `.strip()` every key they do not declare. So the keys the console writes onto a stored view and reads back were in the store and nowhere in the contract. A census of objectui's console (at the `.objectui-sha` pin) measured which ones the parse dropped:

- `isPinned` and `sortOrder` on a flattened list overlay (they were already declared on the ViewItem record);
- `visibility`, on both the flattened list overlay and the ViewItem record;
- `_isOverride`, the marker that tells the console a row is the settings overlay of a code-defined view and not a saved view of its own.

## What it does now

- The ViewItem wire member (`ViewItemWireSchema`) and the flattened list overlay (`VIEW_METADATA_MEMBERS.listOverlay`) declare `isPinned`, `sortOrder` and `visibility` from one shared declaration, each with its meaning. The flattened list overlay also declares `_isOverride: true`, and its existing `isDefault` now carries its meaning. A parse of a console-written row keeps every one of them.
- **New export `VIEW_CONSOLE_ROUND_TRIP_KEYS`** (`@objectstack/spec/ui`): each round-trip key, mapped to the members whose rows the console writes it on (`isDefault`, `isPinned`, `sortOrder`, `visibility`, `columnState`, `_isOverride`).
- `visibility` is display grouping only (`private` / `team` / `organization` / `public` in the view switcher). It restricts nobody, and its declared meaning says so.
- None of these keys is authorable. `defineViewItem` still refuses each of them by name, and `visibility` now gets a prescription that says what it is.

## What does not change

- **What is persisted.** The save still stores the request body verbatim. Storing the parsed body is a later, separate change.
- The alias spellings the census found keep their declared spellings: `objectName` is `object`, and a top-level `id` is `name`. The console's filter / sort builder row ids stay `VIEW_CONSOLE_ROW_DECORATIONS`, removed before the parse.

## Values that are now refused

A declared key is typed, so a stored-row write carrying one of these keys with a value of the wrong type is now refused `422 INVALID_METADATA` at that key, where the key used to be dropped from the parse and the body stored as sent: a non-boolean `isPinned`, a non-integer `sortOrder`, a `visibility` outside the four groups, or an `_isOverride` other than `true`. The console writes none of these: its pin toggle writes a boolean, its reorder an integer index, and it stamps the marker as `true`.
