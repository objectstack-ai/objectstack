---
"@objectstack/docs": patch
---

feat(docs): give a doc page a short sidebar label (`navTitle`) distinct from its `title` (#12311)

A doc page's frontmatter `title` was the only string the site had, so it served
six consumers with different length budgets at once — measured on `origin/main`,
405 pages under `content/docs`, whose only frontmatter keys are `title` (405) and
`description` (405):

| consumer | site |
|---|---|
| SERP `title`, OG and twitter metadata | `app/[lang]/docs/[[...slug]]/page.tsx:211,216,227,233` |
| on-page `h1` | `page.tsx:150` |
| JSON-LD `TechArticle` headline/name | `page.tsx:123,124` |
| JSON-LD `BreadcrumbList` | `page.tsx:95` — via the page tree |
| `llms.txt`, `llms-full.txt`, the `.mdx` endpoints | `app/llms.txt/route.ts:10`, `lib/source.ts` `getLLMText` |
| Open Graph card image | `app/og/docs/[...slug]/route.tsx:18` |
| sidebar / page tree | `lib/source.ts` — `loader()` |

A 50–60 character title carrying search intent is right for the first six and
unreadable in the last, which is why #12237's title rewrite stopped after the
four pages that have no sidebar entry.

`navTitle` is the page tree's own string. It is declared on the docs page schema
(`docsSchema = pageSchema.extend({ navTitle: z.string().optional() })` in
`apps/docs/source.config.ts`) and resolved in exactly one place —
`apps/docs/lib/nav-title.ts`, whose header is the mechanism's documentation —
through `fumadocs-core`'s own `PageTreeTransformer` hook, the same extension
point its built-in icon plugin uses. **`title` is the declared fallback**, stated
there and at no read site, so all 405 pages keep their present sidebar entry with
no frontmatter change.

`fumadocs-core@16.14.4` ships no first-class equivalent: its `pageSchema` is
`{ title, description, icon, full, _openapi }`, its `metaSchema` carries no
per-page label field, and its page-tree builder reads `{ title, description,
icon }` off a page. `scripts/check-docs-nav-label.mjs` re-reads both schemas on
every run, so the day an upgrade does ship one, the gate says migrate.

The separation is pinned rather than described. That gate holds `navTitle` to two
code sites, executes the resolver over its fallback cases, and keeps the JSON-LD
breadcrumb's leaf crumb on `page.data.title`: `getBreadcrumbItems` is now called
with `includePage: false`, so the leaf comes from the page's own title instead of
its page-tree node — behaviour-identical today (the node's name *is* the title),
and the one place the short label would otherwise have reached structured data a
crawler reads.
