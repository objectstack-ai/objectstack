---
'@objectstack/spec': minor
---

feat(spec): the console's round-trip keys on a stored `view` row are declared on the wire, so a parse keeps them (#20456)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: no key an authoring door accepts changes its spelling, type or legality, because the four keys are console state the authoring doors refuse by name. The only producer, objectui's console, writes none of the values now refused (census at the `.objectui-sha` pin: a boolean pin, an integer reorder index, the marker as `true`, and `visibility` only carried forward from a stored value). So `objectstack migrate meta` has no mechanical rewrite to perform; a stored row holding a refused value is repaired by correcting it or deleting the key. The other categories are closed on facts: `@objectstack/spec` publishes (not `unpublished`); no ADR-0087 id is minted here or pre-dates the base to cover this (not `registered` / `already-registered`); and a Zod schema's accept set changes, so neither `runtime-interface-only` nor `type-surface-only` applies. -->

**BREAKING** accept-set narrowing on the `view` write door (`PUT /api/v1/meta/view/:name`, the Studio and MCP save) and on every door that parses `ViewMetadataSchema`, shipped as `minor` under the repo's launch-window convention. The newly declared keys are typed, so a non-boolean `isPinned`, a non-integer `sortOrder`, a `visibility` outside `private` / `team` / `organization` / `public`, or an `_isOverride` other than `true` is now refused at the parse (`422 INVALID_METADATA` at the save door), where the strip used to swallow the key and the save stored the body as sent. To fix a refused body, correct the value or delete the key. The console writes none of these values: its pin toggle writes a boolean, its reorder an integer index, and it stamps the marker as `true`. The diff also widens: the keys are now declared, and `VIEW_CONSOLE_ROUND_TRIP_KEYS` is a new export.

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
