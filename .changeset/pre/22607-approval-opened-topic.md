---
"@objectstack/plugin-approvals": minor
---

feat(plugin-approvals): opening an approval step tells each resolved approver (`approval.requested`)

Clause-②: yes (widening)

- **What is new.** When an approval node opens a request, every concrete approver on the slate it opened on gets one notification on the new topic `approval.requested`: title "Approval requested", body "A decision on OBJECT/RECORD is waiting on you.", linked to that request in the Approvals Inbox, with the person whose run opened the step as its actor. It goes through the installed `messaging` service exactly as `approval.reminder`, `approval.reassigned`, `approval.escalated` and `approval.returned` do, so the same channels and delivery preferences apply. Before this, the opening was the one lifecycle step that published nothing: an approver learned that a step was waiting only by opening the inbox.
- **Who is told.** A named user, every holder of a staffed position or member of a team, and, when `onEmptyApprovers: 'fallback'` replaced an empty slate, the declared `fallbackApprovers`. Each person is told once, even when the slate lists them under two groups.
- **Who is not.** A `type:value` slot no one holds (`position:NAME` with no holders) names no person, so a step that resolves to nobody notifies no one, and `onEmptyApprovers` decides that case: `admin_rescue` opens on the literal slot and tells nobody, `auto_approve` and `fail` open no request. An out-of-office delegate gets one message, the existing `approval.ooo_substituted`, not a second one for the opening. Without a `messaging` service nothing is delivered, as before.
- **Not included.** The opening carries no one-tap Approve / Reject links. Those links are still minted only by a reminder.
- **If your flow already tells the approvers itself, remove that.** The approvals guide used to say that opening a request notifies nobody, and suggested a `notify` node next to the approval node as the workaround. A flow that followed that advice now tells the same approvers twice. Remove the `notify` node, or narrow its recipients to people the approval does not address. Keep `notify` nodes that tell the submitter or a watcher, or that report the decision. No flow in this repository's examples, `objectstack-ai/hotcrm` or `objectstack-ai/hotclm` has that workaround: every `notify` node in their approval flows runs after the decision.
