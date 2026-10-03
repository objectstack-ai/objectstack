---
'@objectstack/spec': minor
---

A page's `requires` is accepted only on the kinds whose source is compiled at save: `html` and its deprecated alias `jsx`. On a `react`, `full` or `slotted` page, and on a page that omits `kind` (which is `full`), it is refused at parse.

Clause-②: yes (narrowing)

<!-- adr-0087: registered page-requires-non-compiled-kind-removed, page-requires-non-compiled-kind-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** `requires` is the list of plugin namespaces a page's source uses (ADR-0080 §5). It is derived from the source at save, and its describe has always said "omit it". On an html page, on a server that has the deployment's SDUI component manifest, the metadata save door compiles the source, stores the namespaces it uses as `requires`, and refuses a written list that disagrees. A `react` source is executed at render and never compiled at save, and `full` and `slotted` pages have no source. So on those three kinds nothing derived the key, the Studio page editor dropped it on every save, and its one reader was a load-time warning. `PageSchema` still accepted it there and never told the author it did nothing. The maintainer ruled that the key is accepted only on the compiled kinds.

**What is refused.** `requires` on a page whose `kind` is `react`, `full` or `slotted`, or a page with no `kind`, at the `requires` path. An empty list is refused too, because the key is what is refused, not its contents. The issue's `code` is `custom`, and its message names the key, the page's kind and the compiled kinds. That covers `definePage()`, `PageSchema`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `pages.N.requires`), `os validate`, which runs the same stack parse, and the metadata save door (`422 INVALID_METADATA`).

**What stays accepted.** `requires` on an `html` or `jsx` page, byte for byte. The save door still derives it, stores it, and refuses a written list that disagrees. Every page that omits `requires` parses as before, on every kind.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `requires: [...]` on a `kind: 'react'` page | nothing: delete the key. Nothing derived or enforced it |
| `requires: [...]` on a `kind: 'full'` or `kind: 'slotted'` page, or on a page with no `kind` | nothing: delete the key |
| `requires: [...]` on a `kind: 'html'` or `kind: 'jsx'` page | unchanged. The platform derives it from the source at save, so omitting it is still the intended authoring |

**The one-line fix: delete `requires` from every page whose `kind` is not `html` or `jsx`.** `os migrate meta --from 17` lists the mechanical edits for existing sources. Stored pages and built artifacts are converted when they are read.

**Who is affected, measured.** No page body authors `requires` on a `react`, `full` or `slotted` page in this repository at `c98a72d69e` (`examples/**`, `packages/apps/**`, `content/docs/**`, `skills/**`, tests and fixtures). Every `requires:` there is the stack-level capability list or an html page in a save-door test. The same holds in cloud (`c5a4c9e6cb`), hotcrm (`5ae524916d`) and objectui (`8366accd13`), per the ruling's census. Deployed metadata was not measured.

### The retirement kit

- **The refusal.** `checkPageRequiresKind`, an exported object-level check attached to `PageSchema` beside `checkPageSourceCompleteness` (`@objectstack/spec/ui`), with `COMPILED_PAGE_KINDS` (`['html', 'jsx']`) as its vocabulary. A downstream mirror that derives its schema from `PageSchema.shape` re-attaches it with `.superRefine(checkPageRequiresKind)`. There is no tombstone and no `RETIRED_KEYS_BY_MAJOR` row, because the key stays live on html pages.
- **The conversion.** `page-requires-non-compiled-kind-removed` (protocol 18) deletes the key from `react`, `full`, `slotted` and kind-less pages. It is a lossless delete: on those kinds the list never had an effect. It is retired from the load path, so authored sources are refused at parse, while stored rows, built artifacts and `os migrate meta` replay it. Its D3 record is the semantic entry `page-requires-non-compiled-kind-refused`.
- **The ledgers.** The `requires` describe, its liveness row (`liveness/page.json`) and its form-reconciliation row now say the key exists only on html and jsx pages.
