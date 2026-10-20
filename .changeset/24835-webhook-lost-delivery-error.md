---
'@objectstack/plugin-webhooks': patch
---

fix(plugin-webhooks): a webhook delivery the outbox could not record is now reported at `error`, once per webhook, with what was lost and how to fix it

Clause-②: no

- **What was wrong.** When the `sys_http_delivery` write for a webhook event failed, the auto-enqueuer logged one bare `WARN [webhook-auto-enqueuer] enqueue failed` line per event. The event was lost: it is never sent, retried or redeliverable, because no row exists. The record write that produced the event had already answered 200, and the webhook still read active in Setup, so nothing else looked wrong. On PostgreSQL every record-update delivery was lost this way.
- **What changed.** The first lost delivery for a webhook is logged at `error`. The line names the webhook, says the event is lost and why nothing else shows it, and says where the cause is (the record's meta) and what to restore. Later lost events for the same webhook are logged at `debug`, each with its `eventId`. The `error` is said again only after a delivery for that webhook was recorded in between. A logger without `error` still receives the line at `warn`. Bulk (`data.records.*`) deliveries are reported the same way.
- **Unchanged.** Successful deliveries, the delivery rows, the parked-subscription path and every export. This change does not fix the PostgreSQL loss itself: that cause is upstream of the webhook plugin and is fixed separately.
