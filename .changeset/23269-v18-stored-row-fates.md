---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/metadata-protocol': minor
---

fix: `os migrate meta --stored` lists every stored row that protocol 18 refuses and no conversion rewrites. Before, the preview counted each such row as already on protocol.

Clause-②: yes (widening: `IAutomationService.canonicalizeStoredFlow(...).todos?` in `@objectstack/spec`, `AutomationEngine.canonicalizeStoredFlow(...).todos` in `@objectstack/service-automation` and `StoredFlowCanonicalization.todos?` in `@objectstack/metadata-protocol`, each a new output member; nothing narrows, and no door accepts or refuses anything it did not before)

Three step-18 retirements refuse a stored shape that has no lossless rewrite. Upgrading a v17 database left those rows refused at load or at boot, and the stored preview read them as `canonical`. Each shape now has exactly one fate: **refused and listed**. The preview and `--apply` print one `TODO` line per site under its row. The line names the step-18 entry that refuses the shape, the site, and the choice the owner has to make. Nothing is rewritten, and the run's verdict does not change, because no run of the pass could clear these rows.

**#23269, a flow value slot carrying a `{…}` token, including a `get_record` / `update_record` / `delete_record` filter operand: refuse and list.** A whole-path token maps mechanically to `{ dialect: 'cel', source: '<path>' }`, but the rewrite is not lossless. A token the template resolved to nothing (an erased condition, so the node was refused) is a CEL fault on an absent root, and a flow variable named like a query placeholder used to shadow it. ADR-0087 D2 conversions run on the load path and must be lossless, so this one is not a D2. The chain also has no operator-applied rewrite of stored rows separate from the load path: `--stored` writes back the read path's own pass, and `--from 17` rewrites authored sources, not rows. So the flow is listed by flow, node and path (`flow-value-slot-template-dialect-refused`), and `registerFlow` goes on refusing it until the value is rewritten as its CEL envelope. A flow already in the CEL form, or using a query placeholder such as `{current_user_id}`, is not listed.

**#23270, a `controlled_by_parent` object without exactly one required `master_detail`: refuse and list, by object (`cbp-master-relation-tiers-retired`).** No shape here converts losslessly. The upgrade never picks between two masters, either both required or neither. An explicit `required: false` is a contradiction the builder refuses. Turning a required `lookup` into a `master_detail` changes what deleting the master does. An object with no master has nothing to convert. Leaving `controlled_by_parent` changes who can read the rows, so that is the owner's choice and never a silent rewrite. The listing reads the same predicate `ObjectSchema` refuses with, so the preview and the parse refuse one set. The one lossless shape, a single `master_detail` with `required` omitted, is still converted by `cbp-master-detail-required-defaulted` and is not listed.

**#23271, a view whose `data` binds the retired view-level API source: refuse and list, by view (`view-data-api-provider-retired`).** There is no mechanical move. The replacement is a page component's `dataSource`, so a page must exist to carry it. Deleting the view's `data` would make the view query its object instead. Views in every stored body spelling are covered, and so are an object's own `listViews`. The line shows the request URL and method and withholds every other request key, so a credential stored in a view's headers never reaches the report. A view on the `object`, `value` or `schema` provider is not listed.

How it is wired: `applyConversions` reports these shapes through its existing `onTodo` sink, after the conversions run. Each TODO's `conversionId` is the id of the D3 entry that refuses the shape, so the published `ConversionTodoNotice.conversionId` now names either a conversion or a D3 entry. The published flow-canonicalization result gains one member, a widening in three packages:

- `@objectstack/spec`: the contract `IAutomationService.canonicalizeStoredFlow(...)` declares an optional `todos?: ConversionTodoNotice[]` beside `notices` and `conflicts`. An implementation that reports none still conforms.
- `@objectstack/service-automation`: `AutomationEngine.canonicalizeStoredFlow(...)` returns `todos`. `registerFlow` ignores them, because its own refusal names the same sites.
- `@objectstack/metadata-protocol`: `StoredFlowCanonicalization` gains the matching optional `todos?`, and the stored pass lists a flow row's TODOs the way it lists any other row's.

The authoring funnel and the read seams pass no sink, so nothing changes for them.
