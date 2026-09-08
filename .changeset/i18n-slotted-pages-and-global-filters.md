---
"@objectstack/spec": minor
"@objectstack/cli": patch
"@objectstack/platform-objects": patch
---

Two surfaces the console renders that no translation bundle could address — a `kind: 'slotted'` page's components and a dashboard's global-filter bar — are now addressable (#16772).

**`walkAddressedPageComponents` widens in both dimensions.** The shared page walk behind `translatePage` and the CLI extractor (`os i18n extract` / `os i18n coverage`) rooted at `regions[].components[]` only and descended `properties.children` only. A slotted record page authors `regions: []` and puts everything under `slots.<slot>`, so the walk visited nothing on it and `pages.<name>` carried exactly two addressable keys however many components the page authored; a `page:tabs` / `page:accordion` keeps its panels' components under `properties.items[].children`, one level deeper than the descended slot, so a related list inside a tab was unreachable on any page kind. The walk now roots at `regions[].components[]` **and** `slots.<slot>` (one component or an array per slot, regions first, then slots in authored order — both root level for the collision arbitration and for the page-name `page:header` route, so a slotted page's `slots.header` is translated as the page's header), and descends `properties.children` **and** `properties.items[].children` (matched by shape, so a custom container speaking the same vocabulary is walked too; `body` / `footer` remain undescended — a renderer back-compat fallback, not an authorable spelling). The depth cap, the cycle guard and the ruled id arbitration are unchanged.

- Signature: the parameter is `AddressedPageRoots` (= `Pick<PageLike, 'regions' | 'slots'>`) instead of `Pick<PageLike, 'regions'>`, and the walk returns the rebuilt roots pair `{ regions?, slots? }` (each key present exactly when present on the input) instead of the regions array alone. `PageLike` gains `slots`. An enumeration-only consumer that ignores the return value needs no change; a consumer reading the returned regions destructures `{ regions }`.
- `translatePage` carries the rebuilt `slots` back onto the document.

**`dashboards.<name>.globalFilters.<key>` is a new bundle group.** A dashboard's filter bar draws directly above the widget titles the bundle has always translated, and neither a filter's label nor its static option labels had a key. The group is keyed by the filter's `name` (`GlobalFilterSchema.name`, declared as defaulting to `field` — a filter that authors no `name` is keyed by its `field`) and carries `label` and an `options.<value>` map keyed by the option `value` spelled as a string. `translateDashboard` overlays it on the served document, which is what objectui's filter bar already reads; the exported `globalFilterKey()` is the one key derivation both the resolver and the extractor use. `optionsFrom` options are fetched rows and are deliberately not addressable.

**`@objectstack/cli`:** `os i18n extract` offers `dashboards.<name>.globalFilters.<key>.label` / `.options.<value>` for every static filter, and `pages.<name>.title` / `.subtitle` for a `page:header` at any root (a slotted page's `slots.header` included) — the component keys under `slots` and tab panels follow from the shared walk with no extractor change.

**`@objectstack/platform-objects`:** the shipped Setup bundles (`en`, `zh-CN`, `ja-JP`, `es-ES`) carry the new `dashboards.<name>.globalFilters.created_at.label` entry for the system-overview dashboard's date-range filter, which authors no `name` and is therefore keyed by its `field`.
