---
"@objectstack/spec": minor
---

feat(spec): a repeater's property-panel table has column NAMES, and an untitled item schema is now loud (#17232)

## What was wrong

Studio renders a `type: 'repeater'` form field as a table whose column headers
read `items.properties[k].title ?? k` off the JSON Schema served by
`GET /meta/types` — derived by `packages/metadata-protocol`'s `toJsonSchemaSafe`,
i.e. `z.toJSONSchema(getMetadataTypeSchema(type), { unrepresentable: 'any' })`.
The bundle overlay `resolveMetadataFormSchemaTitles` (#16458 / PR #17227) only
replaces a title that is already there, so an item schema carrying no
`.meta({ title })` falls through to the raw machine key — in **every** locale,
English included. The maker read `actionUrl`, `defaultCollapsed`, `dateGranularity`
inside an otherwise fully translated panel. This is a missing authoring label in
the contract, not a translation gap.

PR #17227 titled exactly one repeater, `dashboard.header.actions`, and was scoped
by dispatch to that one. **The class stayed silent**: the next repeater to land
would reproduce the defect with every gate green.

## Measured on `origin/main` at `e758131b39`

22 repeater fields are declared across 11 `*.form.ts` files. Derived through the
platform's own predicate rather than a source regex:

- **1** was fully titled — `dashboard.header.actions`, PR #17227's instance.
- **1** has no object row shape at all — `action.locations` is an array of enum
  STRINGS, so it renders no column headers and leaks no key. It is **not** a
  carrier, which is why the class is **20** untitled tables today and not the 21
  the card premised.
- **20** were untitled.

## What changed

**Thirteen carriers are now titled** — every row property of `action.params`,
`app.areas`, `dataset.dimensions`, `dataset.measures`, `flow.nodes`,
`flow.edges`, `flow.variables`, `page.variables`, `page.regions`,
`page.interfaceConfig.sort`, `report.order`, `report.blocks` and
`skill.triggerConditions` carries a `.meta({ title })`. `page.interfaceConfig.sort`
is titled through the shared `SortItemSchema` it composes.

**The silence is closed.** `packages/spec/src/kernel/repeater-item-titles.test.ts`
enumerates every repeater declared across every `*.form.ts` in the package,
derives each row schema through `z.toJSONSchema`, and requires a title on every
authorable row property. Carriers still owed one sit in an EXACT, shrink-only
ledger: a repeater absent from the ledger must be fully titled, and a ledger
entry whose debt has been paid must be deleted. A new repeater is therefore red
on the day it lands, and the ledger can only shrink.

Two exclusions the pin makes deliberately, each with its own control:

- a `retiredKey()` tombstone is a parse-time refusal, not an authorable column
  (`flow.nodes[].outputSchema`);
- a scalar-item repeater has no row properties to name (`action.locations`),
  and is pinned by name so an object-shaped one cannot land there silently.

## What is still owed, and why

Seven carriers remain on the ledger because their item schemas live in files held
by other in-flight PRs at the time of writing — `dashboard.widgets` and
`dashboard.globalFilters` (`ui/dashboard.zod.ts`), `view.columns` / `view.sort` /
`view.tabs` (`ui/view.zod.ts`), and `field.options` + `object.fields.options`
(the one `SelectOptionSchema` in `data/field.zod.ts`). The pin OBSERVES them
without editing them, so the ledger states the whole class rather than the slice
one PR could reach.

Localisation is additive and unchanged by this round. `.meta({ title })` is the
English authoring layer by contract — `translation.zod.ts` states it in those
words — and a bundle's `metadataForms.<type>.fields.<repeater>.<property>.label`
overlays it per locale. No form file here enumerates repeater children, so
`os i18n extract` emits no new catalog keys and no catalog moves. Until those
leaves are authored, a non-English panel shows the English title rather than the
machine key — strictly better than today, and the localisation layer is still owed.
