// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/view-container` — the one spelling of "which object
 * does an aggregated `defineView` container bind to", as its own entry point.
 *
 * ## Why this subpath exists
 *
 * This is the `/errors` pattern taken a second time, for the same reason
 * (`src/errors.ts` carries the first telling). `@objectstack/metadata`'s ROOT
 * entry pulls `MetadataPlugin` → `NodeMetadataManager` → `chokidar`, plus
 * `glob` and `js-yaml`; a cross-package consumer that wants a six-line pure
 * function should not have to load any of that.
 *
 * The consumer that forced it is `packages/objectql`'s ADR-0076 lean entry.
 * `@objectstack/objectql/core` re-exports `engine.ts`, whose boot-loop
 * registrar has to mint the same registry key as this package's registrars
 * (commit 3c1bbd2a8), so it imports {@link deriveViewContainerObject} rather than
 * hand-copying the chain — and reaching it through the root entry made that
 * lean closure load the manager and the filesystem machinery for a function
 * that touches neither (commit 3bd9b3498 measured six extra modules,
 * 499,162 B, about 22 ms of init).
 *
 * ## Why the function now LIVES in `@objectstack/spec` (#22934)
 *
 * The stack contract asks the registrars' question too: `defineStack` refuses
 * two `views` containers that bind one object, because they occupy one
 * registry slot (`collectDuplicateEntryErrors` in the spec's `stack.zod.ts`).
 * The spec cannot import this package, so the declaration moved to
 * `packages/spec/src/ui/view-container-object.ts`, and this entry re-exports
 * it under the same name — one copy, so a registrar and the contract that
 * judges its slots cannot part in silence. The root export
 * (`index.ts` → `view-container-expansion.ts`) keeps its spelling too.
 *
 * What the move costs, stated rather than implied. This entry used to import
 * nothing (one module, 469 B, commit 3bd9b3498); it now loads the
 * `@objectstack/spec` ROOT entry. Every in-repo importer of this subpath
 * already loads that entry on its own: objectql's `engine.ts` and the CLI's
 * scaffold wiring import `isAggregatedViewContainer` from it, and
 * `@objectstack/metadata-protocol` and `@objectstack/rest` reach it through
 * their own imports and `@objectstack/core`'s. For them the edge adds no
 * module, and `check:lean-entry-closure`'s admitted package set for
 * `@objectstack/objectql/core` is unchanged. A consumer that loads ONLY this
 * subpath now pays for the spec entry. What the subpath still promises is the
 * part it was made for: none of the manager, the loaders or their filesystem
 * dependencies.
 */
export { deriveViewContainerObject } from '@objectstack/spec';
