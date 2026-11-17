---
'@objectstack/skills': patch
---

docs(skills): the api and i18n skills teach `RuntimeBuildIssue.userMessage`

Clause-②: no
Metadata-protocol: none

objectstack-api's SKILL.md, in the error-envelope section, names the post-publish probe report a batch publish answers (`probes`, `BuildProbeReportSchema`) and its finding element (`RuntimeBuildIssueSchema`): `message` / `fix` are English for the agent that built the app, the optional `userMessage` is the sentence for the person who published, and a client shows a person `userMessage`, never `message`, with its own generic sentence when the field is absent. objectstack-i18n's SKILL.md lists the probe finding among the server-composed user text and says its sentence is on the platform locale ladder, where the request is the publish request. Both point at the schema and ADR-0038 for the rest. One new eval case in the api skill grades a client that renders a build finding to a person.
