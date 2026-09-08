---
"@objectstack/plugin-webhooks": patch
---

Webhook fan-out now matches subscriptions on the organization dimension, closing a cross-organization delivery on walled deployments (`OS_TENANCY_POSTURE=isolated|group`).

`AutoEnqueuer` selected the subscriptions to deliver to by object name and trigger only, and every organization's `sys_webhook` rows live in one cache — so organization A's record events reached organization B's webhook endpoint, signed with B's secret, on first delivery. Both the per-record (`data.record.*`) and the bulk (`data.records.*`) fan-out paths now compare the subscription's own organization (`sys_webhook.organization_id`) with the organization the engine stamps on the event (`DataEvent.organizationId`, `BulkDataEvent.organizationId`): one equality per candidate, no lookup on the hot path.

What changes for a subscription:

- **Owned by organization A** — receives only events stamped A. An event that names no organization (an environment-wide row or an object outside the wall on the per-record path; a batch the tenant wall could not attribute to one organization on the bulk path) is not delivered inside the wall — fail-closed — and the first such refusal is logged once with the reason.
- **With no organization** (`organization_id` NULL — for example a package-declared webhook on a walled deployment) — no longer receives any organization-stamped event; the refusal is logged once per subscription. It still receives events that name no organization. On a `single`-posture deployment nothing stamps either side, so delivery there is unchanged.

An event whose `organizationId` is present but not a non-empty string is dropped loudly as off-contract, delivering to nobody.
