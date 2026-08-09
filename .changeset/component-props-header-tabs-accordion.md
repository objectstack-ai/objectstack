---
"@objectstack/spec": major
---

refactor(spec)!: finish #5775's count — 4 SDUI component props declared, `page:tabs.type` renamed to `tabStyle` (#6776)

#5775 reconciled `ComponentPropsMap` with the renderers that serve it and then
recorded that "the rest of the keys the renderers honour are declared". That
sentence did not hold. Re-counting against objectui `origin/main` found **five**
more author-facing props that objectui's renderers read and this schema did not
declare — so for each of them three platform authorities disagreed at once:
objectui's published manifest and generated `sdui-intrinsics.d.ts` told an author
(very often an AI author, ADR-0033) the key was **legal**, `validateComponentProps`
(#5068) reported it **undeclared**, and the renderer **honoured it anyway**. That
is #5435's shape — a platform authority pointing at a key its own gate rejects —
with the wrong half on the spec side this time.

Four are plain declarations. No behaviour changes; the contract catches up with
what has always shipped:

| Key | Type | Default | What it does |
| :-- | :-- | :-- | :-- |
| `page:header.recordChrome` | `boolean` | `true` | `false` drops the record chip and renders the bare heading — what a dashboard or landing page wants, since there is no record to describe |
| `page:header.showStar` | `boolean` | `true` | the follow (favourite) star beside the record title |
| `page:header.showCopyId` | `boolean` | `true` | the copy-record-id button beside the record title |
| `page:accordion.variant` | `'flush' \| 'card'` | `'flush'` | `flush` draws the divider under each panel; `card` leaves the border to each panel's own content |

The fifth is a rename, and the only one whose defect is structural rather than an
oversight.

## BREAKING: `page:tabs` property `type` → `tabStyle`

The concept — the tab strip's visual style, `line` / `card` / `pill` — was
declared all along, under a spelling **no author can write in most carriers**: a
props key named `type` collides with the page component's own dispatch key.
Three independent consequences, each measured on objectui `origin/main`:

- `SchemaRenderer.tsx:253,264` hoists `properties` onto the node but skips `type`
  and `id` deliberately, or the inner value would shadow which renderer to
  dispatch to. Its comment names this exact case.
- `sdui-parser`'s `BASE_PROPS` (`validate.ts:20-30`) contains `type`, and
  `validate.ts:68` skips every base prop before the unknown/typed checks — so a
  manifest input by that name is **never validated**.
- In the flat and JSX carriers a node reads
  `{ type: 'page:tabs', items: [...], tabStyle: 'card' }`: `type` is the tag
  name, and the declared spelling has nowhere left to go.

`tabStyle` is what objectui's registry publishes as the designer input and what
`containers.tsx:381` reads in every carrier. Converging on the spelling that
works rather than the one that declares well is #5775's `displayField` →
`labelField` again, and one spelling rather than two is Prime Directive #12 —
declaring `tabStyle` as an alias of `type` was considered and refused, because
the dialect that would survive is the one that silently fails to validate.

FROM → TO:

- `pages[].regions[].components[]` and `pages[].slots.<slot>` where
  `type === 'page:tabs'`: `properties.type` → `properties.tabStyle`. The value
  (`line` | `card` | `pill`) is unchanged.

**The one-line fix:** rename the key. `os migrate meta --from 16` rewrites it
automatically; the ADR-0087 D2 conversion is
`page-tabs-type-to-tab-style` (`retiredFromLoadPath` — the tombstone owns the
refusal, so a 17 loader does not accept the old spelling), and the tombstone
carries the same prescription at `tsc` and at parse time for anyone jumping
several majors at once.

## Also in this change

`mapPageComponents` (the conversion layer's page walk) now visits
`pages[].slots.<slot>` as well as `pages[].regions[].components[]`. Its comment
used to call region level "the whole surface", on the reasoning that everything
else lives inside a free-form `properties` bag — but `PageSchema.slots` is a
closed map of seven named slots, each declared
`z.union([PageComponentSchema, z.array(PageComponentSchema)])`, as typed as any
region component, and `packages/lint`'s `walkPageComponents` has always visited
both. #6776 is where the gap cost something: `page:tabs` **is** one of those
slots, all four in-repo authoring sites are `slots.tabs`, and a region-only
rewrite would have left `os migrate meta` unable to touch the only shape the key
is written in — while the tombstone promised it could. Every other page-component
conversion gains the same reach, in the direction it already declares.

<!-- adr-0087: registered page-tabs-type-to-tab-style -->

