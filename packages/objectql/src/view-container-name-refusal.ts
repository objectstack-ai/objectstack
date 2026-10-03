// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The divergent view-container `name` refusal, as `@objectstack/objectql`
 * exports it — a re-export of the ONE judge, which lives in
 * `@objectstack/metadata/view-container-name`.
 *
 * ## What it judges, and who calls it
 *
 * A container's own `name`, when set, must equal the key the door files the
 * container under; a disagreement is refused under the maintainer's ruling of
 * 2026-09-03 (direction 2), because resolving it silently in either direction
 * files the item under a key the author never wrote (#7378 row 1). Four doors
 * judge it, in one template:
 *
 *  - the boot registrar (`registerMetadataCollections` in `engine.ts`), which
 *    throws what {@link viewContainerNameRefusal} returns;
 *  - `os validate` / `os compile` (`packages/cli`), which report it — the
 *    author-time judge of what `os serve` accepts (#20331);
 *  - the artifact/HMR loader (`@objectstack/metadata`'s `plugin.ts`), which
 *    throws it before it files anything;
 *  - the runtime save door (`saveMetaItem`, `@objectstack/metadata-protocol`),
 *    through the judge's save-door entry (#21412).
 *
 * ## Why the judge moved, and why this export stays
 *
 * The runtime save door is the third door and the one that forced the move:
 * `@objectstack/metadata-protocol` cannot import `@objectstack/objectql` (the
 * edge runs the other way), and `@objectstack/core` cannot host the judge
 * because the derivation it needs lives in `@objectstack/metadata`, which lists
 * core. `@objectstack/metadata` is the one layer every door already depends on,
 * so the judge — its gate, its envelope and its words — lives there now, and
 * this module keeps the published name and signature so `engine.ts` and the CLI
 * doors import exactly what they imported before. The words the boot registrar
 * and `os validate` print are byte for byte what this module used to build.
 *
 * ## Why the source registrars' entry derives the key, and the save door's does not
 *
 * For a container, the key the source registrars file under IS
 * `deriveViewContainerObject` — the first branch of `resolveMetadataItemName`
 * returns exactly that, gated on the same `isAggregatedViewContainer` — so the
 * entry this module exports derives it itself rather than make every caller
 * re-derive it (a second spelling of "which derivation does boot use for a
 * container"). The precondition moved with it: a falsy derived key refuses
 * nothing, because boot warns and skips that entry.
 *
 * The runtime save door's key is not a derivation: it files the row under the
 * name it is SAVED under, and that name is not always the binding (it keeps a
 * container saved under a name other than its object, #13407, and expands one
 * on another package's object under its own name, #21334). So the save door's
 * entry takes the key; judging it against the derived key was measured and
 * refused (#21412). Both entries share one judgement and one template, and
 * differ only in where the key came from.
 *
 * The envelope is the artifact door's and every door's — `VALIDATION_ERROR` /
 * 400 — asserted equal across the source registrars in
 * `view-container-divergent-name-registrars.test.ts`.
 */

export { viewContainerNameRefusal } from '@objectstack/metadata/view-container-name';
export type { ViewContainerNameRefusal } from '@objectstack/metadata/view-container-name';
