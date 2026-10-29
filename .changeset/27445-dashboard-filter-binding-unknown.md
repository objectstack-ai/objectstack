---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint)!: `dashboard-filter-binding-unknown` refuses a widget `filterBindings` key that names no filter the dashboard declares, naming the widget, the key and the declared filters

Clause-②: no (narrowing) — `os validate`, `os build`, `os lint` and the metadata publish door (`422 INVALID_METADATA`) refuse a dashboard whose widget `filterBindings` carries a key that names no declared filter (`{ regoin: false }` beside a `region` filter, or a `dateRange` key on a dashboard that declares no `dateRange`), which they accepted before. A draft still saves, and its `_diagnostics` read reports the same verdict. No accept set is widened; one rule id and its exported constant `DASHBOARD_FILTER_BINDING_UNKNOWN` are added.
Metadata-protocol: narrowed

<!-- adr-0087: registered ui-dashboard-filter-binding-unknown-refused -->

**BREAKING** accept-set narrowing at every authoring door for `dashboard`.

- **Before.** `PUT /api/v1/meta/dashboard/<name>?mode=draft` and the publish that followed both answered `200` for a widget binding `filterBindings: { no_such_filter: 'status' }`. The runtime reads a binding by looking up each declared filter's name, so the key was never read: a misspelled opt-out left the widget scoped by the filter it was meant to ignore, and a misspelled re-target left the filter on its default field.
- **Now.** The rule reports the key at `widgets[i].filterBindings.<key>` at `error`, naming the widget, the key and the declared filters, with the nearest declared name as a "Did you mean". A key is valid when it names a `globalFilters` entry (by its `name`, or its `field` when it has no `name`) or is `dateRange` on a dashboard that declares `dateRange`. It is not suppressible.
- **Who sees it.** A dashboard with a misspelled or stale binding key, for example one left behind after its filter was renamed or removed. No dashboard in this repository's examples or platform objects, and none in the public HotCRM app, binds an undeclared key.
- **Stored rows.** A `sys_metadata` dashboard written before this release with such a key still loads and renders as before: the rule judges the authoring path, not the load path. Its next save or publish is refused until the key is fixed.

**The remedy.** Rename the key to one of the declared filter names the finding lists, declare the filter on the dashboard, or delete the entry.
