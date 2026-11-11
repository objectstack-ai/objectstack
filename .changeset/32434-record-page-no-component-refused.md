---
'@objectstack/spec': minor
---

fix(spec)!: a record page that places no component is refused at parse, instead of saving as valid and opening every record of its object on a blank detail panel (#32434)

Clause-②: no (narrowing) — `PageSchema` refuses a `kind: 'full'` record page (`type: 'record'`, the default type) whose `regions` hold no component, a page it accepted before; so do `definePage`, `defineStack` (and with it `os validate` / `os build`) and the metadata save door. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: no move — `skills/**` shows no region-less record page and states no fallback for one; the `regions` describe, the `page` form note and `content/docs/ui/pages.mdx` drop the claim that an empty full page falls back to the synthesized default layout, and the prescription ships in the refusal text, the FROM → TO below and the upgrade-guide entry.

<!-- adr-0087: registered page-record-no-component-refused -->

**BREAKING** accept-set narrowing of `PageSchema` (`@objectstack/spec/ui`).

- **Before.** `{ name: 'leave_request_record', label: 'Leave request', type: 'record', object: 'leave_request', template: 'default' }` — no `regions` — parsed, saved `200` through `PUT /api/v1/meta/page/NAME` with `_diagnostics.valid: true`, and published. The console draws a `full` record page exactly as authored, and on a record page the components in its regions are all it draws (the label is the `page:header` block's, the description is not drawn, no template draws anything of its own, `slots` and `interfaceConfig` are not read on a `full` page), so every `leave_request` record opened on a blank detail panel: the breadcrumb and nothing else. The `regions` describe said an empty full page "falls back to the synthesized default layout"; the console never did.
- **Now.** `checkPageRecordPlacesComponent` refuses such a page at `regions` — no `regions`, or only regions whose `components` are empty — saying every record of its object would open on a blank detail panel and naming the fixes. `definePage` throws, `defineStack` / `os validate` / `os build` answer `STACK_SCHEMA_INVALID`, the metadata save door answers `422 INVALID_METADATA`, and a package whose body carries such a page is refused when it registers (an installed one included, as with an unplaced region: no conversion rewrites it). The `print` refusal for a `full` page with no regions no longer claims that page draws the synthesized default layout either.
- **Unchanged.** A `home`, `app`, `utility` or `list` page with no regions parses as before (the first three draw their `label` as the page heading, a list page draws through `interfaceConfig`). A `kind: 'slotted'` record page (where Studio starts a new record page) and an `html` / `react` page are not judged. A page row already stored this way is served unchanged, flagged `_diagnostics.valid: false` at `regions`, and refused on its next save; until it is fixed or deleted the console still draws the blank panel. No conversion rewrites it: every rewrite that draws something changes what the page shows.
- **Upgrade guide.** The semantic entry `page-record-no-component-refused`.

**FROM → TO.** `{ type: 'record', object: 'leave_request' }` with no component → delete the page (the object's default record page opens again), or `kind: 'slotted'` (that default page, replacing only the slots you name), or `regions: [{ name: 'main', components: [{ type: 'record:details' }] }]`.
