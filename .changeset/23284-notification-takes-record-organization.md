---
'@objectstack/objectql': minor
'@objectstack/service-messaging': minor
'@objectstack/service-automation': minor
'@objectstack/plugin-approvals': patch
---

fix(objectql,service-messaging,service-automation,plugin-approvals)!: a notification carries the organization of what it is about, and one no organization owns is refused instead of stored with `organization_id` NULL

Clause-②: no (narrowing) — notification rows gain the organization they should already carry; what narrows is an emit that names no organization on an install where none is derivable, which the engine now refuses where it used to store the event row with `organization_id` NULL.

<!-- adr-0087: not-required (no-migration-prescription) A runtime narrowing of which notification writes the engine accepts, not a metadata change. No spec key, authorable spelling, export, option, config field or stored shape is added, removed, renamed or re-shaped, and no stored row is rewritten: rows already stored with organization_id NULL keep it until the v18 ownership ceremony attributes them, which already lists sys_notification with the attribution fate. The only type change is an additive optional `organizationId` on the approvals service's internal messaging surface, which is not exported by name. The other categories are closed on facts: the four packages publish (not unpublished); no ADR-0087 id covers notification ownership and this diff adds none (not registered / already-registered); nothing is removed or narrowed on an interface or type (not runtime-interface-only / type-surface-only); and no runtime export is retired (not runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Every notification emitted from a system-context run — a scheduled flow, a record change written by a system context, an approval node — was stored in `sys_notification` with `organization_id` NULL, so reports and cleanup that filter by organization did not see it. Each emit also logged a `[notify] no organization in scope` warning. On an install holding several organizations, the deliveries of the same emit were refused while the flow step reported success, so nothing reached the inbox.

**Who owns a notification now:**

- **The run's organization.** A run that carries one emits exactly as before.
- **Else the record it is about.** A `notify` node in a run with no organization reads the organization of the record the notification is about. That is the declared click-through record (`sourceObject` + `sourceId`), else the run's trigger record. It is read from the stored row by id, never from the record snapshot the run carries.
- **Approvals.** Every approval notification carries its request's organization: `approval.requested`, reminders, comments, send-backs, reassignments, escalations and out-of-office notices.
- **Else the owner the engine derives for a system write** (ADR-0131 D9). `sys_notification` is now in the platform-object tenancy ledger, so an emit that names no organization gets the install's sole organization under the `single` posture.
- **The rows below follow the event.** `emit()` stamps the stored event row's organization on its delivery, inbox row and receipt, on both the inline and the outbox path.

**Refused now:** where no organization is derivable (a walled posture, or a `single` install holding more than one organization), an emit that names none is refused with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`. Nothing is written for it. A `notify` step that hits the refusal fails with `notify failed: ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED: …` instead of succeeding. `MessagingService.emit()` rejects with the engine's error for any other producer.

**What to do when it refuses:** give the notification an owner. Name the record it is about on the `notify` node (`sourceObject` + `sourceId`), declare the scheduled flow's acting organization (`organization` on its start node), or pass `organizationId` to `emit()` from your own code.

The `[notify] no organization in scope` warning is gone, because the NULL row it predicted is no longer written. Rows already stored with `organization_id` NULL are not rewritten here. The v18 organization-ownership ceremony attributes them from their source record.
