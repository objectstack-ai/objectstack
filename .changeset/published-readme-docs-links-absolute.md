---
"@objectstack/service-automation": patch
"@objectstack/service-analytics": patch
"@objectstack/service-knowledge": patch
"@objectstack/knowledge-ragflow": patch
"@objectstack/service-cache": patch
"@objectstack/service-i18n": patch
"@objectstack/service-job": patch
---

Published READMEs link to the docs site in the one form that works on npm, on GitHub and on the docs site (#9632)

**Seven docs links in these READMEs pointed nowhere.** They were spelled as a repo
path rooted at `/` — `[Flows](/content/docs/automation/flows.mdx)` — and a README in a
package's `files` array with `private` unset is rendered on the **npm package page** and
on **GitHub**, not only in this repository. There a root-relative href resolves against
`npmjs.com` and `github.com` respectively. It was not a docs-site route either:
`apps/docs/lib/source.ts` mounts `loader({ baseUrl: '/docs' })` over `content/docs`, so
the route for that first link is `/docs/automation/flows`, and `apps/docs/redirects.mjs`
carries no `/content` source that would rescue the written form. Every target page
existed and every one of them was reachable — only the links were not.

All seven now use the absolute form the repo had already established in
`create-objectstack`'s published READMEs: `https://docs.objectstack.ai/docs/...`, with
the path taken under `content/docs` and the page extension dropped, because the route
carries none. Each target was re-verified at the route level rather than as a file — the
two that named a **directory** (`/content/docs/automation/`,
`/content/docs/references/automation/`) resolve only because those directories carry an
`index.mdx`; a directory without one is a 404, not a section.

**Two more links in the same class were converted in the same pass.**
`service-knowledge` and `knowledge-ragflow` pointed at
`../../../content/docs/protocol/knowledge.mdx`. Those relative paths do resolve on both
GitHub and npm, so they are a milder defect than the seven — but they land the reader on
**raw MDX source** instead of the rendered page. They now point at the rendered page as
well. `service-knowledge`'s link text changed with it: it was the source filename in a
code span, which stops being an honest label once the destination is the page.

No API, behaviour or type surface changes — this is the published documentation these
packages ship.
