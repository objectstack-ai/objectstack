---
"@objectstack/console": minor
---

Console (objectui) refreshed to `0abd4f9f8769`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 3 releasing of 5 changesets added across 5 non-merge commits; omitted: 2 release-nothing changesets (they ship no package code).

- **minor** — `@object-ui/types` declares each renderer's NODE SLOTS once (`NODE_SLOT_DECLARATIONS`, `nodeSlotsFor`), and `objectui check`, core `validateSchema`, the SDUI parser's `validateTree` and the `kind:'html'` page compile walk those slots as well as `children` (objectui#11170). Its changeset declares `Clause-②: yes (narrowing)`: a node under a slot that was never judged is judged now. (objectui `c4c506b9e`)
- **minor** — The screen-flow runner names the flow by its label, in the user's language (objectui#11092, the objectui half of objectstack#20318). (objectui `39a3e91fa`)
- **patch** — The External Datasource panel in Setup and Studio reads the `{ success, data }` envelope its routes answer (objectui#11628). On a federated datasource such as the showcase's `show… (objectui `0abd4f9f8`)

No objectui commit in the range carries `!`, and no changeset in it declares `major` or carries the breaking annotation. objectui#11170's narrowing is objectui's own validation reach and changes no ObjectStack-authorable key. The manifest this repository ships is generated without `slotsFor`, so its entries carry no slot list. The release-nothing pair is objectui#11396, which derives `MasterDetailDetailConfig` from the spec's `details` entry by reference, member for member the same, and objectui#11095, a KPI-tile invalidation pin.

objectui range: `9dfaca654311...0abd4f9f8769`
