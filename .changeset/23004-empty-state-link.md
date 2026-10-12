---
"@objectstack/spec": minor
---

feat(spec): an empty state names its one next step — `emptyState.link: { label, url }` — and a list page carries its own `interfaceConfig.emptyState`

Clause-②: yes (widening: two new accepted keys)

- **`EmptyStateSchema.link`.** An empty state takes one optional link beside `title`, `message` and `icon`: `{ label, url }`, both required and nothing else, for example `link: { label: 'How to publish a package', url: '/docs/publish-a-package' }`. It opens a page or an address and runs no action, flow or script. The shape is closed: a missing `label` or `url`, any other key and a non-object are refused at parse.
- **The targets a `type: 'url'` action opens, and no others.** `link.url` admits an in-app path that starts with `/` or `./`, an address that opens with `http://`, `https://` or `mailto:`, and a target that opens with `${`, which is judged when it is clicked. Every other scheme (`javascript:`, `data:`, `tel:`, …), a protocol-relative `//host`, `/` followed by a backslash, a tab, line feed or carriage return, and a bare relative target such as `docs/x` are refused at `link.url` with the reason and the fix, in the same sentences a url action's `target` is refused with. An empty `url` is refused as empty.
- **Every door that carries the empty state takes the link:** a list view's `emptyState` (and so an object's `listViews` and a view document's), the `object-grid` page block's `emptyState`, and a list page's new `interfaceConfig.emptyState`.
- **`interfaceConfig.emptyState`.** A `type: 'list'` page takes its own empty state, the list view's shape itself: `{ title, message, icon, link }`, refused at parse exactly as the list view's is.
- **Guidance.** `action` or `button` written on an empty state is now answered with the link, and still with the list view's `addRecord` block for an add-record entry point; a `url` or `href` written flat on the empty state is pointed into `link`.
- **Not rendered yet.** No console renderer draws the link or a list page's own empty state today. Both parse and are not drawn, and their schema descriptions say so (`[PLANNED — not yet rendered]`). Until the console reads it, a list page still draws its source view's empty state, if any.
- **Published JSON Schema.** `link.url` publishes as a string with `minLength: 1`. The target rule is a parse-time refinement the published file does not express; the file names its position under `x-dropped-refinements`.
