---
"@objectstack/docs": patch
---

fix(docs): stop listing `"index"` in `meta.json` `pages` — it detaches the folder index and shortens 164 breadcrumb trails (#12352)

Fumadocs attaches a folder's `index.mdx` as that folder's tree `index` node
**only when the folder's `meta.json` does not list it** in `pages`. Listing it
makes the page an ordinary child instead, and the folder node reaches every tree
consumer with a `name` and no `url` — `loader-*.js`, `buildFolder()`:

```js
if (indexPath) {
  if (excludedPaths.has(indexPath)) delete node.index;   // "index" was listed
  else excludedPaths.add(indexPath);
}
```

Two surfaces read that one node, and both were degraded:

- **Breadcrumb.** `getBreadcrumbItems()` links a folder crumb to `item.index?.url`,
  so an un-linkable ancestor is dropped rather than emitted name-only (Google
  requires `item` on every `BreadcrumbList` entry but the last). 172 of 404 doc
  pages advertised a two-level site structure they do not have.
- **Sidebar.** `node.index ? SidebarFolderLink : SidebarFolderTrigger` — the
  section header was inert text, and the section's own overview page sat below it
  as a child, in six cases under a label identical to the header's.

`"index"` is removed from 16 of the 17 `meta.json` files that listed it. It was
the first `pages` entry in 15 of them and the first entry after the
`---Start Here---` separator in `getting-started`, so no other entry's position
depends on it: the measured tree delta is exactly 16 folder headers going
`TRIGGER` → `LINK` and 16 index children leaving the child list, with every
removed child's URL now the header's `href` and no other line moved.

Short trails: **172 → 8**. The remaining 8 are `content/docs/releases/`, which
this PR does not touch — that directory is fenced by AGENTS.md, and its
`meta.json` still lists `"index"`.

No consumer-side change: `app/[lang]/docs/[[...slug]]/page.tsx` reconstructs no
URLs, deliberately, so a producer defect of this shape stays visible.
