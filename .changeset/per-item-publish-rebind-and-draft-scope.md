---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
---

Per-item publish (`POST /api/v1/meta/:type/:name/publish`) now re-binds runtime consumers
and finds drafts authored env-wide — the two things the package-scoped publish door
already did.

**A metadata publish now announces `metadata:reloaded` on BOTH doors.** The event that
tells boot-cached consumers to re-read had two announcers: the dev-artifact watcher and
the runtime dispatcher after `POST /packages/:id/publish-drafts`. Publishing item by item
— what AI authoring and the item-level Studio doors do — announced nothing, so a flow
published while the server ran stayed `state='active'` and completely inert (no trigger
bound, no execution) until the kernel was rebuilt. `publishMetaItem` now notifies its host
through a new `onMetaItemPublished` seam and `ObjectQLPlugin` turns that into the kernel
announce, so `service-automation`'s flow re-bind, the authored hook/action re-sync,
declarative connectors and authored translations all catch up without a restart. The
announce is awaited, so the publish's own 2xx means the re-bind was attempted; a
subscriber failure is logged and never fails the publish. The batch door is unchanged —
it keeps its single per-publish announce rather than gaining one per promoted draft.

**A per-item publish now resolves the draft's own org scope.** For the types the registry
declares `allowOrgOverride: true` (`view`, `dashboard`, `report`, `translation`,
`email_template`) the REST seam threads the session's active organization into the
publish, while package/AI authoring writes the draft env-wide — so the strict org lookup
matched nothing and answered `404 [no_draft] … nothing to publish` over a draft the
console's pending-changes banner was listing and the batch button published fine. The
per-item door now discovers the draft's scope the way `publishPackageDrafts` has since
#3115, with the ADR-0005 precedence (an org holding its own draft publishes that one) and
the same `NO_DRAFT` refusal when no scope holds a draft.
