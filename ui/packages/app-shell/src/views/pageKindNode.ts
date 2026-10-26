/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The page-shape half of the schema node a stored page document is handed to
 * `SchemaRenderer` as: the `{ type, pageType }` pair (objectui#11933).
 *
 * A stored page's `type` is the spec's page KIND (`PageTypeSchema` in
 * `@objectstack/spec/ui`). It is written twice:
 *
 * - VERBATIM into `type`, the SchemaNode discriminator `ComponentRegistry`
 *   dispatches on — `@object-ui/components` registers `PageRenderer` under
 *   each region-composed kind, and under `'page'`, the fallback for a document
 *   that carries no `type` at all;
 * - as a copy on `pageType`, which is what `PageRenderer` reads for the page's
 *   max-width, its `data-page-type`, and whether it draws the implicit title
 *   heading. Without it every page falls back to `'record'`: the record width
 *   and no title.
 *
 * ⭐ ONE builder, because the writers drifted: `PageView` (the running app)
 * wrote both keys, while Studio's two page previews wrote only `type` — the
 * source-page live preview (`SourcePageEditor`) and the Run-mode page canvas
 * (`PagePreview`). So an `app` or `home` page previewed as a record page while
 * the running app drew it with its title and its own width. That broke the
 * previews' contract — "a live preview rendered through the runtime
 * SchemaRenderer". All three writers now spread this one builder, so they
 * cannot drift apart again.
 *
 * ⛔ Page shape only. Data and context wiring (`PageView`'s `context: { params }`
 * and the providers around it) stay with each writer: a preview has no URL.
 *
 * Pins: `page-kind-writing-end-9718` in `views/__tests__` (the running app's
 * write, kind by kind), and `SourcePageEditor.pageKind-11933` and
 * `PagePreview.pageKind-11933` beside the previews (each preview's render,
 * through the real `PageRenderer`).
 *
 * Module-private: not exported from the package entry.
 */
export function pageKindNode(page: { type?: string }): { type: string; pageType: string | undefined } {
  return { type: page.type || 'page', pageType: page.type };
}
