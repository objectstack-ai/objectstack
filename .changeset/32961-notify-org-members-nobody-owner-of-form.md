---
'@objectstack/skills': patch
---

docs(skills): the `notify` selectors say when `org:members` reaches nobody, and show the computed `owner_of:` form

Clause-②: no
Metadata-protocol: none

`objectstack-automation` § `notify` said `org:members` reaches every member of the run's organization, else that of the record the notification is about, and was silent on a run with neither. There the resolver warns in the server log and returns nobody while the node still succeeds: a `schedule` flow that declares no organization (the single-organization posture) and has no record hits it. The line now says so, matching `content/docs/automation/flows.mdx`, and says the warning for an unrecognised `org:` value is a server-log one too. The `owner_of:OBJECT:ID` line now shows the form a flow needs, an envelope that builds the string from a computed id (`source: "'owner_of:crm_case:' + record.case_id"`). Paid for in the same file, no ceiling moved: the `NotifyConfigSchema` `strictObject` clause that restated "an undeclared key is a named parse error", three ADR asides, and the pointer that sends side effects to an object hook, which the skill's own description and objectstack-data already carry. No schema or runtime change.
