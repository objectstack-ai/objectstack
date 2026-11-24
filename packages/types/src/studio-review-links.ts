// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two Studio addresses a server hands out (objectstack#36895): where a
 * person reviews a draft that the CLI's `os meta register` or the MCP authoring
 * tools saved. Both producers (`packages/cli`, `packages/runtime`) already
 * depend on this package, and neither may depend on the Console, so the
 * shared spelling lives here.
 *
 * The Console builds the same two addresses with `studioChangesReviewPath`
 * and `studioItemReviewPath` (`studioAddress.ts` in the Console's app-shell package),
 * which does not depend on this package; both sides are pinned to the same
 * literals, and to the literals the `objectstack-mcp-build` skill's evals
 * quote (`studio-review-links.test.ts`).
 *
 * ⛔ A changed byte here changes the review link an AI is handed and repeats to
 * a person. The addresses move only when the Studio redesign moves them, and
 * then on both sides together.
 */

/** A package's Changes drawer on its Studio home: `/studio/<package>/data?changes=review`. */
export function studioChangesReviewLink(packageId: string): string {
  return `/studio/${encodeURIComponent(packageId)}/data?changes=review`;
}

/** An item's draft review in Studio's "All metadata" area: `/studio/<package>/metadata/<type>/<name>?review=1`. */
export function studioItemReviewLink(packageId: string, type: string, name: string): string {
  return `/studio/${encodeURIComponent(packageId)}/metadata/${encodeURIComponent(type)}/${encodeURIComponent(name)}?review=1`;
}
