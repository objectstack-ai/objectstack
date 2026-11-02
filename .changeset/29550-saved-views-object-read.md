---
'@object-ui/data-objectstack': patch
---

perf(data-objectstack)!: an object route reads that object's saved views (`GET /meta/view?object=`), not every view of every object (#29550)

Clause-②: no (narrowing) — `listViews` and `listViewOverrides` no longer list a stored `view` row that carries no `viewKind` or no top-level `object` (a legacy bare spec, a `{ list }` wrapper, a row bound only through `data.object`). The draft-preview read applies the same rule. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export, signature or answer shape changes. The adapter's two view readers now apply the rule the server's one-object view read (ADR-0017 section 3.5) and the view write door (#7741) already apply: a row is bound to an object by `object` plus `viewKind`. There is no key for a migration to rewrite; a row stored before the write door refused unbound rows is re-bound by saving the view again. -->

**BREAKING** read narrowing in `@object-ui/data-objectstack` (`ObjectStackAdapter.listViews`, `ObjectStackAdapter.listViewOverrides`), which feed the Console's saved-view tabs and per-view settings.

- **Before.** On every object route, both readers downloaded the whole published view list (`GET /api/v1/meta/view`, every view of every object; 7 KB on app-crm) and kept one object's rows in the browser, matching a row on `data.object` or `object`, with or without `viewKind`.
- **Now.** While nothing on the page has loaded the whole list, they read `GET /api/v1/meta/view?object=OBJECT`, the read ADR-0017 declares for the view switcher, once for both readers. Once something has loaded the whole list, or while its read is on the wire (Studio, the MetadataProvider, a packaged app's object scope), they answer from it with no request of their own. Both paths keep the same rows in the same order: `viewKind` set, `object` naming the object, sorted by `order` and then `name`. The draft-preview read (`listViews` with `previewDrafts`) keeps its own `?preview=draft` request and narrows its rows by the same rule.
- **Order.** Saved-view tabs follow the contract's order (`order`, then `name`). Before, they followed the order of the server's whole list, so tabs with no `order` could appear in a different order.
- **Who sees it.** A deployment holding a `view` row stored before the write door refused rows without `object` and `viewKind` (#7741). That row was a saved-view tab and a per-view setting before, and is neither now. The server's one-object read never served it. Views the Console saves today carry both fields, and none of the rows on a fresh app-crm or showcase deployment were affected.

**The remedy.** Open the view in the Console and save it again: the save writes `object` and `viewKind`, and the view is listed again.
