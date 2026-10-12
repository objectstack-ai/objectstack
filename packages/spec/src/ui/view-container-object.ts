// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one spelling of "which object does an aggregated `defineView` container
 * bind to" — a pure module that imports nothing.
 *
 * ## Why it lives in the spec
 *
 * Every registrar files an aggregated container under the object this returns
 * (the metadata plugin's artifact slots, the ObjectQL boot loop's
 * `resolveMetadataItemName`, the unmanaged-install validator, the CLI's
 * scaffold wiring), and the stack contract has to ask the same question: two
 * `views` containers that bind one object occupy one registry slot, so
 * `defineStack` refuses the pair (`collectDuplicateEntryErrors` in
 * `stack.zod.ts`). The spec cannot import `@objectstack/metadata`, so the
 * function moved here from `packages/metadata/src/view-container.ts`, and
 * `@objectstack/metadata` re-exports this declaration under the same name, at
 * its root and at its `/view-container` subpath. One copy, never a second hand
 * copy: a registrar and the contract that judges its slots must not part in
 * silence.
 *
 * It stays free of imports so that importing it costs nothing beyond the entry
 * that carries it.
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
