---
"@objectstack/docs": patch
---

docs(react-pages): scope the react-only half of the page to the `react` tier (#13737)

`content/docs/ui/pages.mdx` routes **both** source-authoring tiers to
`content/docs/ui/react-pages.mdx` — the links at `:66`, `:116` and `:295`, the
last of which advertised the target as "The `html` and `react` source-authoring
tiers in full". On that page only the first two sections were tier-neutral.
Everything from `## What is in scope` down was react-only material carrying no
tier marking, so an `html`-tier reader arriving from any of those links read it
as their own.

That is the mechanism behind the naming trap #13734 closed with one sentence.
This closes the rest of the class the same way — **marking, not a split**: no
new page, no repointed links, no section moved between files.

Nine react-only sections were audited against source for the one question "is
there a statement here an `html` author could act on and be wrong?". Seven were
**actively misleading**, and all seven are consequences of the same fact the
page already states twice up top — an `html` page's source is *parsed, never
executed*:

- `## What is in scope` — the closure-scope table (`React`, `useAdapter`,
  `Block`, `data`/`variables`/`page`) is the react runtime's injected scope. An
  `html` page has no closure scope at all.
- `## Blocks take flat props` — `parse.ts` refuses every `on[A-Z]` attribute
  (`forbidden-attr`), so the `onRowClick` callback wiring has no html
  counterpart; and the `type` → `specType` rescue is the react runtime's
  (`specType` occurs nowhere else in this repo). On html the parser builds
  `{ type: tag, ...props }`, so a `type` attribute overwrites the discriminator
  — and `object-chart` declares no `type` input in `sdui.manifest.json` anyway.
- `### Block — the escape hatch` — `compile()` whitelists
  `Object.keys(manifest.components)`; `block` is not one of the 57 keys, so
  `<Block>` is not a tag an html page may write.
- `## Live data` — `useAdapter` and hooks exist only where the source runs, and
  the sample is refused by the html grammar before that matters.
- `## Accepted source shapes` — **inverted**. The html grammar is
  `document := element`: `function Page() { … }` and `() => …` fail `no-root`,
  and the prescribed fix `export default Page;` is a second root
  (`multiple-roots`). An html author following the section verbatim writes
  source that cannot save.
- `## When something throws` — describes a runtime that executes. An html
  page's errors are save-time diagnostics (`jsx-forbidden-tag`,
  `jsx-unknown-component`, `jsx-no-root`, …), not a React error panel.
- `` ## `record:*` blocks are not in this tier `` — **inverted, and the
  sharpest**: `validateReactPageProps` skips every page whose `kind !== 'react'`,
  and `record:details` / `record:related_list` are registered tags in the html
  manifest. The heading told html authors to stop using the blocks their tier
  composes record pages with. Retitled to name the tier (anchor
  `#record-blocks-not-in-react` preserved; the only inbound link is on the same
  page).

Two sections in the middle of that run are **both-tier** and are now marked as
such rather than swept up: `## Styling`'s Tailwind rule (`page.zod.ts`: "Do not
author Tailwind classes in page source in either tier") and `## How you check
your work`'s three commands. This is why a single marker at the top of the run
would have been wrong.

Every marker is one bold lead-in that names the tier and then names the html
counterpart — #13734's own convention, with `On this tier` spelled as
``On the `react` tier`` so it cannot be read as either tier. The three
occurrences of the bare phrase already on the page were normalised to match, so
the page now contains none.

`pages.mdx:295` no longer claims the page covers both tiers "in full" — it
never did, and the audit makes the gap explicit. It now says what the page is:
choosing between the tiers, plus the `react` tier's guide in full.
