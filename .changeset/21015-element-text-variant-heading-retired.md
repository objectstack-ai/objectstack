---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
---

feat(spec)!: `element:text` `variant` refuses `heading` / `subheading` by name — the vocabulary is the nine `ui:text` publishes, and `os migrate meta` rewrites them to `h2` / `h3` (#21015)

**BREAKING** — `heading` and `subheading` leave `ElementTextPropsSchema.variant` (an
`element:text` page component's `properties.variant`). This is the second release of
the ruled two-release convergence on the nine values `ui:text` publishes — `h1`-`h6`,
`body`, `caption`, `overline`. 17.5.0 added the nine and refused nothing; 17.6.0 was
the full release in which both vocabularies parsed; this release refuses the two old
spellings. A heading is a document level, not a text style: `heading` and
`subheading` named a style and left the renderer to pick the level.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `variant: 'heading'` | `variant: 'h2'` — the heading element `heading` always rendered — or the level the page outline means. |
| `variant: 'subheading'` | `variant: 'h3'` — the heading element `subheading` always rendered — or the level the page outline means. |

**The one-line fix: `heading` → `h2`, `subheading` → `h3`.**
`os migrate meta --from 17` lists the mechanical edits for existing sources.

The rewrite keeps the heading ELEMENT (so the document outline is unchanged) but not
the size: `heading` drew in the `h3` style and `subheading` in a medium-weight small
heading style, and `h2` / `h3` draw their own, larger styles. Where the old look
mattered more than the level, pick the level whose style you want.

Each retired spelling is refused at parse with a prescription naming the level to
write, and in `tsc` (the two members are gone from the input type). Any other unknown
value keeps zod's own message. An `element:text` with no `variant` still parses to
`body`.

### The retirement kit

- **Value-level retirement.** The enum is declared through `enumWithRetiredValues`
  (`shared/retired-key.ts`), with the two prescriptions module-private. No authorable
  KEY and no def changed, so nothing lands in `RETIRED_KEYS_BY_MAJOR` and the four
  surface ratchets (`api-surface`, `authorable-surface`, `json-schema.manifest`,
  `api-surface-signatures`) are byte-identical; the generated component reference
  page drops the two values.
- **D2 conversion `element-text-variant-heading-levels`** (step 18, retired from the
  load path): `heading` → `h2` and `subheading` → `h3` on every `element:text` page
  component — regions, named slots and container nesting. Stored `sys_metadata` page
  rows replay it at rehydration; one notice per rewritten block.
- **D3 entry `element-text-variant-heading-subheading-retired`** carries the judgement
  the conversion cannot make: whether the rewritten level is the one the page means.
- **No further deprecation window**: 17.6.0 was the window the ruling asked for.

### Producers moved in this repository

- `@objectstack/platform-objects`: the four section headings on the `sys_user` record
  page's Security tab (`Password & Sign-in`, `Two-Factor Authentication`, `Email
  Verification`, `Danger Zone`) move from `subheading` to `h3`. They render the same
  h3 element, in the `h3` style.
- `examples/app-showcase`: the `page-variables` detail heading moves to `h3`.

⚠️ **The out-of-repo author population is NOT MEASURED.** `@objectstack/spec` is
published, and tenant-authored pages were not measured. In this repository the five
writers above were the only ones outside `packages/spec`. objectui at `main` authors
neither value; its `element:text` renderer, registry `inputs` enum, html tier and the
published `sdui.manifest.json` still list the two, and drop them once this release is
installable there (the objectui follow-up).

Clause-②: no (narrowing)

<!-- adr-0087: registered element-text-variant-heading-levels, element-text-variant-heading-subheading-retired -->
