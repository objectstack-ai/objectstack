---
'@objectstack/platform-objects': patch
'@objectstack/metadata-core': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-security': patch
'@objectstack/service-automation': patch
'@objectstack/service-messaging': patch
'@objectstack/service-storage': patch
---

feat(platform-objects,services,plugins): platform select options declare the colours they render with

Clause-②: no
Metadata-protocol: none

The renderer now colours a select option only when its author declared a colour. Every platform-shipped option that took its colour from the renderer's value table now declares that colour itself, in the same palette family, so no platform badge turns neutral: `sys_notification.severity` and `inbox_message.severity` (info blue, warning yellow, critical red), and the status and state options of jobs, imports, emails, flow and sync runs, credentials, deliveries, receipts, uploads, files, invitations, signing and trusted keys, tasks, metadata rows and audience-binding suggestions, and the `completed` activity type. Stored values and labels are unchanged.
