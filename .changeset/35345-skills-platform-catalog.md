---
'@objectstack/skills': patch
---

docs(skills): a generated platform catalog, and `objectstack-project` asks "does the platform ship it?" before any new object, field or flow

Clause-②: no
Metadata-protocol: none

`objectstack-project` gains `references/platform-catalog.md`, generated from `@objectstack/spec`: the platform objects an app would otherwise build (users, attachments, comments, the audit trail, notifications, mail, exchange rates, imports, approvals, sharing, queues, webhooks, settings), each with what it replaces and how the app reaches it; the three value domains and the field names that should declare them; every `requires` capability switch with what it mounts; the master data that stays with each app; and a short Planned section whose rows are marked not available and link to their contract.

Its §0 asks a third question: check the catalog before adding an object, a field or a flow; use what the platform ships; when it is absent and a second app would copy it, file a platform card and build the app's own meanwhile, marked `// PLATFORM-CANDIDATE: <link>`. §5's bump sweep now retires those markers beside the `PLATFORM-GAP` tests. A defect (§3) is still never worked around; the new question is about a missing capability.

`objectstack-data`'s currency paragraph now teaches `valueDomain` for a time zone (`iana_time_zone`) and a country (`iso_3166_alpha2`) beside the currency code.

Six new eval cases (an attachments table, a business-hours calendar, a change-history table, a free-text unit, a country and time zone, an exchange-rate table) expect the platform object, the value domain, or a platform card with the marker.
