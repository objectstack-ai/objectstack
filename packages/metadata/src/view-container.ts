// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/view-container` — the one spelling of "which object
 * does an aggregated `defineView` container bind to", as a LEAF entry point.
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
 * (#14399), so it imports {@link deriveViewContainerObject} rather than
 * hand-copying the chain a fifth time — and reaching it through the root entry
 * made that lean closure load the manager and the filesystem machinery for a
 * function that touches neither. Measured on the built artifacts (#14680):
 * through the root entry that call site loaded SIX extra modules into
 * `@objectstack/objectql/core`'s module-init closure —
 * `packages/metadata/dist/index.js`, `js-yaml`, `glob`, `chokidar` (two
 * files) and `readdirp`, 499,162 B — for ~22 ms of extra init. Through this
 * entry it loads one 469-byte module and nothing else.
 *
 * ## Why the function LIVES here rather than being re-exported from
 * `view-container-expansion.ts`
 *
 * A re-export shim was written first and measured, because `/errors`' header
 * states the requirement the shim has to meet: "this entry re-exports one leaf
 * module and nothing else, so the cross-package edge stays a leaf edge".
 * `view-container-expansion.ts` is not a leaf — its other export,
 * `expandRuntimeViewContainer`, needs `@objectstack/spec` and
 * `@objectstack/spec/shared` — and esbuild tree-shakes the unused FUNCTION but
 * keeps both `import` statements, since it cannot prove an external package is
 * side-effect-free. Measured: the shim's own closure was 84
 * modules / 3,035 KiB (all of `@objectstack/spec` and `zod`, reached through an
 * import statement for a function that had been shaken out); this module's is
 * 1 module / 469 B.
 *
 * So the derivation lives in this module, which imports nothing at all, and
 * `view-container-expansion.ts` imports it from here and re-exports it — every
 * existing importer (`index.ts`'s root export, `plugin.ts`) keeps its spelling.
 *
 * ## Scope of the promise
 *
 * Only {@link deriveViewContainerObject} is exported here. Its former module
 * sibling `expandRuntimeViewContainer` is deliberately left off: it is internal
 * to this package (`metadata-manager.ts` is its only caller, and the root entry
 * does not export it either), and an exported symbol nobody imports is a promise
 * made for nothing — Prime Directive #10 pointed at our own API surface, the
 * same call `src/errors.ts` made about `isSchemaAlreadyExistsError`.
 *
 * The symbol stays on the ROOT entry as well: this subpath is an additional
 * door, not a relocation, and the root export is a published promise with
 * possible out-of-repo consumers.
 */

/**
 * Which object an aggregated view container binds to.
 *
 * The container's OWN top-level `object` field — `ViewSchema.object`,
 * documented there as "how a stack-level `views: [...]` entry says which object
 * its views belong to; read by `getViewsByObject()` / `GET /meta/view?object=`"
 * — is the authorial, explicit signal and is consulted FIRST (#13407). The
 * three-deep fallback below it is kept unchanged for every container written
 * before that field was read here: `list.data.object`, then `form.data.object`,
 * then the row's own `name` — which is the bound object only by convention, and
 * is why a container that set the top-level field but not `list.data.object`
 * used to bind under the wrong key or not at all.
 *
 * Returns `undefined` when no binding can be derived; every caller treats that
 * as "no expansion" rather than an error.
 */
export function deriveViewContainerObject(container: unknown): string | undefined {
  if (!container || typeof container !== 'object') return undefined;
  const c = container as Record<string, any>;
  const own = typeof c.object === 'string' && c.object ? c.object : undefined;
  const byName = typeof c.name === 'string' && c.name ? c.name : undefined;
  return own ?? c?.list?.data?.object ?? c?.form?.data?.object ?? byName;
}
